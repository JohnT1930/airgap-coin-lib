import BigNumber from '../../../../../../dependencies/src/bignumber.js-9.0.0/bignumber'
import { stripHexPrefix, toHexStringRaw } from '../../../../../../utils/hex'
import { SubstrateCompatAddressType } from '../../../../compat/SubstrateCompatAddress'
import { SubstrateNetwork } from '../../../../SubstrateNetwork'
import { SCALEDecodeResult } from '../SCALEDecoder'

import { SCALEAccountId } from './SCALEAccountId'
import { SCALEBytes } from './SCALEBytes'
import { SCALEHash } from './SCALEHash'
import { SCALEInt } from './SCALEInt'
import { SCALEEncodeConfig, SCALEType } from './SCALEType'

export enum SCALEMultiAddressType {
  Id = 0,
  Index,
  Raw,
  Address32,
  Address20
}

type SCALEMultiAddressValue<T extends SCALEMultiAddressType, Network extends SubstrateNetwork> = T extends SCALEMultiAddressType.Id
  ? SCALEAccountId<Network>
  : T extends SCALEMultiAddressType.Index
  ? SCALEInt
  : T extends SCALEMultiAddressType.Raw
  ? SCALEBytes
  : T extends SCALEMultiAddressType.Address32
  ? SCALEHash
  : T extends SCALEMultiAddressType.Address20
  ? SCALEHash
  : never

export class SCALEMultiAddress<T extends SCALEMultiAddressType, Network extends SubstrateNetwork> extends SCALEType {
  public static isOfType<T extends SCALEMultiAddressType, Network extends SubstrateNetwork>(
    multiAddress: SCALEMultiAddress<SCALEMultiAddressType, Network>,
    type: T
  ): multiAddress is SCALEMultiAddress<T, Network> {
    return multiAddress.type === type
  }

  public static from<Network extends SubstrateNetwork>(
    value: number | string | BigNumber,
    type: SCALEMultiAddressType.Index,
    network: Network
  ): SCALEMultiAddress<SCALEMultiAddressType.Index, Network>
  public static from<T extends Exclude<SCALEMultiAddressType, SCALEMultiAddressType.Index>, Network extends SubstrateNetwork>(
    value: string | Uint8Array | Buffer | SubstrateCompatAddressType[Network],
    type: T,
    network: Network
  ): SCALEMultiAddress<T, Network>
  public static from<T extends SCALEMultiAddressType, Network extends SubstrateNetwork>(
    value: number | string | BigNumber | Uint8Array | Buffer | SubstrateCompatAddressType[Network],
    type: T,
    network: Network
  ): SCALEMultiAddress<T, Network> {
    switch (type) {
      case SCALEMultiAddressType.Id:
        if (typeof value === 'number' || BigNumber.isBigNumber(value)) {
          throw new Error('SCALEMultiAddress#from: Invalid multi address value')
        }

        return new SCALEMultiAddress(type, SCALEAccountId.from(value, network) as SCALEMultiAddressValue<T, Network>)
      case SCALEMultiAddressType.Index:
        if (typeof value !== 'number' && !BigNumber.isBigNumber(value)) {
          throw new Error('SCALEMultiAddress#from: Invalid multi address value')
        }

        return new SCALEMultiAddress(type, SCALEInt.from(value) as SCALEMultiAddressValue<T, Network>)

      case SCALEMultiAddressType.Raw:
      case SCALEMultiAddressType.Address32:
      case SCALEMultiAddressType.Address20:
        throw new Error(`SCALEMultiAddress#from: Multi address type ${SCALEMultiAddressType[type]} not supported`)
      default:
        throw new Error('SCALEMultiAddress#from: Unknown multi address type')
    }
  }

  public static decode<Network extends SubstrateNetwork, T extends SCALEMultiAddressType = SCALEMultiAddressType>(
    network: SubstrateNetwork,
    hex: string,
    type?: T,
    runtimeVersion?: number
  ): SCALEDecodeResult<SCALEMultiAddress<T, Network>> {
    const _hex = stripHexPrefix(hex)
    const prefix = parseInt(_hex.substr(0, 2), 16)
    if (type !== undefined && prefix !== type) {
      throw new Error(`SCALEMultiAddress#decode: Unexpected multi address type ${SCALEMultiAddressType[prefix]}`)
    }

    switch (prefix) {
      case SCALEMultiAddressType.Id:
        const id = SCALEAccountId.decode(network, _hex.slice(2))

        return {
          bytesDecoded: id.bytesDecoded + 1,
          decoded: new SCALEMultiAddress(SCALEMultiAddressType.Id, id.decoded) as SCALEMultiAddress<T, Network>
        }
      case SCALEMultiAddressType.Index:
        const index = SCALEInt.decode(_hex.slice(2), 32)

        return {
          bytesDecoded: index.bytesDecoded + 1,
          decoded: new SCALEMultiAddress(SCALEMultiAddressType.Index, index.decoded) as SCALEMultiAddress<T, Network>
        }
      case SCALEMultiAddressType.Raw:
        const bytes = SCALEBytes.decode(_hex.slice(2))

        return {
          bytesDecoded: bytes.bytesDecoded + 1,
          decoded: new SCALEMultiAddress(SCALEMultiAddressType.Raw, bytes.decoded) as SCALEMultiAddress<T, Network>
        }
      case SCALEMultiAddressType.Address32:
        const bytes32 = SCALEHash.decode(_hex.slice(2), 32)

        return {
          bytesDecoded: bytes32.bytesDecoded + 1,
          decoded: new SCALEMultiAddress(SCALEMultiAddressType.Address32, bytes32.decoded) as SCALEMultiAddress<T, Network>
        }
      case SCALEMultiAddressType.Address20:
        const bytes20 = SCALEHash.decode(_hex.slice(2), 20)

        return {
          bytesDecoded: bytes20.bytesDecoded + 1,
          decoded: new SCALEMultiAddress(SCALEMultiAddressType.Address20, bytes20.decoded) as SCALEMultiAddress<T, Network>
        }
      default:
        const accountId = SCALEAccountId.decode(network, _hex)

        return {
          bytesDecoded: accountId.bytesDecoded,
          decoded: new SCALEMultiAddress(SCALEMultiAddressType.Id, accountId.decoded) as SCALEMultiAddress<T, Network>
        }
    }
  }

  private constructor(readonly type: T, readonly value: SCALEMultiAddressValue<T, Network>) {
    super()
  }

  public toString(): string {
    return this.value.toString()
  }

  public asAddress(): string {
    switch (this.type) {
      case SCALEMultiAddressType.Id:
        return (this.value as SCALEAccountId<Network>).asAddress()
      default:
        return this.value.toString()
    }
  }

  public asBytes(): Buffer {
    switch (this.type) {
      case SCALEMultiAddressType.Id:
        return (this.value as SCALEAccountId<Network>).asBytes()
      case SCALEMultiAddressType.Index:
        return Buffer.from((this.value as SCALEInt).toString(16), 'hex')
      default:
        return Buffer.from(this.value.toString(), 'hex')
    }
  }

  protected _encode(config?: SCALEEncodeConfig): string {
    return toHexStringRaw(this.type, 2) + (this.value?.encode(config) ?? '')
  }
}
