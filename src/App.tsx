import React, { useEffect, useState, useCallback } from 'react';
import { Gift, ExternalLink, Plus, Coins, Loader2, Zap, Clock, UserPlus, Star } from 'lucide-react';
import sdk from '@farcaster/frame-sdk';
import { createWalletClient, custom, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const CONTRACT_ADDRESS = "0x410f69e4753429950bd66a3bfc12129257571df9"; 
const DEV_PROFILE_URL = "https://warpcast.com/0xpocky"; 

const ABI = [{
    "inputs": [
      { "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "internalType": "uint256", "name": "nonce", "type": "uint256" },
      { "internalType": "bytes", "name": "signature", "type": "bytes" }
    ],
    "name": "claim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}];

function App() {
  const [snowflakes, setSnowflakes] = useState<number[]>([]);
  const [context, setContext] = useState<any>(); 
  const [added, setAdded] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [hasFollowed, setHasFollowed] = useState(false);

  const [loadingDaily, setLoadingDaily] = useState(false);
  const [loadingBonus, setLoadingBonus] = useState(false);
  
  const [nextDaily, setNextDaily] = useState<number | null>(null);
  const [nextBonus, setNextBonus] = useState<number | null>(null);
  
  const [timeDaily, setTimeDaily] = useState<string>("");
  const [timeBonus, setTimeBonus] = useState<string>("");

  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const checkFollow = localStorage.getItem("hasFollowedDev");
    if (checkFollow === "true") setHasFollowed(true);
  }, []);

  const calculateNextReset = () => {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(8, 20, 0, 0); 
    if (now.getTime() >= target.getTime()) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime();
  };

  useEffect(() => {
    if (!nextDaily) return;
    const interval = setInterval(() => {
      const diff = nextDaily - Date.now();
      if (diff <= 0) { setNextDaily(null); clearInterval(interval); }
      else {
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        setTimeDaily(`${h}h ${m}m`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [nextDaily]);

  useEffect(() => {
    if (!nextBonus) return;
    const interval = setInterval(() => {
      const diff = nextBonus - Date.now();
      if (diff <= 0) { setNextBonus(null); clearInterval(interval); }
      else {
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        setTimeBonus(`${h}h ${m}m`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [nextBonus]);

  const getProvider = () => {
    if ((sdk as any).wallet?.ethProvider) return (sdk as any).wallet.ethProvider;
    if (typeof window !== 'undefined' && (window as any).ethereum) return (window as any).ethereum;
    return null;
  };

  useEffect(() => {
    sdk.actions.ready();
    const load = async () => {
        const context = await sdk.context;
        setContext(context);
        if (context?.client?.added) setAdded(true);
        const provider = getProvider();
        if (provider) {
            try {
                const client = createWalletClient({ chain: base, transport: custom(provider) });
                const [addr] = await client.requestAddresses();
                setAddress(addr);
            } catch (e) {}
        }
    };
    load();
  }, []);

  const handleConnect = async () => {
    const provider = getProvider();
    if (!provider) return;
    const client = createWalletClient({ chain: base, transport: custom(provider) });
    const [addr] = await client.requestAddresses();
    setAddress(addr);
  };

  const handleFollowDev = useCallback(() => {
    sdk.actions.openUrl(DEV_PROFILE_URL);
    localStorage.setItem("hasFollowedDev", "true");
    setTimeout(() => setHasFollowed(true), 1000); 
  }, []);

  const executeClaim = async (type: 'daily' | 'bonus') => {
    if (!address) return; 
    if (type === 'daily') setLoadingDaily(true); else setLoadingBonus(true);
    setTxHash(null); setErrorMsg(null);

    try {
        const userFid = context?.user?.fid;
        
        const res = await fetch('/api/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userAddress: address, 
                type: type,
                fid: userFid
            })
        });

        const data = await res.json();

        if (!data.success) {
            if (data.error?.toLowerCase().includes("already claimed")) {
               const reset = calculateNextReset();
               if (type === 'daily') setNextDaily(reset); else setNextBonus(reset);
               throw new Error("Already claimed today!");
            }
            throw new Error(data.error || "Error");
        }

        const provider = getProvider();
        const client = createWalletClient({ chain: base, transport: custom(provider!) });
        
        const { request } = await createPublicClient({ chain: base, transport: http() }).simulateContract({
            account: address as `0x${string}`,
            address: CONTRACT_ADDRESS,
            abi: ABI,
            functionName: 'claim',
            args: [BigInt(data.amount), BigInt(data.nonce), data.signature]
        });

        const hash = await client.writeContract(request);
        setTxHash(hash);
        
        const publicClient = createPublicClient({ chain: base, transport: http() });
        await publicClient.waitForTransactionReceipt({ hash });
        
        alert(`Success! ${type === 'daily' ? '10' : '5'} DEGEN Sent.`);
        if (type === 'daily') setNextDaily(calculateNextReset()); else setNextBonus(calculateNextReset());

    } catch (err: any) {
        setErrorMsg(err.message);
    } finally {
        if (type === 'daily') setLoadingDaily(false); else setLoadingBonus(false);
    }
  };

  const handleWarpcastShare = useCallback(() => {
    const text = encodeURIComponent(`Do nothing and claim your daily $DEGEN\n\nMade by @0xpocky Claim here 👇`);
    const embedUrl = encodeURIComponent(window.location.href); 
    sdk.actions.openUrl(`https://warpcast.com/~/compose?text=${text}&embeds[]=${embedUrl}`);
  }, []);

  const handleAddApp = useCallback(async () => {
    try { await sdk.actions.addFrame(); setAdded(true); } catch (e) {}
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
          
          <div className="mb-6"></div>

          <div className="flex flex-col gap-3">
            {!address ? (
              <button onClick={handleConnect} className="w-full group flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200">
                <Zap className="w-5 h-5" /><span>Connect Wallet</span>
              </button>
            ) : !hasFollowed ? (
              <button onClick={handleFollowDev} className="w-full group flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200 animate-pulse">
                <UserPlus className="w-5 h-5" /><span>Follow Dev to Unlock</span>
              </button>
            ) : (
              <>
                {nextDaily ? (
                  <button disabled className="w-full flex items-center justify-center gap-2 bg-gray-600 text-gray-300 font-bold py-3 px-6 rounded-xl shadow-inner cursor-not-allowed">
                    <Clock className="w-5 h-5" /><span>Next 10: {timeDaily}</span>
                  </button>
                ) : (
                  <button onClick={() => executeClaim('daily')} disabled={loadingDaily || loadingBonus} className="w-full group flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200 hover:scale-[1.02]">
                    {loadingDaily ? <Loader2 className="w-5 h-5 animate-spin" /> : <Coins className="w-5 h-5" />}
                    <span>Claim 10 DEGEN</span>
                  </button>
                )}

                {nextBonus ? (
                  <button disabled className="w-full flex items-center justify-center gap-2 bg-gray-600 text-gray-300 font-bold py-3 px-6 rounded-xl shadow-inner cursor-not-allowed">
                    <Clock className="w-5 h-5" /><span>Next Bonus: {timeBonus}</span>
                  </button>
                ) : (
                  <button onClick={() => executeClaim('bonus')} disabled={loadingDaily || loadingBonus} className="w-full group flex items-center justify-center gap-2 bg-pink-600 hover:bg-pink-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200 hover:scale-[1.02]">
                    {loadingBonus ? <Loader2 className="w-5 h-5 animate-spin" /> : <Star className="w-5 h-5" />}
                    <span>Claim 5 BONUS</span>
                  </button>
                )}
              </>
            )}

            {txHash && <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-xs text-blue-300 underline mb-2">View Transaction</a>}

            <button onClick={handleWarpcastShare} className="w-full group flex items-center justify-center gap-2 bg-[#855DCD] hover:bg-[#7c54c2] text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200">
              <ExternalLink className="w-5 h-5" /><span>Share</span>
            </button>
            
            {!added && (
              <button onClick={handleAddApp} className="w-full group flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200">
                <Plus className="w-5 h-5" /><span>Save Gift</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;