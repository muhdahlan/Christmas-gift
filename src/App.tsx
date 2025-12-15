import React, { useEffect, useState, useCallback } from 'react';
import { Gift, ExternalLink, Plus, Coins, Loader2, Zap, Clock } from 'lucide-react';
import sdk, { type Context } from '@farcaster/frame-sdk';
import { createWalletClient, custom, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

// --- CONFIG ---
const CONTRACT_ADDRESS = "0x410f69e4753429950bd66a3bfc12129257571df9";

const ABI = [
  {
    "inputs": [
      { "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "internalType": "uint256", "name": "nonce", "type": "uint256" },
      { "internalType": "bytes", "name": "signature", "type": "bytes" }
    ],
    "name": "claimSecure",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

function App() {
  const [snowflakes, setSnowflakes] = useState<number[]>([]);
  const [context, setContext] = useState<any>(); 
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [added, setAdded] = useState(false);
  
  const [address, setAddress] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // STATE BARU: Untuk Timer
  const [nextClaimTime, setNextClaimTime] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>("");

  // --- LOGIKA TIMER (Hitung mundur ke 08:00 WITA / 00:00 UTC) ---
  const calculateNextReset = () => {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(0, 0, 0, 0); // 00:00 UTC = 08:00 WITA
    
    // Jika jam 00:00 UTC sudah lewat, targetnya besok
    if (now.getTime() >= target.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    return target.getTime();
  };

  useEffect(() => {
    if (!nextClaimTime) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = nextClaimTime - now;

      if (diff <= 0) {
        setNextClaimTime(null); // Timer habis, tombol muncul lagi
        clearInterval(interval);
      } else {
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [nextClaimTime]);

  const getProvider = () => {
    if ((sdk as any).wallet?.ethProvider) return (sdk as any).wallet.ethProvider;
    if (typeof window !== 'undefined' && (window as any).ethereum) return (window as any).ethereum;
    return null;
  };

  useEffect(() => {
    const load = async () => {
      try {
        const context = await sdk.context;
        setContext(context);
        if (context?.client?.added) setAdded(true);

        const provider = getProvider();
        if (provider) {
          try {
            const client = createWalletClient({ chain: base, transport: custom(provider) });
            const [connectedAddress] = await client.requestAddresses();
            if (connectedAddress) setAddress(connectedAddress);
          } catch (e) {
            console.log("Auto-connect info: Manual connect needed");
          }
        }
        sdk.actions.ready();
      } catch (err) { sdk.actions.ready(); }
    };
    if (sdk && !isSDKLoaded) { setIsSDKLoaded(true); load(); }
  }, [isSDKLoaded]);

  const handleConnect = async () => {
    setErrorMsg(null);
    const provider = getProvider();
    if (!provider) { setErrorMsg("Wallet not found. Open in Warpcast Mobile."); return; }
    try {
      const client = createWalletClient({ chain: base, transport: custom(provider) });
      const [connectedAddress] = await client.requestAddresses();
      setAddress(connectedAddress);
    } catch (error) { setErrorMsg("Connection failed. Please retry."); }
  };

  const handleClaim = async () => {
    if (!address) return;
    setIsClaiming(true); setTxHash(null); setErrorMsg(null);
    
    try {
      // 1. Minta Signature ke Backend
      const response = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: address }),
      });

      const data = await response.json();

      // Jika Backend menolak (Limit Habis), aktifkan Timer
      if (!data.success) {
        if (data.error && data.error.includes("Daily limit")) {
           setNextClaimTime(calculateNextReset()); // Aktifkan Timer
           throw new Error("You already claimed today! Come back at 08:00 AM WITA.");
        }
        throw new Error(data.error || "Server error");
      }

      // 2. Eksekusi Smart Contract
      const provider = getProvider();
      const client = createWalletClient({ chain: base, transport: custom(provider) });
      
      const { request } = await createPublicClient({ chain: base, transport: http() }).simulateContract({
        account: address as `0x${string}`,
        address: CONTRACT_ADDRESS,
        abi: ABI,
        functionName: 'claimSecure',
        args: [BigInt(data.amount), BigInt(data.nonce), data.signature],
      });

      const hash = await client.writeContract(request);
      setTxHash(hash);
      
      const publicClient = createPublicClient({ chain: base, transport: http() });
      await publicClient.waitForTransactionReceipt({ hash });
      
      alert("Success! 10 DEGEN Secured & Claimed.");
      
      // Sukses Klaim -> Aktifkan Timer
      setNextClaimTime(calculateNextReset());

    } catch (error: any) {
      console.error("Claim failed:", error);
      if (error.message.includes("Signature")) setErrorMsg("Security check failed.");
      else if (error.message.includes("already claimed")) setErrorMsg(error.message); // Pesan dari timer
      else setErrorMsg("Claim failed or rejected.");
    } finally { setIsClaiming(false); }
  };

  const handleWarpcastShare = useCallback(() => {
    const text = encodeURIComponent(`I just claimed 10 $DEGEN! 🎁\n\nSecure & Anti-Bot. Claim yours here 👇`);
    const embedUrl = encodeURIComponent(window.location.href); 
    sdk.actions.openUrl(`https://warpcast.com/~/compose?text=${text}&embeds[]=${embedUrl}`);
  }, []);

  const handleAddApp = useCallback(async () => {
    try {
      const result = await sdk.actions.addFrame();
      if (result.notificationDetails) setAdded(true);
    } catch (error) { console.error(error); }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setSnowflakes(prev => {
        const cleanup = prev.length > 50 ? prev.slice(1) : prev;
        return [...cleanup, Date.now()];
      });
    }, 200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-red-900 via-red-800 to-red-950 flex items-center justify-center overflow-hidden relative font-['Poppins'] text-white">
      {snowflakes.map((flake) => (
        <div key={flake} className="absolute text-white pointer-events-none select-none z-0" style={{top: '-20px', left: `${Math.random() * 100}vw`, fontSize: `${Math.random() * 10 + 10}px`, animation: `fall ${Math.random() * 3 + 3}s linear forwards`, opacity: Math.random() * 0.7 + 0.3}}>❄</div>
      ))}
      <style>{`@keyframes fall { 0% { transform: translateY(-10vh) translateX(-10px); } 100% { transform: translateY(110vh) translateX(10px); } }`}</style>

      <div className="relative z-10 mx-4">
        <div className="bg-white/10 backdrop-blur-lg border border-white/20 p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center transform transition-all duration-300 hover:scale-[1.02]">
          <div className="flex justify-center mb-6"><Gift className="w-24 h-24 text-yellow-400 animate-bounce drop-shadow-lg" /></div>
          <h1 className="font-['Mountains_of_Christmas'] text-5xl mb-4 text-yellow-400 drop-shadow-md font-bold tracking-wide">Merry Christmas</h1>
          <p className="text-xl font-semibold mb-6 tracking-wide">{context?.user?.username ? `Hi @${context.user.username}!` : ''}</p>
          
          {errorMsg && <div className="mb-4 p-2 bg-red-500/50 rounded-lg text-sm text-white font-medium animate-pulse">{errorMsg}</div>}

          <div className="border-t border-white/20 pt-6 mt-4 mb-8">
            <p className="text-yellow-200 font-medium text-lg leading-relaxed">Connect wallet and claim your REAL DEGEN tokens (Base).</p>
          </div>

          <div className="flex flex-col gap-3">
            {!address ? (
              <button onClick={handleConnect} className="w-full group flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200">
                <Zap className="w-5 h-5" /><span>Connect Farcaster Wallet</span>
              </button>
            ) : nextClaimTime ? (
              // --- TAMPILAN JIKA SEDANG COOLDOWN (TIMER) ---
              <button disabled className="w-full flex items-center justify-center gap-2 bg-gray-600 text-gray-300 font-bold py-3 px-6 rounded-xl shadow-inner cursor-not-allowed">
                <Clock className="w-5 h-5 animate-pulse" />
                <span>Next: {timeLeft}</span>
              </button>
            ) : (
              // --- TAMPILAN NORMAL (TOMBOL CLAIM) ---
              <button onClick={handleClaim} disabled={isClaiming} className="w-full group flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200 transform hover:scale-[1.02] animate-pulse">
                {isClaiming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Coins className="w-5 h-5" />}<span>Claim 10 DEGEN</span>
              </button>
            )}

            {txHash && <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-xs text-blue-300 underline mb-2">View Transaction on Basescan</a>}

            <button onClick={handleWarpcastShare} className="w-full group flex items-center justify-center gap-2 bg-[#855DCD] hover:bg-[#7c54c2] text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200">
              <ExternalLink className="w-5 h-5" /><span>Share</span>
            </button>
            {!added && (
              <button onClick={handleAddApp} className="w-full group flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200">
                <Plus className="w-5 h-5" /><span>Save Gift to Apps</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;