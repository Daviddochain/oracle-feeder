import { SHA256 } from 'jscrypto/SHA256'
import { Any } from '@terra-money/terra.proto/google/protobuf/any'
import {
  MsgAggregateExchangeRatePrevote,
  MsgAggregateExchangeRateVote,
} from '@classic-terra/terra.proto/terra/oracle/v1beta1/tx'

import { JSONSerializable } from '@terra-money/terra.js/dist/util/json'
import { Coins } from '@terra-money/terra.js/dist/core/Coins'

export function aggregateVoteHash(exchangeRates: Coins, salt: string, validator: string): string {
  const payload = `${salt}:${exchangeRates.toDecCoins().toString()}:${validator}`
  return SHA256.hash(payload).toString().substring(0, 40)
}

export class MsgAggregateDoRatePrevote extends JSONSerializable<any, any, any> {
  public hash: string
  public feeder: string
  public validator: string

  constructor(hash: string, feeder: string, validator: string) {
    super()
    this.hash = hash
    this.feeder = feeder
    this.validator = validator
  }

  public toAmino() {
    return {
      type: 'oracle/MsgAggregateDoRatePrevote',
      value: {
        hash: this.hash,
        feeder: this.feeder,
        validator: this.validator,
      },
    }
  }

  public toData() {
    return {
      '@type': '/do.oracle.v1beta1.MsgAggregateDoRatePrevote',
      hash: this.hash,
      feeder: this.feeder,
      validator: this.validator,
    }
  }

  public toProto() {
    return MsgAggregateExchangeRatePrevote.fromPartial({
      hash: this.hash,
      feeder: this.feeder,
      validator: this.validator,
    })
  }

  public packAny(): Any {
    return Any.fromPartial({
      typeUrl: '/do.oracle.v1beta1.MsgAggregateDoRatePrevote',
      value: MsgAggregateExchangeRatePrevote.encode(this.toProto()).finish(),
    })
  }
}

export class MsgAggregateDoRateVote extends JSONSerializable<any, any, any> {
  public exchange_rates: Coins
  public salt: string
  public feeder: string
  public validator: string

  constructor(exchange_rates: Coins.Input, salt: string, feeder: string, validator: string) {
    super()
    this.exchange_rates = new Coins(exchange_rates).toDecCoins()
    this.salt = salt
    this.feeder = feeder
    this.validator = validator
  }

  public toAmino() {
    return {
      type: 'oracle/MsgAggregateDoRateVote',
      value: {
        exchange_rates: this.exchange_rates.toString(),
        salt: this.salt,
        feeder: this.feeder,
        validator: this.validator,
      },
    }
  }

  public toData() {
    return {
      '@type': '/do.oracle.v1beta1.MsgAggregateDoRateVote',
      exchange_rates: this.exchange_rates.toString(),
      salt: this.salt,
      feeder: this.feeder,
      validator: this.validator,
    }
  }

  public toProto() {
    return MsgAggregateExchangeRateVote.fromPartial({
      exchangeRates: this.exchange_rates.toString(),
      salt: this.salt,
      feeder: this.feeder,
      validator: this.validator,
    })
  }

  public getAggregateVoteHash(): string {
    return aggregateVoteHash(this.exchange_rates, this.salt, this.validator)
  }

  public getPrevote(): MsgAggregateDoRatePrevote {
    return new MsgAggregateDoRatePrevote(this.getAggregateVoteHash(), this.feeder, this.validator)
  }

  public packAny(): Any {
    return Any.fromPartial({
      typeUrl: '/do.oracle.v1beta1.MsgAggregateDoRateVote',
      value: MsgAggregateExchangeRateVote.encode(this.toProto()).finish(),
    })
  }
}
