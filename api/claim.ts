import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { kv } from '@vercel/kv';

// --- NEYNAR REQUIREMENTS CONFIG ---
const MIN_FOLLOWERS = 500;
const MIN_NEYNAR_SCORE = 0.4;
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
    const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;

    if (!userAddress || !SIGNER_PRIVATE_KEY || !REWARDS[type]) {
      return new Response(JSON.stringify({ error: 'Invalid Request Config' }), { status: 400 });
    }

    if (!NEYNAR_API_KEY) {
        console.error("CRITICAL ERROR: NEYNAR_API_KEY is missing/undefined in environment variables.");
        return new Response(JSON.stringify({ error: 'Server configuration error. Contact dev.' }), { status: 500 });
    }

    const rewardAmount = REWARDS[type];

    // ==================================================================
    // --- NEW DEBUGGING LOGS ---
    const keyDebug = NEYNAR_API_KEY ? `${NEYNAR_API_KEY.substring(0, 5)}...[HIDDEN]` : 'UNDEFINED/EMPTY';
    console.log(`[DEBUG] Starting Neynar check for ${userAddress}. Using API Key starting with: ${keyDebug}`);
    // ==================================================================

    // 1. NEYNAR VERIFICATION
    // ==================================================================
    try {
        console.log("[DEBUG] Sending fetch request to Neynar...");
        const neynarResponse = await fetch(
            `https://api.neynar.com/v2/farcaster/user/by_address?address=${userAddress}`,
            {
                method: 'GET',
                headers: {
                    'accept': 'application/json',
                    'api_key': NEYNAR_API_KEY
                }
            }
        );

        console.log(`[DEBUG] Neynar response status: ${neynarResponse.status}`);

        if (!neynarResponse.ok) {
            console.error(`Neynar API Error Status: ${neynarResponse.status}`);
            throw new Error("Failed to connect to Farcaster validation service.");
        }
        
        console.log("[DEBUG] Neynar connection successful. Parsing data...");
        const neynarData = await neynarResponse.json();
        
        let fUser = neynarData.user;
        if (!fUser && Array.isArray(neynarData) && neynarData.length > 0) {
            fUser = neynarData[0];
        }

        if (!fUser) {
             return new Response(JSON.stringify({ 
                success: false, 
                error: 'This wallet is not linked to a Farcaster profile.' 
            }), { status: 403 });
        }

        const followerCount = fUser.follower_count || 0;
        const neynarScore = fUser.experimental?.neynar_score || 0;
        console.log(`[DEBUG] User data: Followers=${followerCount}, Score=${neynarScore}`);

        if (followerCount < MIN_FOLLOWERS || neynarScore < MIN_NEYNAR_SCORE) {
             return new Response(JSON.stringify({ 
                success: false, 
                error: `Requirements not met. Need: ${MIN_FOLLOWERS}+ Followers & ${MIN_NEYNAR_SCORE} Neynar Score. You have: ${followerCount} followers, Score: ${neynarScore.toFixed(2)}` 
            }), { status: 403 });
        }

    } catch (apiErr: any) {
        console.error("Neynar Verification Failed (CATCH BLOCK):", apiErr.message);
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'Unable to verify social requirements at this time. Please try again later.' 
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