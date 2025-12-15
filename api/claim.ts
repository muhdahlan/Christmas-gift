import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes } from 'viem';
import { kv } from '@vercel/kv';

const REWARD_AMOUNT = 10000000000000000000n; // 10 DEGEN

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userAddress = (body.userAddress || "").toLowerCase();
    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;

    if (!userAddress || !SIGNER_PRIVATE_KEY) {
      return new Response(JSON.stringify({ error: 'Config Error' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // --- ATOMIC LOCK (ANTI RACE CONDITION) ---
    const lockKey = `lock:${userAddress}`;
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

    // --- DAILY LIMIT LOGIC ---
    const now = new Date();
    const lastResetTime = new Date(now);
    lastResetTime.setUTCHours(0, 0, 0, 0);

    const lastClaimTimestamp = await kv.get<number>(`claim:${userAddress}`);

    if (lastClaimTimestamp && lastClaimTimestamp > lastResetTime.getTime()) {
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'You already claimed today!' 
        }), { 
            status: 429, 
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // --- SIGNATURE GENERATION ---
    const nonce = BigInt(Date.now());
    const account = privateKeyToAccount(SIGNER_PRIVATE_KEY);

    const messageHash = keccak256(
      encodePacked(
        ['address', 'uint256', 'uint256'],
        [userAddress as `0x${string}`, REWARD_AMOUNT, nonce]
      )
    );

    const signature = await account.signMessage({
      message: { raw: toBytes(messageHash) },
    });

    // --- SAVE CLAIM TIMESTAMP ---
    await kv.set(`claim:${userAddress}`, Date.now());

    return new Response(JSON.stringify({
      success: true,
      amount: REWARD_AMOUNT.toString(),
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