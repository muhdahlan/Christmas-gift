import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes, createPublicClient, http } from 'viem';
import { base, arbitrum } from 'viem/chains';
import { kv } from '@vercel/kv';

const CHAIN_IDS = {
  BASE: 8453,
  ARBITRUM: 42161
};

const REWARDS = {
  [CHAIN_IDS.BASE]: 10000000000000000000n, // 10 DEGEN
  [CHAIN_IDS.ARBITRUM]: 100000000000000000n  // 0.1 ARB
};

const getClient = (chainId: number) => {
  switch (chainId) {
    case CHAIN_IDS.ARBITRUM: return createPublicClient({ chain: arbitrum, transport: http() });
    default: return createPublicClient({ chain: base, transport: http() });
  }
}

export async function POST(request: Request) {
  let body: any = null;

  try {
    body = await request.json();
    const userAddress = body.userAddress;
    const fid = body.fid || "unknown";
    const chainId = body.chainId || CHAIN_IDS.BASE;

    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;
    const now = Date.now();

    if (!userAddress || !SIGNER_PRIVATE_KEY || !REWARDS[chainId]) {
      return new Response(JSON.stringify({ error: 'Invalid Request Config or Unsupported Chain' }), { status: 400 });
    }

    if (!userAddress.startsWith("0x") || userAddress.length !== 42) {
        return new Response(JSON.stringify({ error: 'Invalid user address format' }), { status: 400 });
    }

    const userAddressLower = userAddress.toLowerCase();
    const rewardAmount = REWARDS[chainId];
    const publicClient = getClient(chainId);
    
    const bytecode = await publicClient.getBytecode({ address: userAddress as `0x${string}` });
    if (bytecode) {
      return new Response(JSON.stringify({ success: false, error: 'Security Alert: Smart Contracts not allowed!' }), { status: 403 });
    }

    const lockKey = `lock:${chainId}:${userAddressLower}`;
    if (!await kv.set(lockKey, 'processing', { nx: true, ex: 10 })) {
      return new Response(JSON.stringify({ error: 'Too many requests. Slow down.' }), { status: 429 });
    }

    const resetTime = new Date(now);
    resetTime.setUTCHours(8, 20, 0, 0);
    if (now < resetTime.getTime()) {
      resetTime.setUTCDate(resetTime.getUTCDate() - 1);
    }

    const claimKey = `claim:${chainId}:${userAddressLower}`;
    const lastClaim = await kv.get<number>(claimKey);
    if (lastClaim && lastClaim > resetTime.getTime()) {
      await kv.del(lockKey);
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
      address: userAddressLower,
      amount: rewardAmount.toString()
    });

    await kv.lpush('claim_logs', logEntry);
    await kv.ltrim('claim_logs', 0, 4999);
    
    await kv.del(lockKey);

    return new Response(JSON.stringify({
      success: true,
      amount: rewardAmount.toString(),
      nonce: nonce.toString(),
      signature: signature,
    }), { status: 200 });

  } catch (error) {
    console.error(error);
    if (body?.userAddress && body?.chainId) {
       const lockKey = `lock:${body.chainId}:${body.userAddress.toLowerCase()}`;
       await kv.del(lockKey);
    }
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}