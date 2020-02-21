import { MetadataModule } from "./module/MetadataModule"
import { SCALEClass } from "../codec/type/SCALEClass";
import { SCALEInt } from "../codec/type/SCALEInt";
import { SCALEArray } from "../codec/type/SCALEArray";
import { SCALEDecoder } from "../codec/SCALEDecoder";

const MAGIC_NUMBER = '6174656d' // `meta` in hex
const EXPECTED_VERSION = 11

export interface ExtrinsicId {
    moduleIndex: number,
    callIndex: number
}
export class Metadata extends SCALEClass {

    public static decode(raw: string): Metadata {
        const decoder = new SCALEDecoder(raw)

        const magicNumber = decoder.decodeNextInt(32) // 32 bits
        this.assertMagicNumber(magicNumber.decoded.toNumber())

        const version = decoder.decodeNextInt(8) // 8 bits
        this.assertVersion(version.decoded.toNumber())

        const modules = decoder.decodeNextArray(MetadataModule.decode)

        return new Metadata(magicNumber.decoded, version.decoded, modules.decoded)
    }

    private static assertMagicNumber(magicNumber: number) {
        if (magicNumber !== parseInt(MAGIC_NUMBER, 16)) {
            throw new Error('Error while parsing metadata, invalid magic number')
        }
    }

    private static assertVersion(version: number) {
        if (version !== EXPECTED_VERSION) {
            throw new Error(`Error while parsing metadata, metadata version ${EXPECTED_VERSION} was expected, got ${version}`)
        }
    }

    protected scaleFields = [this.magicNumber, this.version, this.modules]

    private readonly extrinsicIds: Map<string, ExtrinsicId> = new Map()
    private readonly constants: Map<string, string> = new Map()

    private constructor(
        readonly magicNumber: SCALEInt,
        readonly version: SCALEInt,
        readonly modules: SCALEArray<MetadataModule>
    ) { 
        super()
        this.flattenThenPopulateMap(
            this.extrinsicIds,
            modules.elements
                .filter(module => module.hasCalls)
                .map((module, moduleIndex) => module.calls.value.elements.map((call, callIndex) => [
                    `${module.name.toCamelCase()}_${call.name.toCamelCase()}`, 
                    { moduleIndex, callIndex }
                ] as [string, ExtrinsicId]))
        )

        this.flattenThenPopulateMap(
            this.constants,
            modules.elements
                .map(module => module.constants.elements.map(constant => [
                    `${module.name.toCamelCase()}_${constant.name.toCamelCase({ startUpper: true })}`,
                    constant.value.toString()
                ] as [string, string]))
        )
    }

    public hasExtrinsicId(endpoint: string): boolean {
        return !!this.extrinsicIds.get(endpoint)
    }

    public getExtrinsicId(endpoint: string): ExtrinsicId {
        return this.extrinsicIds.get(endpoint)!
    }

    public hasConstant(name: string): boolean {
        return !!this.constants.get(name)
    }

    public getConstant(name: string): string {
        return this.constants.get(name)!
    }

    private flattenThenPopulateMap<K, V>(map: Map<K, V>, pairs: [K, V][][]) {
        pairs
            .reduce((flatten, toFlatten) => flatten.concat(toFlatten), [])
            .forEach(([key, value]: [K, V]) => map.set(key, value))
    }
}