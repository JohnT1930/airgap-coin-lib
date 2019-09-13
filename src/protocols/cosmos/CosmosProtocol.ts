import { CosmosNodeClient } from './CosmosNodeClient'
import { ICoinProtocol } from '../ICoinProtocol'
import { ICoinSubProtocol } from '../ICoinSubProtocol'
import { NonExtendedProtocol } from '../NonExtendedProtocol'
import { IAirGapTransaction } from '../../interfaces/IAirGapTransaction'
import { UnsignedTransaction } from '../../serializer/unsigned-transaction.serializer'
import { SignedTransaction } from '../../serializer/signed-transaction.serializer'

import { BIP32Interface, fromSeed } from 'bip32'
import { mnemonicToSeed, validateMnemonic } from 'bip39'
import { BigNumber } from 'bignumber.js'
import { RawCosmosSendMessage, RawCosmosTransaction } from '../../serializer/unsigned-transactions/cosmos-transactions.serializer'

const RIPEMD160 = require('ripemd160')
const BECH32 = require('bech32')
const SECP256K1 = require('secp256k1')

export interface KeyPair {
  publicKey: Buffer
  privateKey: Buffer
}

export class CosmosProtocol extends NonExtendedProtocol implements ICoinProtocol {
  public symbol: string = '⌀'
  public name: string = 'Cosmos'
  public marketSymbol: string = 'Atom'
  public feeSymbol: string = 'uatom'
  public feeDefaults = {
    low: new BigNumber(0.025),
    medium: new BigNumber(0.025),
    high: new BigNumber(0.025)
  }
  public decimals: number = 18 // TODO: verify these values
  public feeDecimals: number = 18
  public identifier: string = 'cosmos'
  public units = [
    {
      unitSymbol: 'atom',
      factor: new BigNumber(1)
    },
    {
      unitSymbol: 'uatom',
      factor: new BigNumber(1).shiftedBy(-6)
    }
  ]
  public supportsHD: boolean = true
  public standardDerivationPath: string = `m/44'/118'/0'/0/0`
  public addressIsCaseSensitive: boolean = false
  public addressValidationPattern: string = '^cosmos[a-fA-F0-9]{40}$'
  public addressPlaceholder: string = 'cosmosabc...'
  public blockExplorer: string = 'https://www.mintscan.io'
  public subProtocols?: (ICoinProtocol & ICoinSubProtocol)[] | undefined

  public nodeClient: CosmosNodeClient

  private addressPrefix = 'cosmos'

  constructor(nodeClient: CosmosNodeClient = new CosmosNodeClient('https://lcd-do-not-abuse.cosmostation.io')) {
    super()
    this.nodeClient = nodeClient
  }

  public getBlockExplorerLinkForAddress(address: string): string {
    return `${this.blockExplorer}/account/${address}`
  }

  public getBlockExplorerLinkForTxId(txId: string): string {
    return `${this.blockExplorer}/tx/${txId}`
  }

  public generateKeyPair(mnemonic: string, derivationPath: string = this.standardDerivationPath): KeyPair {
    validateMnemonic(mnemonic)
    const seed = mnemonicToSeed(mnemonic)
    const node = fromSeed(seed)
    return this.generateKeyPairFromNode(node, derivationPath)
  }

  private generateKeyPairFromNode(node: BIP32Interface, derivationPath: string): KeyPair {
    let keys = node.derivePath(derivationPath)
    let privateKey = keys.privateKey
    if (privateKey === undefined) {
      throw new Error('Cannot generate private key')
    }
    return {
      publicKey: keys.publicKey,
      privateKey: privateKey
    }
  }

  public getPublicKeyFromHexSecret(secret: string, derivationPath: string): string {
    let node: BIP32Interface = fromSeed(Buffer.from(secret, 'hex'))
    return this.generateKeyPairFromNode(node, derivationPath).publicKey.toString('hex')
  }

  public getPublicKeyFromPrivateKey(privateKey: Buffer): Buffer {
    const publicKey = SECP256K1.publicKeyCreate(privateKey)
    return Buffer.from(publicKey, 'binary')
  }

  public getPrivateKeyFromHexSecret(secret: string, derivationPath: string): Buffer {
    let node = fromSeed(Buffer.from(secret, 'hex'))
    return this.generateKeyPairFromNode(node, derivationPath).privateKey
  }

  public async getAddressFromPublicKey(publicKey: string): Promise<string> {
    return new Promise(resolve => {
      const pubkey = Buffer.from(publicKey, 'hex')
      crypto.subtle.digest('SHA-256', pubkey).then(value => {
        const hash = new RIPEMD160().update(Buffer.from(value)).digest()
        const address = BECH32.encode(this.addressPrefix, BECH32.toWords(hash))
        resolve(address)
      })
    })
  }

  public async getAddressesFromPublicKey(publicKey: string): Promise<string[]> {
    return [await this.getAddressFromPublicKey(publicKey)]
  }

  public async getTransactionsFromPublicKey(publicKey: string, limit: number, offset: number): Promise<IAirGapTransaction[]> {
    return await this.getTransactionsFromAddresses([await this.getAddressFromPublicKey(publicKey)], limit, offset)
  }

  private getPageNumber(limit: number, offset: number): number {
    if (limit <= 0 || offset < 0) {
      return 0
    }
    return Math.floor(offset / limit) // we need +1 here because pages start at 1
  }

  public async getTransactionsFromAddresses(addresses: string[], limit: number, offset: number): Promise<IAirGapTransaction[]> {
    const promises: Promise<IAirGapTransaction[]>[] = []
    const page = this.getPageNumber(limit, offset)
    for (const address of addresses) {
      promises.push(this.nodeClient.fetchTransactions(address, page, limit))
    }
    return Promise.all(promises).then(transactions => transactions.reduce((current, next) => current.concat(next)))
  }

  public async signWithPrivateKey(privateKey: Buffer, transaction: RawCosmosTransaction): Promise<string> {
    const accointNumber = 0 // TODO: find where to get this
    const sequence = 0 // TODO: find where to get this
    const toSign = {
      account_number: accointNumber,
      chain_id: transaction.chainID,
      fee: {
        amount: [
          ...transaction.fee.amount.map(value => {
            return {
              amount: value.amount.toFixed(10),
              denom: value.denom
            }
          })
        ],
        gas: transaction.fee.gas.toFixed(10)
      },
      memo: transaction.memo,
      msgs: [
        ...transaction.messages.map(value => {
          return {
            type: 'cosmos-sdk/MsgSend',
            value: {
              amount: [
                ...value.coins.map(coin => {
                  return {
                    amount: coin.amount.toFixed(10),
                    denom: coin.denom
                  }
                })
              ],
              from_address: value.fromAddress,
              to_address: value.toAddress
            }
          }
        })
      ],
      sequence: sequence
    } // TODO: check if sorting is needed
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', Buffer.from(JSON.stringify(toSign))))
    const signed = SECP256K1.sign(hash, privateKey)
    const sigBase64 = Buffer.from(signed.signature, 'binary').toString('base64')
    const signedTransaction = {
      tx: {
        msg: toSign.msgs,
        fee: toSign.fee,
        signatures: [
          {
            signature: sigBase64,
            pub_key: {
              type: 'tendermint/PubKeySecp256k1',
              value: await this.getPublicKeyFromPrivateKey(privateKey).toString('base64') // TODO: check if this is optional
            }
          }
        ],
        memo: toSign.memo
      },
      mode: 'sync'
    }
    return JSON.stringify(signedTransaction)
  }

  public async getTransactionDetails(transaction: UnsignedTransaction): Promise<IAirGapTransaction[]> {
    throw new Error('Method not implemented.')
  }

  public async getTransactionDetailsFromSigned(transaction: SignedTransaction): Promise<IAirGapTransaction[]> {
    throw new Error('Method not implemented.')
  }

  public async getBalanceOfAddresses(addresses: string[]): Promise<BigNumber> {
    const promises: Promise<BigNumber>[] = []
    for (const address of addresses) {
      promises.push(this.nodeClient.fetchBalance(address))
    }
    return Promise.all(promises).then(balances => {
      return balances.reduce((current, next) => {
        return current.plus(next)
      })
    })
  }

  public async getBalanceOfPublicKey(publicKey: string): Promise<BigNumber> {
    return await this.getBalanceOfAddresses([await this.getAddressFromPublicKey(publicKey)])
  }

  public async prepareTransactionFromPublicKey(
    publicKey: string,
    recipients: string[],
    values: BigNumber[],
    fee: BigNumber,
    data?: any
  ): Promise<RawCosmosTransaction> {
    const address = await this.getAddressFromPublicKey(publicKey)
    const nodeInfo = await this.nodeClient.fetchNodeInfo()

    if (recipients.length !== values.length) {
      return Promise.reject('recipients length does not match with values')
    }

    const messages: RawCosmosSendMessage[] = []
    for (let i = 0; i < recipients.length; ++i) {
      const message: RawCosmosSendMessage = {
        fromAddress: address,
        toAddress: recipients[i],
        coins: [
          {
            denom: 'uatom',
            amount: values[i]
          }
        ]
      }
      messages.push(message)
    }
    const transaction: RawCosmosTransaction = {
      messages: messages,
      fee: {
        amount: [
          {
            denom: this.feeSymbol,
            amount: fee
          }
        ],
        gas: new BigNumber('200000')
      },
      memo: data !== undefined && typeof data === 'string' ? (data as string) : '',
      chainID: nodeInfo.network
    }
    return transaction
  }

  public async broadcastTransaction(rawTransaction: string): Promise<string> {
    return await this.nodeClient.broadcastSignedTransaction(rawTransaction)
  }

  public async signMessage(message: string, privateKey: Buffer): Promise<string> {
    throw new Error('Method not implemented.')
  }
  public async verifyMessage(message: string, signature: string, publicKey: Buffer): Promise<boolean> {
    throw new Error('Method not implemented.')
  }
}
