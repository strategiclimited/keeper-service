import { getConnection } from 'typeorm';

import { depositContractAt } from '../../contracts';
import { Deposit } from '../../entities/Deposit';
import { DepositStatus } from '../../types';
import { createLogger } from '../../logger';
import { ensureApproveSpendingTbtc } from './redeemApprove';
import { ensureRedemptionRequested } from './requestRedemption';
import { ensureRedemptionSigProvided } from './redemptionSig';
import { ensureBtcReceived } from './btcReception';
import { getDeposit } from '../depositHelper';
import { ensureRedemptionProofProvided } from './redemptionProof';
import { ensureDepositCreated } from './createDeposit';
import { ensurePubkeyRetrieved } from './retrievePubkey';
import { ensureBtcFunded } from './fundBtc';
import { ensureFundingProofProvided } from './fundingProof';
import { ensureApproveAndCallTdt } from './approveAndCallTdt';
import { ensureApproveTdt } from './approveTdt';
import { ensureTdtToTbtc } from './tdtToTbtc';

const logger = createLogger('redemption');
let busy = false;

export async function init(): Promise<any> {
  console.log('init');
  const deposit = await getDeposit('0xd7708a3c85191fc64ebd5f1015eb02dfb0f7eca4');
  const depositContract = depositContractAt(deposit.depositAddress);
  const statusCode = await depositContract.getStatusCode();
  console.log('deposit is in status:', DepositStatus[statusCode]);
  processDeposit(deposit);
  // checkForDepositToProcess();
  // const deposit = depositContractAt('0x41f92f9c627132a613a14de9a28aebc721607b90');
  // const statusCode = await deposit.getStatusCode();
  // console.log('deposit is in status:', DepositStatus[statusCode]);
}

export async function checkForDepositToProcess(): Promise<void> {
  if (!busy) {
    busy = true;
    const deposit = await getDepositToProcess();

    if (deposit) {
      await processDeposit(deposit);
      busy = false;
      checkForDepositToProcess();
    }
    busy = false;
  }
}

async function getDepositToProcess(): Promise<Deposit> {
  const connection = getConnection();
  const deposits = await connection.createEntityManager().find(Deposit, {
    where: { statusCode: [DepositStatus.KEEPER_QUEUED_FOR_REDEMPTION, DepositStatus.KEEPER_REDEEMING] },
    order: { statusCode: 'DESC', createDate: 'ASC' },
  });

  // TODO: order by collateralization %

  logger.info(`Found ${deposits.length} deposits to process`);

  return deposits[0];
}

async function processDeposit(deposit: Deposit): Promise<void> {
  // TODO: change deposit state to REDEEMING
  // TODO: check for errors, if 3 errors in one operation type - set deposit state to ERROR
  // TODO: between each call:
  // - update deposit
  // - check deposit status
  // - check balances

  let updatedDeposit = await ensureApproveSpendingTbtc(deposit);

  updatedDeposit = await ensureRedemptionRequested(updatedDeposit);

  updatedDeposit = await ensureRedemptionSigProvided(updatedDeposit);

  updatedDeposit = await ensureBtcReceived(updatedDeposit);

  updatedDeposit = await ensureRedemptionProofProvided(updatedDeposit);

  // MINTING ///////////////////////

  updatedDeposit = await ensureDepositCreated(updatedDeposit);

  updatedDeposit = await ensurePubkeyRetrieved(updatedDeposit);

  updatedDeposit = await ensureBtcFunded(updatedDeposit);

  updatedDeposit = await ensureFundingProofProvided(updatedDeposit);

  // updatedDeposit = await ensureApproveAndCallTdt(updatedDeposit);

  updatedDeposit = await ensureApproveTdt(updatedDeposit);

  updatedDeposit = await ensureTdtToTbtc(updatedDeposit);

  // refresh system balances
}

export default { init };
