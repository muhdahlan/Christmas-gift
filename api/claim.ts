import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes, createPublicClient, http } from 'viem';
import { base, arbitrum, celo } from 'viem/chains';
import { kv } from '@vercel/kv';

const CHAIN_IDS = {
  BASE: 8453,
  ARBITRUM: 42161,
  CELO: 42220
};

const ARB_UNLOCK_DATE = new Date(Date.UTC(2025, 11, 22, 8, 20, 0)); 
const CELO_UNLOCK_DATE = new Date(Date.UTC(2025, 11, 23, 8, 20, 0)); 

const REWARDS = {
  [CHAIN_IDS.BASE]: 10000000000000000000n,
  [CHAIN_IDS.ARBITRUM]: 100000000000000000n,
  [CHAIN_IDS.CELO]: 100000000000000000n
};

const getClient = (chainId: number) => {
    switch (chainId) {
        case CHAIN_IDS.ARBITRUM: return createPublicClient({ chain: arbitrum, transport: http() });
        case CHAIN_IDS.CELO: return createPublicClient({ chain: celo, transport: http() });
        default: return createPublicClient({ chain: base, transport: http() });
    }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userAddress = (body.userAddress || "").toLowerCase();
    const fid = body.fid || "unknown";
    const chainId = body.chainId || CHAIN_IDS.BASE;
    
    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;

    const now = Date.now();
    if (chainId === CHAIN_IDS.ARBITRUM && now < ARB_UNLOCK_DATE.getTime()) {
         return new Response(JSON.stringify({ success: false, error: 'Arbitrum rewards are locked until tomorrow!' }), { status: 403 });
    }
    if (chainId === CHAIN_IDS.CELO && now < CELO_UNLOCK_DATE.getTime()) {
         return new Response(JSON.stringify({ success: false, error: 'Celo rewards are locked until day after tomorrow!' }), { status: 403 });
    }

    if (!userAddress || !SIGNER_PRIVATE_KEY || !REWARDS[chainId]) {
      return new Response(JSON.stringify({ error: 'Invalid Request Config' }), { status: 400 });
    }

    const rewardAmount = REWARDS[chainId];

    const publicClient = getClient(chainId);
    const bytecode = await publicClient.getBytecode({ address: userAddress as `0x${string}` });
    if (bytecode) {
        return new Response(JSON.stringify({ success: false, error: 'Security Alert: Smart Contracts not allowed!' }), { status: 403 });
    }

    const lockKey = `lock:${chainId}:${userAddress}`;
    if (!await kv.set(lockKey, 'processing', { nx: true, ex: 10 })) {
        return new Response(JSON.stringify({ error: 'Too many requests. Slow down.' }), { status: 429 });
    }

    const resetTime = new Date(now);
    resetTime.setUTCHours(8, 20, 0, 0); 
    if (now < resetTime.getTime()) {
        resetTime.setUTCDate(resetTime.getUTCDate() - 1);
    }

    const claimKey = `claim:${chainId}:${userAddress}`;
    const lastClaim = await kv.get<number>(claimKey);
    if (lastClaim && lastClaim > resetTime.getTime()) {
        return new Response(JSON.stringify({ success: false, error: `Already claimed on this chain today!` }), { status: 429 });
    }

    const nonce = BigInt(now);
    const account = privateKeyToAccount(SIGNER_PRIVATE_KEY);
    const messageHash = keccak256(
      encodePacked(
        ['address', 'uint256', 'uint256'],
        [userAddress as `0x${string}`, rewardAmount, nonce]
      )
    );
    const signature = await account.signMessage({ message: { raw: toBytes(messageHash) } });
    
    await kv.set(claimKey, now);

    const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        chainId: chainId,
        type: 'daily',
        fid: fid,
        address: userAddress,
        amount: rewardAmount.toString()
    });

    await kv.lpush('claim_logs', logEntry);
    await kv.ltrim('claim_logs', 0, 4999);

    return new Response(JSON.stringify({
      success: true,
      amount: rewardAmount.toString(),
      nonce: nonce.toString(),
      signature: signature,
    }), { status: 200 });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}