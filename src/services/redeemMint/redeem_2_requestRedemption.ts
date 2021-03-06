import { getConnection } from 'typeorm';
import BN from 'bn.js';

import { vendingMachine, depositContractAt } from '../../contracts';
import { Deposit } from '../../entities/Deposit';
import { createLogger } from '../../logger';
import { btcClient, ethClient } from '../../clients';
import { DepositTx } from '../../entities';
import { IDepositTxParams } from '../depositTxHelper';

const logger = createLogger('redeem_2_requestRedemption');
const operationType = DepositTx.Type.REDEEM_REDEMPTION_REQUEST;

async function confirm(deposit: Deposit, txHash: string): Promise<IDepositTxParams> {
  logger.info(`Waiting for confirmations for redemption request for deposit ${deposit.depositAddress}...`);
  const { receipt, success } = await ethClient.confirmTransaction(txHash);

  logger.info(`Got confirmations for redemption request for deposit ${deposit.depositAddress}.`);
  logger.debug(JSON.stringify(receipt, null, 2));

  const redemptionFeeEth = await depositContractAt(deposit.depositAddress).getRedemptionFee();
  const txCost = receipt.gasUsed.add(redemptionFeeEth);

  return {
    operationType,
    txHash,
    status: success ? DepositTx.Status.CONFIRMED : DepositTx.Status.ERROR,
    txCostEthEquivalent: txCost,
  };
}

async function execute(deposit: Deposit): Promise<IDepositTxParams> {
  const depositContract = depositContractAt(deposit.depositAddress);
  const redemptionAddressIndex = deposit.redemptionAddressIndex || (await getNextBtcAddressIndex());
  const redemptionAddress = deposit.redemptionAddress || btcClient.getAddress(redemptionAddressIndex);
  const redeemerOutputScript = btcClient.addressToRedeemerScript(redemptionAddress);
  // TODO: add check for 'inVendingMachine' (see tbtc.js)
  // TODO: check tbtc balance
  const utxoValue = await depositContract.getUtxoValue();
  // TODO: compare with MINIMUM_REDEMPTION_FEE from TBTCConstants contract - is it necessary?
  const txFee = await btcClient.estimateSendFee(utxoValue, redemptionAddress);
  const outputValue = new BN(utxoValue).sub(new BN(txFee.toString()));
  const outputValueBytes = outputValue.toArrayLike(Buffer, 'le', 8);

  logger.debug(
    `Sending request redemption tx for deposit ${deposit.depositAddress} with params:\n${JSON.stringify(
      {
        address: deposit.depositAddress,
        redemptionAddress,
        outputValueBytes: outputValueBytes.toString(),
      },
      null,
      2
    )}`
  );

  const tx = await vendingMachine.tbtcToBtc(deposit.depositAddress, outputValueBytes, redeemerOutputScript);

  logger.debug(`Request redemption tx:\n${JSON.stringify(tx, null, 2)}`);

  await storeRedemptionAddress(deposit, redemptionAddress, redemptionAddressIndex);

  return {
    operationType,
    txHash: tx.hash,
    status: DepositTx.Status.BROADCASTED,
  };
}

async function getNextBtcAddressIndex(): Promise<number> {
  const [{ max }] = await getConnection()
    .createQueryBuilder()
    .select('MAX("redemptionAddressIndex") as max')
    .from(Deposit, 'd')
    .execute();

  return (max || 0) + 1;
}

async function storeRedemptionAddress(deposit: Deposit, address: string, index: number): Promise<void> {
  await getConnection().createEntityManager().update(
    Deposit,
    { depositAddress: deposit.depositAddress },
    {
      redemptionAddress: address,
      redemptionAddressIndex: index,
    }
  );
}

export default {
  operationType,
  confirm,
  execute,
};
