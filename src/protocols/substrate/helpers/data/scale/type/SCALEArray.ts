import { SCALEType } from './SCALEType'
import { SCALECompactInt } from './SCALECompactInt'
import { DecoderMethod, SCALEDecodeResult } from '../SCALEDecoder'
import { stripHexPrefix } from '../../../../../../utils/hex'
import { SubstrateNetwork } from '../../../../SubstrateNetwork'

export class SCALEArray<T extends SCALEType> extends SCALEType {
  public static from<T extends SCALEType>(elements: T[]): SCALEArray<T> {
    return new SCALEArray(elements)
  }

  public static decode<T extends SCALEType>(
    network: SubstrateNetwork,
    hex: string,
    decodeElement: DecoderMethod<T>
  ): SCALEDecodeResult<SCALEArray<T>> {
    let _hex = stripHexPrefix(hex)

    const arrayLength = SCALECompactInt.decode(_hex)

    _hex = _hex.slice(arrayLength.bytesDecoded * 2)

    const elements: T[] = []
    let bytesDecoded = 0
    for (let i = 0; i < arrayLength.decoded.toNumber(); i++) {
      const element = decodeElement(network, _hex)
      elements.push(element.decoded)
      bytesDecoded += element.bytesDecoded
      _hex = _hex.slice(element.bytesDecoded * 2)
    }

    return {
      bytesDecoded: arrayLength.bytesDecoded + bytesDecoded,
      decoded: SCALEArray.from(elements)
    }
  }

  protected constructor(readonly elements: T[]) {
    super()
  }

  public toString(): string {
    return JSON.stringify(
      this.elements.map((element) => {
        let elementString = element.toString()
        try {
          elementString = JSON.parse(elementString)
        } catch {}

        return elementString
      })
    )
  }

  protected _encode(): string {
    return SCALECompactInt.from(this.elements.length).encode() + this.elements.map((element) => element.encode()).join('')
  }
}
