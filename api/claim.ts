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
    
    console.log(`[CLAIM START] Request from Address: ${userAddress} | FID: ${fid}`);
    
    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;

    if (!userAddress || !SIGNER_PRIVATE_KEY || !fid || isNaN(fid)) {
      return new Response(JSON.stringify({ error: 'Config Error or Missing FID' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const client = getSSLHubRpcClient(HUB_URL);
    let isVerified = false;
    
    const allFoundAddresses: string[] = [];

    console.log("[DEBUG] Checking Linked Addresses (All Pages)...");
    
    let pageToken: Uint8Array | undefined;
    let pageCount = 0;
    
    do {
        pageCount++;
        const verificationsResult = await client.getVerificationsByFid({ 
            fid, 
            pageToken: pageToken 
        });

        if (verificationsResult.isOk()) {
            const data = verificationsResult.value;
            const verifications = data.messages;
            
            for (const msg of verifications) {
                if (msg.data?.verificationAddAddressBody?.address) {
                    const verifiedAddress = "0x" + Buffer.from(msg.data.verificationAddAddressBody.address).toString('hex');
                    const normalizedAddr = verifiedAddress.toLowerCase();
                    
                    allFoundAddresses.push(normalizedAddr);
                    
                    if (normalizedAddr === userAddress) {
                        console.log(`[SUCCESS] Match found on Page ${pageCount}: ${verifiedAddress}`);
                        isVerified = true;
                        break;
                    }
                }
            }
            
            pageToken = data.nextPageToken;
            if (isVerified) break;

        } else {
            console.log("[DEBUG] Error fetching verifications page.");
            break;
        }

    } while (pageToken && pageToken.length > 0);

    if (!isVerified) {
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
                 const normalizedCustody = custodyAddress.toLowerCase();
                 
                 allFoundAddresses.push(normalizedCustody + " (CUSTODY)");

                 if (normalizedCustody === userAddress) {
                    console.log("[SUCCESS] Match found in Custody Address!");
                    isVerified = true;
                 }
            }
        }
    }

    client.close();

    if (!isVerified) {
        console.warn("---------------------------------------------------");
        console.warn(`[FAILED] Target: ${userAddress}`);
        console.warn(`[DEBUG] Known Addresses for FID ${fid}:`, JSON.stringify(allFoundAddresses));
        console.warn("---------------------------------------------------");
        
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'Wallet not found in Hub. It may take 30 mins to sync after verifying.' 
        }), { 
            status: 403, 
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const lockKey = `lock:fid:${fid}`;
    const acquiredLock = await kv.set(lockKey, 'processing', { nx: true, ex: 10 });
    if (!acquiredLock) {
      return new Response(JSON.stringify({ success: false, error: 'Too many requests. Please wait.' }), { status: 429 });
    }

    const now = new Date();
    const lastResetTime = new Date(now);
    lastResetTime.setUTCHours(0, 0, 0, 0);

    const lastClaimTimestamp = await kv.get<number>(`claim:fid:${fid}`);
    if (lastClaimTimestamp && lastClaimTimestamp > lastResetTime.getTime()) {
        return new Response(JSON.stringify({ success: false, error: 'You already claimed today!' }), { status: 429 });
    }

    const nonce = BigInt(Date.now());
    const account = privateKeyToAccount(SIGNER_PRIVATE_KEY);
    const messageHash = keccak256(encodePacked(['address', 'uint256', 'uint256'], [userAddress as `0x${string}`, REWARD_AMOUNT, nonce]));
    const signature = await account.signMessage({ message: { raw: toBytes(messageHash) } });

    await kv.set(`claim:fid:${fid}`, Date.now());

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