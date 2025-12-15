import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes } from 'viem';
import { kv } from '@vercel/kv';
import { getSSLHubRpcClient } from '@farcaster/hub-nodejs';

const REWARD_AMOUNT = 10000000000000000000n; 
const HUB_URL = 'nemes.farcaster.xyz:2283'; 

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userAddress = (body.userAddress || "").toLowerCase();
    const fid = Number(body.fid); 
    
    // --- DEBUG LOG START ---
    console.log(`[CLAIM START] Request from Address: ${userAddress} | FID: ${fid}`);
    
    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;

    if (!userAddress || !SIGNER_PRIVATE_KEY || !fid || isNaN(fid)) {
      console.error("[ERROR] Missing config or FID");
      return new Response(JSON.stringify({ error: 'Config Error or Missing FID' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const client = getSSLHubRpcClient(HUB_URL);
    let isVerified = false;

    // 1. Cek Verification (Linked Wallet)
    console.log("[DEBUG] Checking Linked Addresses...");
    const verificationsResult = await client.getVerificationsByFid({ fid });
    
    if (verificationsResult.isOk()) {
      const verifications = verificationsResult.value.messages;
      console.log(`[DEBUG] Found ${verifications.length} linked addresses.`);
      
      for (const msg of verifications) {
        if (msg.data?.verificationAddAddressBody?.address) {
            const verifiedAddress = "0x" + Buffer.from(msg.data.verificationAddAddressBody.address).toString('hex');
            console.log(`[DEBUG] Checking linked: ${verifiedAddress}`); // LIHAT INI DI LOG
            
            if (verifiedAddress.toLowerCase() === userAddress) {
                console.log("[SUCCESS] Match found in Linked Addresses!");
                isVerified = true;
                break;
            }
        }
      }
    } else {
        console.log("[DEBUG] No linked addresses found or Hub Error.");
    }

    // 2. Cek Custody (Main Wallet)
    if (!isVerified) {
        console.log("[DEBUG] Checking Custody Address...");
        
        let custodyResult;
        if ((client as any).getOnChainIdRegistryEvent) {
             custodyResult = await (client as any).getOnChainIdRegistryEvent({ fid });
        } 
        else if ((client as any).getIdRegistryEvent) {
             custodyResult = await (client as any).getIdRegistryEvent({ fid });
        }

        if (custodyResult && custodyResult.isOk()) {
            const eventBody = custodyResult.value;
            const toAddressBytes = eventBody.to || eventBody.idRegistryEvent?.to;
            
            if (toAddressBytes) {
                 const custodyAddress = "0x" + Buffer.from(toAddressBytes).toString('hex');
                 console.log(`[DEBUG] Custody Address is: ${custodyAddress}`); // LIHAT INI DI LOG

                 if (custodyAddress.toLowerCase() === userAddress) {
                    console.log("[SUCCESS] Match found in Custody Address!");
                    isVerified = true;
                 }
            }
        } else {
             console.log("[DEBUG] Failed to fetch Custody Address.");
        }
    }

    client.close();

    if (!isVerified) {
        console.warn(`[FAILED] Wallet ${userAddress} is NOT linked to FID ${fid}`);
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'Security Alert: Wallet does not belong to this Farcaster ID. Please link it in Warpcast settings.' 
        }), { 
            status: 403, 
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // --- LOGIC BIASA ---
    const lockKey = `lock:fid:${fid}`;
    const acquiredLock = await kv.set(lockKey, 'processing', { nx: true, ex: 10 });
    if (!acquiredLock) {
      console.warn("[RATE LIMIT] Too many requests");
      return new Response(JSON.stringify({ success: false, error: 'Too many requests. Please wait.' }), { status: 429 });
    }

    const now = new Date();
    const lastResetTime = new Date(now);
    lastResetTime.setUTCHours(0, 0, 0, 0);

    const lastClaimTimestamp = await kv.get<number>(`claim:fid:${fid}`);
    if (lastClaimTimestamp && lastClaimTimestamp > lastResetTime.getTime()) {
        console.warn("[LIMIT] User already claimed today");
        return new Response(JSON.stringify({ success: false, error: 'You already claimed today!' }), { status: 429 });
    }

    const nonce = BigInt(Date.now());
    const account = privateKeyToAccount(SIGNER_PRIVATE_KEY);
    const messageHash = keccak256(encodePacked(['address', 'uint256', 'uint256'], [userAddress as `0x${string}`, REWARD_AMOUNT, nonce]));
    const signature = await account.signMessage({ message: { raw: toBytes(messageHash) } });

    await kv.set(`claim:fid:${fid}`, Date.now());
    console.log("[SUCCESS] Claim signature generated successfully!");

    return new Response(JSON.stringify({
      success: true,
      amount: REWARD_AMOUNT.toString(),
      nonce: nonce.toString(),
      signature: signature,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error("[CRITICAL ERROR]", error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}