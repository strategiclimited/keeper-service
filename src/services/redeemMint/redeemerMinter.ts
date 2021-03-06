/* eslint-disable camelcase */
import { getConnection } from 'typeorm';
import PubSub from 'pubsub-js';

import { createLogger } from '../../logger';
import { Deposit, DepositTx } from '../../entities';
import depositTxHelper, { IDepositTxParams } from '../depositTxHelper';
import depositHelper from '../depositHelper';
import userAccountingHelper from '../userAccountingHelper';
import emailService from '../emailService';
import systemAccountingHelper from '../systemAccountingHelper';
import redeem_1_approveTbtc from './redeem_1_approveTbtc';
import redeem_2_requestRedemption from './redeem_2_requestRedemption';
import redeem_3_redemptionSig from './redeem_3_redemptionSig';
import redeem_4_btcRelease from './redeem_4_btcRelease';
import redeem_5_redemptionProof from './redeem_5_redemptionProof';
import mint_1_createDeposit from './mint_1_createDeposit';
import mint_2_retrievePubkey from './mint_2_retrievePubkey';
import mint_3_fundBtc from './mint_3_fundBtc';
import mint_4_fundingProof from './mint_4_fundingProof';
import mint_5_approveTdt from './mint_5_approveTdt';
import mint_6_tdtToTbtc from './mint_6_tdtToTbtc';
import { MINUTE_MILLIS } from '../../constants';
import { DEPOSITS_CHECKED_TOPIC } from '../depositMonitor';

type ConfirmFn = (deposit: Deposit, txHash: string) => Promise<IDepositTxParams>;
type ExecuteFn = (deposit: Deposit) => Promise<IDepositTxParams>;

interface IStepParams {
  operationType: DepositTx['Type'];
  confirm: ConfirmFn;
  execute: ExecuteFn;
}

const logger = createLogger('redeem/mint');
let busy = false;

async function init() {
  PubSub.subscribe(DEPOSITS_CHECKED_TOPIC, checkForDepositToProcess);
  logger.info('Listening for deposits to process...');
}

async function checkForDepositToProcess(): Promise<void> {
  if (busy) {
    logger.info('Process is busy');
  } else {
    logger.info('Checking for deposit to process...');
    busy = true;
    const deposit = await getDepositToProcess();

    if (deposit) {
      logger.info(`Found deposit ${deposit.depositAddress} to process. Making sure system balances are sufficient...`);
      logger.debug(deposit);
      await ensureSufficientSystemBalances();
      logger.info(`Processing deposit ${deposit.depositAddress}...`);
      await processDeposit(deposit);
      logger.info(`Deposit ${deposit.depositAddress} processed`);
      busy = false;
      // when a deposit is processed, check for more (new redemption could've been triggered in the meantime)
      checkForDepositToProcess();
    } else {
      logger.info('No deposits to process');
    }
    busy = false;
  }
}

async function ensureSufficientSystemBalances(): Promise<void> {
  const ok = await systemAccountingHelper.checkSystemBalances();

  if (!ok) {
    logger.error('System balance too low. Unable to process deposits!');
    return new Promise((resolve) => setTimeout(() => resolve(ensureSufficientSystemBalances()), 30 * MINUTE_MILLIS));
  }

  return undefined;
}

async function getDepositToProcess(): Promise<Deposit> {
  const connection = getConnection();
  const deposits = await connection.createEntityManager().find(Deposit, {
    where: { systemStatus: [Deposit.SystemStatus.QUEUED_FOR_REDEMPTION, Deposit.SystemStatus.REDEEMING] },
    // ordering by status DESC ensures deposits in REDEEMING status will be processed first (i.e. interrupted process will be picked up)
    order: { systemStatus: 'DESC', createDate: 'ASC' },
  });

  // TODO: order by collateralization % ?
  // TODO: double check collateralization %

  logger.info(`Found ${deposits.length} deposits to process`);

  return deposits[0];
}

async function processDeposit(deposit: Deposit): Promise<void> {
  await systemAccountingHelper.rememberSystemBalances();

  try {
    const updated = await depositHelper.updateSystemStatus(deposit.depositAddress, Deposit.SystemStatus.REDEEMING);

    if (updated) {
      emailService.redemptionStart(deposit);
      emailService.admin.redemptionStart(deposit);
    }

    const steps: IStepParams[] = [
      redeem_1_approveTbtc,
      redeem_2_requestRedemption,
      redeem_3_redemptionSig,
      redeem_4_btcRelease,
      redeem_5_redemptionProof,
      mint_1_createDeposit,
      mint_2_retrievePubkey,
      mint_3_fundBtc,
      mint_4_fundingProof,
      mint_5_approveTdt,
      mint_6_tdtToTbtc,
    ];

    for (const step of steps) {
      const updatedDeposit = await depositHelper.getByAddress(deposit.depositAddress);
      await executeStep({
        deposit: updatedDeposit,
        operationType: step.operationType,
        confirmFn: step.confirm,
        executeFn: step.execute,
      });
    }

    emailService.redemptionComplete(deposit);
    emailService.admin.redemptionComplete(deposit);
  } catch (e) {
    logger.error(e);
    emailService.redemptionError(deposit);
    emailService.admin.redemptionError(deposit, e);
    await depositHelper.updateSystemStatus(deposit.depositAddress, Deposit.SystemStatus.ERROR);
  } finally {
    await userAccountingHelper.updateUserBalancesForDeposit(deposit.id);
    await userAccountingHelper.checkUserBalancesForDeposit(deposit.id);
    await systemAccountingHelper.compareSystemBalances();
  }
}

async function executeStep({
  deposit,
  confirmFn,
  executeFn,
  operationType,
}: {
  deposit: Deposit;
  confirmFn: ConfirmFn;
  executeFn: ExecuteFn;
  operationType: DepositTx['Type'];
}): Promise<void> {
  logger.info(`Initiating ${operationType} for deposit ${deposit.depositAddress}...`);

  if (depositTxHelper.hasConfirmedTxOfType(deposit.id, operationType)) {
    logger.info(`${operationType} is ${DepositTx.Status.CONFIRMED} for deposit ${deposit.depositAddress}.`);
  }

  const broadcastedTx = await depositTxHelper.getBroadcastedTxOfType(deposit.id, operationType);
  if (broadcastedTx) {
    logger.info(
      `${operationType} is in ${DepositTx.Status.BROADCASTED} state for deposit ${deposit.depositAddress}. Confirming...`
    );
    await tryConfirmFn(confirmFn, deposit, broadcastedTx.txHash, operationType);
  }

  const res = await tryExecuteFn(executeFn, deposit, operationType);
  await tryConfirmFn(confirmFn, deposit, res.txHash, operationType);
}

async function tryConfirmFn(
  confirmFn: ConfirmFn,
  deposit: Deposit,
  txHash: string,
  operationType: DepositTx['Type']
): Promise<IDepositTxParams> {
  try {
    const res = await confirmFn(deposit, txHash);

    await depositTxHelper.storeAndAddUserPayments(deposit, res);

    return res;
  } catch (e) {
    logger.error(e);
    await depositTxHelper.storeAndAddUserPayments(deposit, {
      status: DepositTx.Status.ERROR,
      txHash,
      operationType,
    });
    throw e;
  }
}

async function tryExecuteFn(
  executeFn: ExecuteFn,
  deposit: Deposit,
  operationType: DepositTx['Type']
): Promise<IDepositTxParams> {
  try {
    const res = await executeFn(deposit);

    await depositTxHelper.storeAndAddUserPayments(deposit, res);

    return res;
  } catch (e) {
    logger.error(e);
    await depositTxHelper.storeAndAddUserPayments(deposit, {
      status: DepositTx.Status.ERROR,
      operationType,
    });
    throw e;
  }
}

export default {
  init,
};
