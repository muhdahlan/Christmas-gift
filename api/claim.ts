import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes } from 'viem';
import { kv } from '@vercel/kv';

const REWARD_AMOUNT = 10000000000000000000n; // 10 DEGEN

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Normalize address to lowercase to prevent duplicate claims via case manipulation
    const userAddress = (body.userAddress || "").toLowerCase();
    
    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;

    if (!userAddress || !SIGNER_PRIVATE_KEY) {
      return new Response(JSON.stringify({ error: 'Config Error' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // --- DAILY LIMIT LOGIC ---
    // 08:00 AM WITA (Makassar) is exactly 00:00 Midnight UTC.
    // We check if the user has claimed since the last UTC midnight.
    
    const now = new Date();
    const lastResetTime = new Date(now);
    // Set to 00:00:00 UTC today (Equivalent to 08:00 AM WITA today)
    lastResetTime.setUTCHours(0, 0, 0, 0);

    // Check Database
    const lastClaimTimestamp = await kv.get<number>(`claim:${userAddress}`);

    // If claim exists AND was made AFTER the last reset time
    if (lastClaimTimestamp && lastClaimTimestamp > lastResetTime.getTime()) {
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'Daily limit reached. Resets at 08:00 AM WITA.' 
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