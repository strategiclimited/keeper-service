import { BigNumber, BigNumberish } from 'ethers';
import fetch from 'node-fetch';

import { ETH_DECIMALS, MINUTE_MILLIS } from '../constants';
import { createLogger } from '../logger';
import { bnToNumberEth, createTimedCache, numberToBnEth, satoshiToWei } from '../utils';

interface IPrices {
  bitcoin: {
    eth: number;
    usd: number;
  };
  ethereum: {
    btc: number;
    usd: number;
  };
}

const logger = createLogger('priceFeed');
const cache = createTimedCache<IPrices>(MINUTE_MILLIS);

async function convertSatoshiToWei(satoshi: BigNumberish): Promise<BigNumber> {
  const btcToEth = await fetchBtcToEth();
  const ratioWei = numberToBnEth(btcToEth);
  const satoshiInWei = satoshiToWei(satoshi);
  return satoshiInWei.mul(ratioWei).div(BigNumber.from(10).pow(ETH_DECIMALS));
}

async function convertWeiToUsd(wei: BigNumberish): Promise<number> {
  const ethToUsd = await fetchEthToUsd();
  const ratioWei = numberToBnEth(ethToUsd);
  const weiInUsd = BigNumber.from(wei).mul(ratioWei).div(BigNumber.from(10).pow(ETH_DECIMALS));
  return bnToNumberEth(weiInUsd);
}

async function convertSatoshiToUsd(satoshi: BigNumberish): Promise<number> {
  const satoshiInWei = await convertSatoshiToWei(satoshi);
  return convertWeiToUsd(satoshiInWei);
}

async function fetchEthToBtc(): Promise<number> {
  const prices = await fetchPrices();

  const rate = prices.ethereum.btc;
  logger.info(`ETH => BTC rate is: ${rate}`);

  return rate;
}

async function fetchBtcToEth(): Promise<number> {
  const prices = await fetchPrices();

  const rate = prices.bitcoin.eth;
  logger.info(`BTC => ETH rate is: ${rate}`);

  return rate;
}

async function fetchEthToUsd(): Promise<number> {
  const prices = await fetchPrices();

  const rate = prices.ethereum.usd;
  logger.info(`ETH => USD rate is: ${rate}`);

  return rate;
}

async function fetchBtcToUsd(): Promise<number> {
  const prices = await fetchPrices();

  const rate = prices.bitcoin.usd;
  logger.info(`BTC => USD rate is: ${rate}`);

  return rate;
}

async function fetchPrices(): Promise<IPrices> {
  const cacheKey = 'prices';
  const cachedVal = cache.get(cacheKey);

  if (cachedVal) {
    logger.debug(`Cached prices are: ${JSON.stringify(cachedVal)}`);
    return cachedVal;
  }

  logger.info('Fetching prices from coingecko...');
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=btc,eth,usd'
  );
  const json = await res.json();
  cache.put(cacheKey, json);

  logger.debug(`Prices are: ${JSON.stringify(json)}`);

  return json;
}

export default {
  convertSatoshiToWei,
  convertWeiToUsd,
  convertSatoshiToUsd,
  fetchBtcToEth,
  fetchBtcToUsd,
  fetchEthToBtc,
  fetchEthToUsd,
};
