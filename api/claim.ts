import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { kv } from '@vercel/kv';

const REWARDS = {
    daily: 10000000000000000000n, // 10 DEGEN
    bonus: 5000000000000000000n   // 5 DEGEN
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userAddress = (body.userAddress || "").toLowerCase();
    const type = (body.type || 'daily') as keyof typeof REWARDS; 
    
    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;

    if (!userAddress || !SIGNER_PRIVATE_KEY || !REWARDS[type]) {
      return new Response(JSON.stringify({ error: 'Invalid Request Configuration' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const rewardAmount = REWARDS[type];

    const publicClient = createPublicClient({ chain: base, transport: http() });
    const bytecode = await publicClient.getBytecode({ address: userAddress as `0x${string}` });
    
    if (bytecode) {
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'Security Alert: Smart Contracts are not allowed to claim.' 
        }), { 
            status: 403, 
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const lockKey = `lock:${type}:${userAddress}`;
    const acquiredLock = await kv.set(lockKey, 'processing', { nx: true, ex: 10 });

    if (!acquiredLock) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Too many requests. Please wait.' 
      }), { 
        status: 429, 
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date();
    const resetTime = new Date(now);
    resetTime.setUTCHours(8, 20, 0, 0); 

    if (now.getTime() < resetTime.getTime()) {
        resetTime.setUTCDate(resetTime.getUTCDate() - 1);
    }

    const lastClaim = await kv.get<number>(`claim:${type}:${userAddress}`);

    if (lastClaim && lastClaim > resetTime.getTime()) {
        return new Response(JSON.stringify({ 
            success: false, 
            error: `You already claimed ${type.toUpperCase()} today! Resets at 08:20 UTC.` 
        }), { 
            status: 429, 
            headers: { 'Content-Type': 'application/json' }
        });
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

    return new Response(JSON.stringify({
      success: true,
      amount: rewardAmount.toString(),
      nonce: nonce.toString(),
      signature: signature,
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}