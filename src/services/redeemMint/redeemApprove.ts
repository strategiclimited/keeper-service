import { depositContractAt, tbtcToken, vendingMachine } from '../../contracts';
import { Deposit } from '../../entities/Deposit';
import {
  BlockchainType,
  DepositOperationLogDirection,
  DepositOperationLogStatus,
  DepositOperationLogType,
  IDepositContract,
  IEthTx,
} from '../../types';
import { createLogger } from '../../logger';
import { bnToNumber } from '../../utils';
import { DepositOperationLog } from '../../entities/DepositOperationLog';
import { ethClient } from '../../clients';
import priceFeed from '../priceFeed';
import {
  getOperationLogInStatus,
  getOperationLogsOfType,
  hasOperationLogInStatus,
  storeOperationLog,
} from './operationLogHelper';
import { getDeposit } from '../depositHelper';

const logger = createLogger('redeemApprove');

export async function ensureApproveSpendingTbtc(deposit: Deposit): Promise<Deposit> {
  logger.info(`Ensuring tbtc spending is approved for deposit ${deposit.depositAddress}...`);
  try {
    // TODO: double check status on blockchain - ACTIVE / COURTESY_CALL
    const logs = await getOperationLogsOfType(deposit.id, DepositOperationLogType.REDEEM_APPROVE_TBTC);
    if (hasOperationLogInStatus(logs, DepositOperationLogStatus.CONFIRMED)) {
      logger.info(`Tbtc spending is ${DepositOperationLogStatus.CONFIRMED} for deposit ${deposit.depositAddress}.`);
      return getDeposit(deposit.depositAddress);
    }

    const broadcastedLog = getOperationLogInStatus(logs, DepositOperationLogStatus.BROADCASTED);
    if (broadcastedLog) {
      logger.info(
        `Tbtc spending is in ${DepositOperationLogStatus.BROADCASTED} state for deposit ${deposit.depositAddress}. Confirming...`
      );
      await confirmApproveSpendingTbtc(deposit, broadcastedLog.txHash);
      return getDeposit(deposit.depositAddress);
    }

    const tx = await approveSpendingTbtc(deposit);
    await confirmApproveSpendingTbtc(deposit, tx.hash);
  } catch (e) {
    // TODO: handle errors inside functions above
    console.log(e);
    throw e;
  } finally {
    // TODO: update total redemption cost
  }
  return getDeposit(deposit.depositAddress);
}

async function confirmApproveSpendingTbtc(deposit: Deposit, txHash: string): Promise<void> {
  logger.info(`Waiting for confirmations for TBTC spending for deposit ${deposit.depositAddress}...`);
  const { receipt, success } = await ethClient.confirmTransaction(txHash);
  logger.info(`Got confirmations for TBTC spending for deposit ${deposit.depositAddress}.`);

  const log = new DepositOperationLog();
  log.txHash = txHash;
  log.operationType = DepositOperationLogType.REDEEM_APPROVE_TBTC;
  log.direction = DepositOperationLogDirection.OUT;
  log.status = success ? DepositOperationLogStatus.CONFIRMED : DepositOperationLogStatus.ERROR;
  log.blockchainType = BlockchainType.ETH;
  log.txCostEthEquivalent = receipt.gasUsed;
  log.txCostUsdEquivalent = await priceFeed.convertWeiToUsd(receipt.gasUsed);

  await storeOperationLog(deposit, log);
}

async function approveSpendingTbtc(deposit: Deposit): Promise<IEthTx> {
  const depositContract = depositContractAt(deposit.depositAddress);
  const redemptionCost = await depositContract.getRedemptionCost();
  console.log(redemptionCost);
  console.log(redemptionCost.toString());
  console.log(bnToNumber(redemptionCost));
  const tx = await vendingMachine.approveSpendingTbtc(redemptionCost);
  console.log(tx);

  const log = new DepositOperationLog();
  log.blockchainType = BlockchainType.ETH;
  log.txHash = tx.hash;
  log.operationType = DepositOperationLogType.REDEEM_APPROVE_TBTC;
  log.direction = DepositOperationLogDirection.OUT;
  log.status = DepositOperationLogStatus.BROADCASTED;

  await storeOperationLog(deposit, log);

  return tx;
}
