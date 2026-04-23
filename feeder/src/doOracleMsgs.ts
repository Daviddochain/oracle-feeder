import { SHA256 } from 'jscrypto/SHA256'
import { Any } from '@terra-money/terra.proto/google/protobuf/any'
import {
  MsgAggregateExchangeRatePrevote as ProtoPrevote,
  MsgAggregateExchangeRateVote as ProtoVote,
} from '@classic-terra/terra.proto/terra/oracle/v1beta1/tx'

import { JSONSerializable } from '@terra-money/terra.js/dist/util/json'
import { Coins } from '@terra-money/terra.js/dist/core/Coins'

export function aggregateVoteHash(
  exchangeRates: Coins,
  salt: string,
  validator: string,
): string {
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

  public static fromAmino(data: {
    value: { hash: string; feeder: string; validator: string }
  }): MsgAggregateDoRatePrevote {
    const {
      value: { hash, feeder, validator },
    } = data
    return new MsgAggregateDoRatePrevote(hash, feeder, validator)
  }

  public static fromData(data: {
    '@type'?: string
    hash: string
    feeder: string
    validator: string
  }): MsgAggregateDoRatePrevote {
    const { hash, feeder, validator } = data
    return new MsgAggregateDoRatePrevote(hash, feeder, validator)
  }

  public static fromProto(proto: ProtoPrevote): MsgAggregateDoRatePrevote {
    return new MsgAggregateDoRatePrevote(proto.hash, proto.feeder, proto.validator)
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

  public toProto(): ProtoPrevote {
    return ProtoPrevote.fromPartial({
      hash: this.hash,
      feeder: this.feeder,
      validator: this.validator,
    })
  }

  public packAny(): Any {
    return Any.fromPartial({
      typeUrl: '/do.oracle.v1beta1.MsgAggregateDoRatePrevote',
      value: ProtoPrevote.encode(this.toProto()).finish(),
    })
  }
}

export class MsgAggregateDoRateVote extends JSONSerializable<any, any, any> {
  public salt: string
  public exchange_rates: Coins
  public feeder: string
  public validator: string

  constructor(
    salt: string,
    exchange_rates: Coins.Input,
    feeder: string,
    validator: string,
  ) {
    super()
    this.salt = salt
    this.exchange_rates = new Coins(exchange_rates)
    this.feeder = feeder
    this.validator = validator
  }

  public static fromAmino(data: {
    value: {
      salt: string
      exchange_rates: string
      feeder: string
      validator: string
    }
  }): MsgAggregateDoRateVote {
    const {
      value: { salt, exchange_rates, feeder, validator },
    } = data
    return new MsgAggregateDoRateVote(salt, exchange_rates, feeder, validator)
  }

  public static fromData(data: {
    '@type'?: string
    salt: string
    exchange_rates: string
    feeder: string
    validator: string
  }): MsgAggregateDoRateVote {
    const { salt, exchange_rates, feeder, validator } = data
    return new MsgAggregateDoRateVote(salt, exchange_rates, feeder, validator)
  }

  public static fromProto(proto: ProtoVote): MsgAggregateDoRateVote {
    return new MsgAggregateDoRateVote(
      proto.salt,
      proto.exchangeRates,
      proto.feeder,
      proto.validator,
    )
  }

  public toAmino() {
    return {
      type: 'oracle/MsgAggregateDoRateVote',
      value: {
        salt: this.salt,
        exchange_rates: this.exchange_rates.toDecCoins().toString(),
        feeder: this.feeder,
        validator: this.validator,
      },
    }
  }

  public toData() {
    return {
      '@type': '/do.oracle.v1beta1.MsgAggregateDoRateVote',
      salt: this.salt,
      exchange_rates: this.exchange_rates.toDecCoins().toString(),
      feeder: this.feeder,
      validator: this.validator,
    }
  }

  public toProto(): ProtoVote {
    return ProtoVote.fromPartial({
      salt: this.salt,
      exchangeRates: this.exchange_rates.toDecCoins().toString(),
      feeder: this.feeder,
      validator: this.validator,
    })
  }

  public packAny(): Any {
    return Any.fromPartial({
      typeUrl: '/do.oracle.v1beta1.MsgAggregateDoRateVote',
      value: ProtoVote.encode(this.toProto()).finish(),
    })
  }
}
