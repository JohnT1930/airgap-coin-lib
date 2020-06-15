import { SCALEInt } from '../scale/type/SCALEInt'
import { SCALEDecoder } from '../scale/SCALEDecoder'
import { SCALEOptional } from '../scale/type/SCALEOptional'
import { SubstrateNetwork } from '../../../SubstrateNetwork'

export class SubstrateActiveEraInfo {
  public static decode(network: SubstrateNetwork, raw: string): SubstrateActiveEraInfo {
    const decoder = new SCALEDecoder(network, raw)

    const index = decoder.decodeNextInt(32)
    const start = decoder.decodeNextOptional((_, hex) => SCALEInt.decode(hex, 64))

    return new SubstrateActiveEraInfo(index.decoded, start.decoded)
  }

  private constructor(readonly index: SCALEInt, readonly start: SCALEOptional<SCALEInt>) {}
}
