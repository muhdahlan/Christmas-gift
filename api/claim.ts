import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { kv } from '@vercel/kv';
import path from 'path';
import { promises as fs } from 'fs';

const GM_CONTRACT_ADDRESS = "0x8fDc3AED01a0b12c00D480977ad16a16A87cb9E7";
const GM_READ_ABI = [{
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "lastGMDay",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
}] as const;

const CHAIN_ID_BASE = 8453;

const REWARDS = {
  MAIN: 10000000000000000000n,
  BONUS: 2000000000000000000n
};

export async function POST(request: Request) {
  let body: any = null;

  try {
    body = await request.json();
    const userAddress = body.userAddress;
    const rawFid = body.fid;
    const claimType = body.claimType || 'main';

    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;
    const now = Date.now();

    if (!userAddress || !SIGNER_PRIVATE_KEY) {
      return new Response(JSON.stringify({ error: 'Invalid Request Config' }), { status: 400 });
    }

    const configDirectory = path.join(process.cwd(), 'config');
    const fileContents = await fs.readFile(path.join(configDirectory, 'blacklist.json'), 'utf8');
    const blacklistedFIDs: number[] = JSON.parse(fileContents);

    if (rawFid) {
        const fidNumber = Number(rawFid);

        if (!isNaN(fidNumber) && blacklistedFIDs.includes(fidNumber)) {
            console.warn(`[SECURITY BLOCK] Claim attempt from blacklisted FID: ${fidNumber}, Address: ${userAddress}`);

            return new Response(JSON.stringify({
                success: false,
                error: 'CLAIM_BLOCKED',
                message: 'Security Action: This Farcaster account is temporarily blocked from claiming activities.'
            }), { status: 403 });
        }
    }

    const fid = rawFid || "unknown";

    if (!userAddress.startsWith("0x") || userAddress.length !== 42) {
        return new Response(JSON.stringify({ error: 'Invalid user address format' }), { status: 400 });
    }

    const userAddressLower = userAddress.toLowerCase();
    const publicClient = createPublicClient({ chain: base, transport: http() });

    const bytecode = await publicClient.getBytecode({ address: userAddress as `0x${string}` });
    if (bytecode) {
      return new Response(JSON.stringify({ success: false, error: 'Security Alert: Smart Contracts not allowed!' }), { status: 403 });
    }

    const currentUTCDay = Math.floor(now / 1000 / 86400);
    const lastGMDayBigInt = await publicClient.readContract({
        address: GM_CONTRACT_ADDRESS as `0x${string}`,
        abi: GM_READ_ABI,
        functionName: 'lastGMDay',
        args: [userAddress as `0x${string}`]
    });

    if (Number(lastGMDayBigInt) !== currentUTCDay) {
        return new Response(JSON.stringify({ success: false, error: 'You must perform the on-chain GM transaction first!' }), { status: 403 });
    }

    let rewardAmount: bigint;
    let dbKeySuffix: string;

    if (claimType === 'bonus') {
        rewardAmount = REWARDS.BONUS;
        dbKeySuffix = 'bonus_degen';
    } else {
        rewardAmount = REWARDS.MAIN;
        dbKeySuffix = 'main_degen';
    }

    const lockKey = `lock:${dbKeySuffix}:${userAddressLower}`;
    if (!await kv.set(lockKey, 'processing', { nx: true, ex: 10 })) {
      return new Response(JSON.stringify({ error: 'Too many requests. Slow down.' }), { status: 429 });
    }

    const resetTime = new Date(now);
    resetTime.setUTCHours(8, 20, 0, 0);
    if (now < resetTime.getTime()) {
      resetTime.setUTCDate(resetTime.getUTCDate() - 1);
    }

    const claimKey = `claim:${dbKeySuffix}:${userAddressLower}`;
    const lastClaim = await kv.get<number>(claimKey);
    if (lastClaim && lastClaim > resetTime.getTime()) {
      await kv.del(lockKey);
      const typeMsg = claimType === 'bonus' ? 'Bonus' : 'Main';
      return new Response(JSON.stringify({ success: false, error: `Already claimed the ${typeMsg} reward today!` }), { status: 429 });
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
      chainId: CHAIN_ID_BASE,
      type: claimType,
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
    if (body?.userAddress && body?.claimType) {
       const dbKeySuffix = body.claimType === 'bonus' ? 'bonus_degen' : 'main_degen';
       const lockKey = `lock:${dbKeySuffix}:${body.userAddress.toLowerCase()}`;
       await kv.del(lockKey);
    }
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}