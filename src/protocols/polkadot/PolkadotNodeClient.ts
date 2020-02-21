import axios, { AxiosResponse } from '../../dependencies/src/axios-0.19.0'
import BigNumber from '../../dependencies/src/bignumber.js-9.0.0/bignumber'

import { RPCBody } from '../../data/RPCBody'
import { xxhashAsHex } from '../../utils/xxhash'
import { blake2bAsHex } from '../../utils/blake2b'
import { hexToBigNumber, stripHexPrefix, toHexString, addHexPrefix } from '../../utils/hex'
import { isString } from 'util'
import { PolkadotTransactionType } from './transaction/PolkadotTransaction'
import { Metadata, ExtrinsicId } from './metadata/Metadata'
import { SCALEInt } from './codec/type/SCALEInt'

const RPC_ENDPOINTS = {
    GET_METADATA: 'state_getMetadata',
    GET_STORAGE: 'state_getStorage',
    GET_BLOCK: 'chain_getBlock',
    GET_BLOCK_HASH: 'chain_getBlockHash',
    GET_RUNTIME_VERSION: 'state_getRuntimeVersion',
    SUBMIT_EXTRINSIC: 'author_submitExtrinsic'
}

const RPC_EXTRINSIC = {
    TRANSFER: 'balances_transfer',
    BOND: 'staking_bond',
    UNBOND: 'staking_unbond',
    NOMINATE: 'staking_nominate',
    CHILL: 'staking_chill'
}

const RPC_CONSTANTS = {
    TRANSFER_FEE: 'balances_TransferFee',
    TRANSACTION_BASE_FEE: 'transactionPayment_TransactionBaseFee',
    TRANSACTION_BYTE_FEE: 'transactionPayment_TransactionByteFee'
}

const methodEndpoints: Map<PolkadotTransactionType, string> = new Map([
    [PolkadotTransactionType.TRANSFER, RPC_EXTRINSIC.TRANSFER],
    [PolkadotTransactionType.BOND, RPC_EXTRINSIC.BOND],
    [PolkadotTransactionType.UNBOND, RPC_EXTRINSIC.UNBOND],
    [PolkadotTransactionType.NOMINATE, RPC_EXTRINSIC.NOMINATE],
    [PolkadotTransactionType.STOP_NOMINATING, RPC_EXTRINSIC.CHILL]
])

class StorageKeyUtil {
    private static readonly PREFIX_TRIE_HASH_SIZE = 128
    private static readonly ITEM_HASH_SIZE = 256

    private readonly storageKeys: Map<string, string> = new Map()

    public getKey(moduleName: string, storageName: string, firstKey: Uint8Array | string | null = null, secondKey: Uint8Array | string | null = null): string {
        const rawKey = moduleName + storageName + (firstKey || '') + (secondKey || '')

        if (!this.storageKeys[rawKey]) {
            this.storageKeys[rawKey] = this.generatePrefixTrie(moduleName, storageName) + this.generateItemHash(firstKey, secondKey)
        }

        return this.storageKeys[rawKey]
    }

    private generatePrefixTrie(moduleName: string, storageName: string): string {
        const moduleHash = xxhashAsHex(moduleName, StorageKeyUtil.PREFIX_TRIE_HASH_SIZE)
        const storageHash = xxhashAsHex(storageName, StorageKeyUtil.PREFIX_TRIE_HASH_SIZE)
        
        return moduleHash + storageHash
    }

    private generateItemHash(firstKey: Uint8Array | string | null, secondKey: Uint8Array | string | null): string {
        const firstKeyHash = firstKey ? blake2bAsHex(firstKey, StorageKeyUtil.ITEM_HASH_SIZE) : ''
        const secondKeyHash = secondKey ? blake2bAsHex(secondKey, StorageKeyUtil.ITEM_HASH_SIZE) : ''

        return firstKeyHash + secondKeyHash
    }
}

export class PolkadotNodeClient {
    private metadata: Metadata | null = null

    constructor(
        private readonly baseURL: string, 
        private readonly storageKeyUtil: StorageKeyUtil = new StorageKeyUtil()
    ) {}

    public getBalance(accountId: Uint8Array): Promise<BigNumber> {
        return this.send<BigNumber, (string | null)>(
            RPC_ENDPOINTS.GET_STORAGE, 
            [this.storageKeyUtil.getKey('Balances', 'FreeBalance', accountId)], 
            result => hexToBigNumber(result, { littleEndian: true })
        )
    }

    public async getTransactionMetadata(type: PolkadotTransactionType): Promise<ExtrinsicId | null> {
        const rpcEndpoint = methodEndpoints.get(type) || ''
        try {
            if (!this.metadata) {
                await this.fetchMetadata()
            }

            return (this.metadata && this.metadata.hasExtrinsicId(rpcEndpoint)) 
                ? this.metadata!.getExtrinsicId(rpcEndpoint) 
                : null
        } catch (e) {
            return null
        }
    }

    public getTransferFee(): Promise<BigNumber | null> {
        return this.getFee(RPC_CONSTANTS.TRANSFER_FEE)
    }

    public getTransactionBaseFee(): Promise<BigNumber | null> {
        return this.getFee(RPC_CONSTANTS.TRANSACTION_BASE_FEE)
    }

    public getTransactionByteFee(): Promise<BigNumber | null> {
        return this.getFee(RPC_CONSTANTS.TRANSACTION_BYTE_FEE)
    }

    public getNonce(accountId: Uint8Array | string): Promise<BigNumber> {
        const accountIdU8a = isString(accountId) ? Buffer.from(accountId, 'hex') : accountId
        return this.send<BigNumber, (string | null)>(
            RPC_ENDPOINTS.GET_STORAGE,
            [this.storageKeyUtil.getKey('System', 'AccountNonce', accountIdU8a)],
            result => hexToBigNumber(result, { littleEndian: true })
        )
    }

    public getFirstBlockHash(): Promise<string | null> {
        return this.getBlockHash(0)
    }

    public getLastBlockHash(): Promise<string | null> {
        return this.getBlockHash()
    }

    public getCurrentHeight(): Promise<BigNumber> {
        return this.send<BigNumber, any>(
            RPC_ENDPOINTS.GET_BLOCK,
            [],
            result => new BigNumber(stripHexPrefix(result.block.header.number), 16)
        )
    }

    public getSpecVersion(): Promise<number> {
        return this.send<number, any>(
            RPC_ENDPOINTS.GET_RUNTIME_VERSION,
            [],
            result => result.specVersion
        )
    }

    public submitTransaction(encoded: string): Promise<string | null> {
        return this.send<string, (string | null)>(
            RPC_ENDPOINTS.SUBMIT_EXTRINSIC,
            [encoded]
        )
    }

    private async getFee(name: string): Promise<BigNumber | null> {
        try {
            if (!this.metadata) {
                await this.fetchMetadata()
            }

            const fee = (this.metadata && this.metadata.hasConstant(name))
                ? this.metadata.getConstant(name)
                : null

            return fee ? SCALEInt.decode(fee).decoded.value : null            
        } catch (e) {
            return null
        }
    }

    private async fetchMetadata(): Promise<void> {
        this.metadata = await this.send<(Metadata | null), (string | null)>(
            RPC_ENDPOINTS.GET_METADATA,
            [],
            result => result ? Metadata.decode(result) : null
        )
    }

    private async getBlockHash(blockNumber?: number): Promise<string | null> {
        return this.send<string, (string | null)>(
            RPC_ENDPOINTS.GET_BLOCK_HASH,
            blockNumber !== undefined ? [toHexString(blockNumber)] : []
        )
    }

    private async send<T, R>(method: string, params: string[], resultHandler?: (result: R) => T): Promise<T> {
        const response: AxiosResponse = await axios.post(this.baseURL, new RPCBody(method, params.map(param => addHexPrefix(param))))

        return resultHandler ? resultHandler(response.data.result) : response.data.result
    }
}