import { ethers } from 'ethers';

import { ethClient } from '../clients';
import { IDepositContract, IFundingProof } from '../types';
import { satoshiToWei } from '../utils';
import getAbiAndAddress from './getKeepAbiAndAddress';

const { abi } = getAbiAndAddress('Deposit');

export default function getContractAt(address: string): IDepositContract {
  const contract = new ethers.Contract(address, abi, ethClient.defaultWallet);

  return {
    getKeepAddress,
    getLotSizeSatoshis,
    getSignerFeeTbtc,
    getStatusCode,
    getCollateralizationPercent,
    getUndercollateralizedThresholdPercent,
    getRedemptionCost,
    getRedemptionFee,
    getUtxoValue,
    provideRedemptionSignature,
    provideRedemptionProof,
    retrieveSignerPubkey,
    provideBTCFundingProof,
  };

  async function getKeepAddress() {
    const [keepAddress] = await contract.functions.keepAddress();
    return keepAddress.toLowerCase();
  }
  async function getLotSizeSatoshis() {
    const [lotSize] = await contract.functions.lotSizeSatoshis();
    return lotSize;
  }
  async function getSignerFeeTbtc() {
    const [fee] = await contract.functions.signerFeeTbtc();
    return fee;
  }
  async function getStatusCode() {
    const [state] = await contract.functions.currentState();
    return state.toNumber();
  }
  async function getCollateralizationPercent() {
    const [collateralization] = await contract.functions.collateralizationPercentage();
    return collateralization;
  }
  async function getUndercollateralizedThresholdPercent() {
    const [threshold] = await contract.functions.undercollateralizedThresholdPercent();
    return threshold;
  }
  async function getRedemptionCost() {
    const redemptionFee = await getRedemptionFee();
    const lotSizeSatoshis = await getLotSizeSatoshis();
    return satoshiToWei(lotSizeSatoshis).add(redemptionFee);
  }
  async function getRedemptionFee() {
    const [fee] = await contract.functions.getOwnerRedemptionTbtcRequirement(ethClient.defaultWallet.address);
    return fee;
  }
  async function getUtxoValue() {
    const [utxoVal] = await contract.functions.utxoValue();
    return utxoVal.toNumber();
  }
  async function provideRedemptionSignature(v: string, r: string, s: string) {
    return contract.functions.provideRedemptionSignature(v, r, s);
  }
  async function provideRedemptionProof({
    version,
    inputVector,
    outputVector,
    locktime,
    merkleProof,
    indexInBlock,
    bitcoinHeaders,
  }: IFundingProof) {
    return contract.functions.provideRedemptionProof(
      version,
      inputVector,
      outputVector,
      locktime,
      merkleProof,
      indexInBlock,
      bitcoinHeaders,
      { gasLimit: 1_000_000 }
    );
  }
  async function provideBTCFundingProof({
    version,
    inputVector,
    outputVector,
    locktime,
    outputPosition,
    merkleProof,
    indexInBlock,
    bitcoinHeaders,
  }: IFundingProof) {
    return contract.functions.provideBTCFundingProof(
      version,
      inputVector,
      outputVector,
      locktime,
      outputPosition,
      merkleProof,
      indexInBlock,
      bitcoinHeaders,
      { gasLimit: 1_000_000 }
    );
  }
  async function retrieveSignerPubkey() {
    return contract.functions.retrieveSignerPubkey();
  }
}
