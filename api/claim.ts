import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toBytes } from 'viem';

// Konfigurasi 10 DEGEN
const REWARD_AMOUNT = 10000000000000000000n; 

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userAddress = body.userAddress;
    
    // Pastikan env variable terbaca
    const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY as `0x${string}`;

    if (!userAddress || !SIGNER_PRIVATE_KEY) {
      return new Response(JSON.stringify({ error: 'Configuration Error: Missing Address or Key' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const nonce = BigInt(Date.now());
    const account = privateKeyToAccount(SIGNER_PRIVATE_KEY);

    // Membuat Hash yang sama dengan Smart Contract
    const messageHash = keccak256(
      encodePacked(
        ['address', 'uint256', 'uint256'],
        [userAddress as `0x${string}`, REWARD_AMOUNT, nonce]
      )
    );

    // Tanda tangan (Signing)
    const signature = await account.signMessage({
      message: { raw: toBytes(messageHash) },
    });

    // Kirim Balasan (Response standar, bukan NextResponse)
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