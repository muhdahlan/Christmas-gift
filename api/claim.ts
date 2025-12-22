import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes, createPublicClient, http } from 'viem';
import { base, arbitrum, celo } from 'viem/chains';
import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';
import axios from 'axios';

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
    // Ensure FID is a string or null if missing
    const fid = body.fid ? String(body.fid) : null;
    const chainId = body.chainId || CHAIN_IDS.BASE;

    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;

    // --- START: BASIC INPUT VALIDATION ---
    if (!userAddress || !SIGNER_PRIVATE_KEY || !REWARDS[chainId]) {
      return NextResponse.json({ error: 'Invalid Request Config' }, { status: 400 });
    }

    if (!fid) {
        return NextResponse.json({ success: false, error: "Farcaster FID not found." }, { status: 400 });
    }
    // --- END: BASIC INPUT VALIDATION ---


    // --- START: NEYNAR SCORE CHECK (NEW) ---
    const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;

    if (!NEYNAR_API_KEY) {
      console.error("NEYNAR_API_KEY not set in environment variables.");
      // Fail safe: reject claim if server config is wrong
      return NextResponse.json({ success: false, error: "Server configuration error." }, { status: 500 });
    }

    try {
      console.log(`Checking Neynar score for FID: ${fid}`);
      const neynarResponse = await axios.get(
        `https://api.neynar.com/v2/farcaster/user?fid=${fid}`,
        {
          headers: {
            'api_key': NEYNAR_API_KEY,
            'accept': 'application/json'
          }
        }
      );

      // Get score. Use optional chaining (?.) and nullish coalescing (??)
      // If user has no reputation score yet, default to 0.5 (new user default)
      const userScore = neynarResponse.data.result.user.reputation?.score ?? 0.5;
      console.log(`Neynar score for FID ${fid} is: ${userScore}`);

      // Check if score is below the threshold of 0.3
      if (userScore < 0.3) {
        console.warn(`Claim denied for FID ${fid}. Score ${userScore} is too low.`);
        return NextResponse.json({
          success: false,
          error: 'Sorry, your Neynar score is too low (< 0.3) to claim this reward. Increase your Farcaster activity!',
        }, { status: 403 }); // 403 Forbidden
      }

      // If code reaches here, user score is >= 0.3. Proceed!

    } catch (neynarError: any) {
      // Handle Neynar API errors (e.g., API down, rate limit, FID not found)
      console.error("Neynar API Error:", neynarError.response?.data || neynarError.message);
      // Fail safe: reject claim if we can't verify the score
      return NextResponse.json({ success: false, error: "Failed to verify Neynar score. Please try again later." }, { status: 500 });
    }
    // --- END: NEYNAR SCORE CHECK ---


    // --- PREVIOUS CLAIM LOGIC STARTS HERE ---
    const now = Date.now();
    if (chainId === CHAIN_IDS.ARBITRUM && now < ARB_UNLOCK_DATE.getTime()) {
      return NextResponse.json({ success: false, error: 'Arbitrum rewards are locked until tomorrow!' }, { status: 403 });
    }
    if (chainId === CHAIN_IDS.CELO && now < CELO_UNLOCK_DATE.getTime()) {
      return NextResponse.json({ success: false, error: 'Celo rewards are locked until day after tomorrow!' }, { status: 403 });
    }

    const rewardAmount = REWARDS[chainId];

    const publicClient = getClient(chainId);
    const bytecode = await publicClient.getBytecode({ address: userAddress as `0x${string}` });
    if (bytecode) {
      return NextResponse.json({ success: false, error: 'Security Alert: Smart Contracts not allowed!' }, { status: 403 });
    }

    const lockKey = `lock:${chainId}:${userAddress}`;
    // Use try-catch for KV operations for safety
    try {
        const isLocked = await kv.set(lockKey, 'processing', { nx: true, ex: 10 });
        if (!isLocked) {
             return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 });
        }
    } catch (kvError) {
         console.error("KV Lock Error:", kvError);
         // If KV fails, it might be safer to deny temporarily
         return NextResponse.json({ error: 'Database error. Please try again.' }, { status: 500 });
    }


    const resetTime = new Date(now);
    resetTime.setUTCHours(8, 20, 0, 0);
    if (now < resetTime.getTime()) {
      resetTime.setUTCDate(resetTime.getUTCDate() - 1);
    }

    const claimKey = `claim:${chainId}:${userAddress}`;
    const lastClaim = await kv.get<number>(claimKey);
    if (lastClaim && lastClaim > resetTime.getTime()) {
      return NextResponse.json({ success: false, error: `Already claimed on this chain today!` }, { status: 429 });
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

    // Await KV operations on Vercel functions to ensure completion.
    await kv.lpush('claim_logs', logEntry);
    await kv.ltrim('claim_logs', 0, 4999);

    return NextResponse.json({
      success: true,
      amount: rewardAmount.toString(),
      nonce: nonce.toString(),
      signature: signature,
    }, { status: 200 });

  } catch (error) {
    console.error("Unhandled API Error:", error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}