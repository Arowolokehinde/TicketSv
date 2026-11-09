import {PrivateKey} from '@bsv/sdk'

export function hostedConfig(env:Record<string,string|undefined>){
 // Header collection uses a session advisory lock: use a direct connection,
 // not a transaction-pooling URL which can switch sessions between queries.
 const connectionString=env.DATABASE_URL_UNPOOLED??env.POSTGRES_URL_NON_POOLING??env.DATABASE_URL
 if(!connectionString)throw Error('Configure the hosted PostgreSQL database')
 const database=new URL(connectionString)
 if(!['postgres:','postgresql:'].includes(database.protocol)||['localhost','127.0.0.1','[::1]'].includes(database.hostname))throw Error('Hosted deployment requires a remote PostgreSQL database')
 if(database.hostname.includes('-pooler.'))throw Error('Configure DATABASE_URL_UNPOOLED for header collector session locks')
 const secret=env.AUTH_SERVER_PRIVATE_KEY
 if(!secret||!/^[0-9a-f]{64}$/.test(secret)||BigInt('0x'+secret)===0n||BigInt('0x'+secret)>=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n)throw Error('Configure a valid application authentication identity')
 const origins=(env.APP_ORIGINS??'').split(',').map(x=>x.trim())
 for(const value of origins){const url=new URL(value);if(url.protocol!=='https:'||url.origin!==value)throw Error('APP_ORIGINS must contain exact HTTPS origins')}
 return {connectionString,key:PrivateKey.fromHex(secret),origins}
}
