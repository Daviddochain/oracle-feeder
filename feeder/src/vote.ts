import * as crypto from 'crypto'
import * as Bluebird from 'bluebird'
import * as promptly from 'promptly'
import * as http from 'http'
import * as https from 'https'
import axios from 'axios'
import { bech32 } from 'bech32'
import * as ks from './keystore'
import { LCDClient, RawKey, Wallet, isTxError, LCDClientConfig, Fee } from '@terra-money/terra.js'
import * as packageInfo from '../package.json'
import * as logger from './logger'
import { MsgAggregateDoRatePrevote, MsgAggregateDoRateVote, aggregateVoteHash } from './doOracleMsgs'

const ax = axios.create({
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
  timeout: 10000,
  headers: {
    post: {
      'Content-Type': 'application/json',
    },
  },
})

async function initKey(keyPath: string, name: string, password?: string): Promise<RawKey> {
  const plainEntity = ks.load(
    keyPath,
    name,
    password || (await promptly.password(`Enter a passphrase:`, { replace: `*` }))
  )

  return new RawKey(Buffer.from(plainEntity.privateKey, 'hex'))
}

function convertBech32Prefix(addr: string, prefix: string): string {
  const decoded = bech32.decode(addr)
  return bech32.encode(prefix, decoded.words)
}

interface OracleParameters {
  oracleVotePeriod: number
  oracleWhitelist: string[]
  currentVotePeriod: number
  indexInVotePeriod: number
  nextBlockHeight: number
}

async function loadOracleParams(client: LCDClient): Promise<OracleParameters> {
  const lcdBase = Array.isArray((client as any).config?.URL)
    ? (client as any).config.URL[0]
    : (client as any).config?.URL || (client as any).config?.lcd || 'http://127.0.0.1:1317'

  const oracleParamsRes = await ax.get(`${lcdBase}/do/oracle/v1beta1/params`)
  const oracleParams = oracleParamsRes.data.params

  const oracleVotePeriod = parseInt(oracleParams.vote_period, 10)
  const oracleWhitelist: string[] = oracleParams.whitelist.map((e: any) => e.name)

  const latestBlockRes = await ax.get(`${lcdBase}/cosmos/base/tendermint/v1beta1/blocks/latest`)
  const blockHeight = parseInt(latestBlockRes.data.block.header.height, 10)

  const nextBlockHeight = blockHeight + 1
  const currentVotePeriod = Math.floor(blockHeight / oracleVotePeriod)
  const indexInVotePeriod = nextBlockHeight % oracleVotePeriod

  return {
    oracleVotePeriod,
    oracleWhitelist,
    currentVotePeriod,
    indexInVotePeriod,
    nextBlockHeight,
  }
}

interface Price {
  denom: string
  price: string
}

async function getPrices(sources: string[]): Promise<Price[]> {
  const results = await Bluebird.some(
    sources.map((s) => ax.get(s)),
    1
  ).then((responses: any[]) =>
    responses.filter(({ data }) => {
      if (typeof data.created_at !== 'string' || !Array.isArray(data.prices) || !data.prices.length) {
        logger.error('getPrices: invalid response')
        return false
      }

      if (Date.now() - new Date(data.created_at).getTime() > 60 * 1000) {
        logger.error('getPrices: too old')
        return false
      }

      return true
    })
  )

  if (!results.length) {
    return []
  }

  return results[0].data.prices
}

/**
 * preparePrices traverses prices array for following logics:
 * 1. Removes prices that cannot be found in oracle whitelist
 * 2. Fills abstain prices for whitelist denoms missing from the price source
 * 3. Maps DO/USD directly to udo for DoChain
 */
function preparePrices(prices: Price[], oracleWhitelist: string[]): Price[] {
  const doPrice = prices.find((p) => p.denom === 'DO')

  if (!doPrice) {
    throw new Error('cannot find DO price')
  }

  const newPrices = prices
    .map((price) => {
      const whitelistDenom = `u${price.denom.toLowerCase()}`

      if (oracleWhitelist.indexOf(whitelistDenom) === -1) {
        return undefined
      }

      return {
        denom: price.denom,
        price: price.price,
      }
    })
    .filter(Boolean) as Price[]

  oracleWhitelist.forEach((denom) => {
    const found = newPrices.some((price) => denom === `u${price.denom.toLowerCase()}`)

    if (!found) {
      newPrices.push({
        denom: denom.slice(1).toUpperCase(),
        price: '0.000000',
      })
    }
  })

  return newPrices
}

function buildVoteMsgs(prices: Price[], valAddrs: string[], voterAddr: string): MsgAggregateDoRateVote[] {
  const coins = prices.map(({ denom, price }) => `${price}u${denom.toLowerCase()}`).join(',')

  return valAddrs.map((valAddr) => {
    const salt = crypto.randomBytes(2).toString('hex')
    return new MsgAggregateDoRateVote(salt, coins, voterAddr, valAddr)
  })
}

let previousVoteMsgs: MsgAggregateDoRateVote[] = []
let previousVotePeriod = 0

interface VoteArgs {
  lcdUrl: string[]
  prefix: string
  chainID: string
  validators: string[]
  dataSourceUrl: string[]
  password: string
  keyPath: string
  keyName: string
}

export async function processVote(
  client: LCDClient,
  wallet: Wallet,
  args: VoteArgs,
  valAddrs: string[],
  voterAddr: string
): Promise<void> {
  logger.info(`[VOTE] Requesting on chain data`)
  const { oracleVotePeriod, oracleWhitelist, currentVotePeriod, indexInVotePeriod, nextBlockHeight } =
    await loadOracleParams(client)

  if ((previousVotePeriod && currentVotePeriod === previousVotePeriod) || oracleVotePeriod - indexInVotePeriod < 2) {
    return
  }

  if (previousVotePeriod && currentVotePeriod - previousVotePeriod !== 1) {
    throw new Error('Failed to Reveal Exchange Rates; reset to prevote')
  }

  logger.info(`[VOTE] Requesting prices from price server ${args.dataSourceUrl.join(',')}`)
  const _prices = await getPrices(args.dataSourceUrl)
  const prices = preparePrices(_prices, oracleWhitelist)
  const voteMsgs: MsgAggregateDoRateVote[] = buildVoteMsgs(prices, valAddrs, voterAddr)

  const isPrevoteOnlyTx = previousVoteMsgs.length === 0

  const prevoteMsgs: MsgAggregateDoRatePrevote[] = voteMsgs.map((vm) => {
    const hash = aggregateVoteHash(vm.exchange_rates, vm.salt, vm.validator)
    return new MsgAggregateDoRatePrevote(hash, vm.feeder, vm.validator)
  })

  const msgs: any[] = [...previousVoteMsgs, ...prevoteMsgs]
  logger.info(`[${isPrevoteOnlyTx ? 'PREVOTE' : 'VOTE'}] msg: ${JSON.stringify(msgs)}\n`)

  const tx = await wallet.createAndSignTx({
    msgs: msgs as any,
    fee: new Fee((1 + msgs.length) * 100_000, []),
    memo: `${packageInfo.name}@${packageInfo.version}`,
  } as any)

  const res = await client.tx.broadcastSync(tx).catch((err: any) => {
    logger.error(`broadcast error: ${err.message} ${tx.toData((client as any).config?.isClassic)}`)
    throw err
  })

  if (isTxError(res)) {
    logger.error(`broadcast error: code: ${res.code}, raw_log: ${res.raw_log}`)
    return
  }

  const txhash = res.txhash
  logger.info(`[VOTE] Broadcast success ${txhash}`)

  const height = await validateTx(
    client,
    nextBlockHeight,
    txhash,
    args,
    isPrevoteOnlyTx ? oracleVotePeriod * 2 : oracleVotePeriod - indexInVotePeriod
  )

  previousVotePeriod = Math.floor(height / oracleVotePeriod)
  previousVoteMsgs = voteMsgs
}

async function validateTx(
  client: LCDClient,
  nextBlockHeight: number,
  txhash: string,
  _args: VoteArgs,
  timeoutHeight: number
): Promise<number> {
  let inclusionHeight = 0

  const maxBlockHeight = nextBlockHeight + timeoutHeight
  let lastCheckHeight = nextBlockHeight - 1

  const lcdBase = Array.isArray((client as any).config?.URL)
    ? (client as any).config.URL[0]
    : (client as any).config?.URL || (client as any).config?.lcd || 'http://127.0.0.1:1317'

  while (!inclusionHeight && lastCheckHeight < maxBlockHeight) {
    await Bluebird.delay(1500)

    const lastBlock = await client.tendermint.blockInfo()
    const latestBlockHeight = parseInt(lastBlock.block.header.height, 10)

    if (latestBlockHeight <= lastCheckHeight) {
      continue
    }

    lastCheckHeight = latestBlockHeight

    try {
      const res = await ax.get(`${lcdBase}/cosmos/tx/v1beta1/txs/${txhash}`)
      const txResponse = res?.data?.tx_response

      if (!txResponse) {
        continue
      }

      const height = parseInt(txResponse.height, 10) || latestBlockHeight
      const code = Number(txResponse.code || 0)
      const rawLog = txResponse.raw_log || ''

      if (code !== 0) {
        throw new Error(`[VOTE]: transaction failed tx: code: ${code}, raw_log: ${rawLog}`)
      }

      inclusionHeight = height
      break
    } catch (err: any) {
      const status = err?.response?.status

      if (status === 404) {
        continue
      }

      if (err?.isAxiosError && !err?.response) {
        logger.error('tx query network error', err.message)
        continue
      }

      if (err instanceof Error) {
        throw err
      }

      throw new Error(String(err))
    }
  }

  if (!inclusionHeight) {
    throw new Error(`[VOTE] tx confirmation timeout for ${txhash} by height ${lastCheckHeight}`)
  }

  logger.info(`[VOTE] Included at height: ${inclusionHeight}`)
  return inclusionHeight
}

function getAccPrefix(args: VoteArgs): string {
  return args.prefix || process.env.ORACLE_FEEDER_ADDR_PREFIX || 'do'
}

function getValoperPrefix(args: VoteArgs): string {
  return process.env.ORACLE_FEEDER_VALOPER_PREFIX || `${getAccPrefix(args)}valoper`
}

function getFeeDenom(args: VoteArgs): string {
  return process.env.ORACLE_FEEDER_GAS_DENOM || `u${getAccPrefix(args)}`
}

function getGasPrice(): number {
  const gasPrice = Number(process.env.ORACLE_FEEDER_GAS_PRICE || '0.0015')
  return Number.isFinite(gasPrice) && gasPrice > 0 ? gasPrice : 0.0015
}

function normalizeValidatorAddresses(args: VoteArgs, rawKey: RawKey): string[] {
  const valoperPrefix = getValoperPrefix(args)
  const configuredValidators = args.validators && args.validators.length ? args.validators : [((rawKey as any).valAddress || '')]

  return configuredValidators.map((addr) => convertBech32Prefix(addr, valoperPrefix))
}

function buildLCDClientConfig(args: VoteArgs, lcdIndex: number): Record<string, LCDClientConfig> {
  return {
    [args.chainID]: {
      URL: args.lcdUrl[lcdIndex],
      chainID: args.chainID,
      gasAdjustment: '1.5',
      gasPrices: { [getFeeDenom(args)]: getGasPrice() },
      isClassic: true,
    },
  }
}

export async function vote(args: VoteArgs): Promise<void> {
  const rawKey: RawKey = await initKey(args.keyPath, args.keyName, args.password)
  const accPrefix = getAccPrefix(args)
  const valAddrs: string[] = normalizeValidatorAddresses(args, rawKey)
  Object.defineProperty(rawKey, 'accAddress', { value: convertBech32Prefix((rawKey as any).accAddress, accPrefix) })

  const voterAddr = (rawKey as any).accAddress

  const lcdRotate = {
    client: new LCDClient(buildLCDClientConfig(args, 0)[args.chainID]),
    current: 0,
    max: args.lcdUrl.length - 1,
  }

  while (true) {
    const startTime = Date.now()

    await processVote(lcdRotate.client, lcdRotate.client.wallet(rawKey), args, valAddrs, voterAddr).catch((err: any) => {
      if (err.isAxiosError && err.response) {
        logger.error(err.message, err.response.data)
      } else {
        logger.error(err)
      }

      if (err.isAxiosError) {
        logger.info('vote: lcd client unavailable, rotating to next lcd client.')
        rotateLCD(args, lcdRotate)
      }

      resetPrevote()
    })

    await Bluebird.delay(Math.max(500, 500 - (Date.now() - startTime)))
  }
}

function rotateLCD(args: VoteArgs, lcdRotate: { client: LCDClient; current: number; max: number }) {
  if (++lcdRotate.current > lcdRotate.max) {
    lcdRotate.current = 0
  }

  lcdRotate.client = new LCDClient(buildLCDClientConfig(args, lcdRotate.current)[args.chainID])
  logger.info('Switched to LCD address ' + lcdRotate.current + '(' + args.lcdUrl[lcdRotate.current] + ')')
}

function resetPrevote() {
  previousVotePeriod = 0
  previousVoteMsgs = []
}