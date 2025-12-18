import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { kv } from '@vercel/kv';

// --- QUOTIENT REPUTATION CONFIG ---
const MIN_QUOTIENT_SCORE = 0.5;

// --- DUMMY MODE SWITCH ---
const ENABLE_DUMMY_MODE = true;
// ----------------------------------

const REWARDS = {
    daily: 69000000000000000000n, // 69 DEGEN
    bonus: 15000000000000000000n  // 15 DEGEN
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userAddress = (body.userAddress || "").toLowerCase();
    const type = (body.type || 'daily') as keyof typeof REWARDS;
    
    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;
    const QUOTIENT_API_KEY = process.env.QUOTIENT_API_KEY;

    if (!userAddress || !SIGNER_PRIVATE_KEY || !REWARDS[type]) {
      return new Response(JSON.stringify({ error: 'Invalid Request Config' }), { status: 400 });
    }

    if (!ENABLE_DUMMY_MODE && !QUOTIENT_API_KEY) {
        console.error("CRITICAL ERROR: QUOTIENT_API_KEY is missing in environment variables. Cannot run in live mode.");
        return new Response(JSON.stringify({ error: 'Server configuration error. Contact dev.' }), { status: 500 });
    }

    const rewardAmount = REWARDS[type];

    // ==================================================================
    // 1. QUOTIENT REPUTATION CHECK (WITH DUMMY MODE)
    // ==================================================================
    try {
        let userScore = 0;

        if (ENABLE_DUMMY_MODE) {
            console.log(`[DEBUG] DUMMY MODE ACTIVE For address: ${userAddress}`);
            console.log("[DEBUG] Skipping real Quotient API call.");
            // Setting low score to test FAILURE scenario
            userScore = 0.2; 
            console.log(`[DEBUG] Assigning dummy score: ${userScore}`);
        } else {
            console.log(`[LIVE] Checking real Quotient Score for address: ${userAddress}`);
            const quotientResponse = await fetch(
                `https://api.quotient.social/v1/reputation/user/${userAddress}`,
                {
                    method: 'GET',
                    headers: {
                        'accept': 'application/json',
                        'x-api-key': QUOTIENT_API_KEY!
                    }
                }
            );

            if (!quotientResponse.ok) {
                console.error(`Quotient API Error Status: ${quotientResponse.status}`);
                if (quotientResponse.status === 404) {
                     throw new Error("User not found in reputation database (Score: 0)");
                }
                throw new Error("Failed to connect to reputation service.");
            }

            const data = await quotientResponse.json();
            userScore = data.quotient_score || 0;
            console.log(`[LIVE] User real Quotient Score: ${userScore}`);
        }

        if (userScore < MIN_QUOTIENT_SCORE) {
             return new Response(JSON.stringify({ 
                success: false, 
                error: `Reputation too low. Your Quotient Score is low. Minimum required is ${MIN_QUOTIENT_SCORE} to ensure quality users.` 
            }), { status: 403 });
        }

    } catch (apiErr: any) {
        console.error("Reputation Check Failed:", apiErr.message);
        if (apiErr.message.includes("Score: 0")) {
             return new Response(JSON.stringify({ 
                success: false, 
                error: `Reputation too low. Your Quotient Score is low. Minimum required is ${MIN_QUOTIENT_SCORE} to ensure quality users.` 
            }), { status: 403 });
        }
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'Unable to verify social reputation at this time. Please try again later.' 
        }), { status: 500 });
    }

    // 2. Anti-Bot Contract Check
    const publicClient = createPublicClient({ chain: base, transport: http() });
    const bytecode = await publicClient.getBytecode({ address: userAddress as `0x${string}` });
    if (bytecode) {
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'Security Alert: Smart Contracts not allowed!' 
        }), { status: 403 });
    }

    // 3. Lock & Limit
    const lockKey = `lock:${type}:${userAddress}`;
    if (!await kv.set(lockKey, 'processing', { nx: true, ex: 10 })) {
        return new Response(JSON.stringify({ error: 'Too many requests. Slow down.' }), { status: 429 });
    }

    // 4. Daily Reset Check (08:20 UTC)
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
            error: `You already claimed ${type.toUpperCase()} today!` 
        }), { status: 429 });
    }

    // 5. Generate Signature
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
    }), { status: 200 });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}