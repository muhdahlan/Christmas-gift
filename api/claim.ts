import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { kv } from '@vercel/kv';

const REWARDS = {
    daily: 10000000000000000000n, 
    bonus: 5000000000000000000n
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userAddress = (body.userAddress || "").toLowerCase();
    const type = (body.type || 'daily') as keyof typeof REWARDS;
    const fid = body.fid || "unknown";
    
    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;

    if (!userAddress || !SIGNER_PRIVATE_KEY || !REWARDS[type]) {
      return new Response(JSON.stringify({ error: 'Invalid Request Config' }), { status: 400 });
    }

    const rewardAmount = REWARDS[type];

    const publicClient = createPublicClient({ chain: base, transport: http() });
    const bytecode = await publicClient.getBytecode({ address: userAddress as `0x${string}` });
    if (bytecode) {
        return new Response(JSON.stringify({ success: false, error: 'Security Alert: Smart Contracts not allowed!' }), { status: 403 });
    }

    const lockKey = `lock:${type}:${userAddress}`;
    if (!await kv.set(lockKey, 'processing', { nx: true, ex: 10 })) {
        return new Response(JSON.stringify({ error: 'Too many requests. Slow down.' }), { status: 429 });
    }

    const now = new Date();
    const resetTime = new Date(now);
    resetTime.setUTCHours(8, 20, 0, 0); 
    if (now.getTime() < resetTime.getTime()) {
        resetTime.setUTCDate(resetTime.getUTCDate() - 1);
    }

    const lastClaim = await kv.get<number>(`claim:${type}:${userAddress}`);
    if (lastClaim && lastClaim > resetTime.getTime()) {
        return new Response(JSON.stringify({ success: false, error: `You already claimed ${type.toUpperCase()} today!` }), { status: 429 });
    }

    const nonce = BigInt(Date.now());
    const account = privateKeyToAccount(SIGNER_PRIVATE_KEY);
    const messageHash = keccak256(
      encodePacked(
        ['address', 'uint256', 'uint256'],
        [userAddress as `0x${string}`, rewardAmount, nonce]
      )
    );
    const signature = await account.signMessage({ message: { raw: toBytes(messageHash) } });
    
    await kv.set(`claim:${type}:${userAddress}`, Date.now());

    const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        type: type,
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