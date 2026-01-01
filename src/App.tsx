import React, { useEffect, useState, useCallback } from 'react';
import { Gift, ExternalLink, Plus, Coins, Loader2, Zap, Clock, UserPlus, Coffee, Sparkles, Lock } from 'lucide-react';
import sdk from '@farcaster/frame-sdk';
import { createWalletClient, custom, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const DEGEN_TOKEN_ADDRESS = "0x410f69e4753429950bd66a3bfc12129257571df9";
const YOUR_OWN_GM_CONTRACT_ADDRESS = "0x8fDc3AED01a0b12c00D480977ad16a16A87cb9E7";

const YOUR_GM_ABI = [
    {
        "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
        "name": "lastGMDay",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "gm",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
] as const;

const CLAIM_ABI = [{
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
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [hasGMed, setHasGMed] = useState(false);
  const [isGMLoading, setIsGMLoading] = useState(true);

  const [nextMainClaimTime, setNextMainClaimTime] = useState<number | null>(null);
  const [nextBonusClaimTime, setNextBonusClaimTime] = useState<number | null>(null);
  const [mainTimerDisplay, setMainTimerDisplay] = useState<string>("");
  const [bonusTimerDisplay, setBonusTimerDisplay] = useState<string>("");

  const getCurrentUTCDay = () => Math.floor(Date.now() / 1000 / 86400);

  const checkGMStatus = useCallback(async (userAddr: string) => {
    setIsGMLoading(true);
    try {
        const publicClient = createPublicClient({ chain: base, transport: http() });
        const lastDayBigInt = await publicClient.readContract({
            address: YOUR_OWN_GM_CONTRACT_ADDRESS as `0x${string}`,
            abi: YOUR_GM_ABI,
            functionName: 'lastGMDay',
            args: [userAddr as `0x${string}`]
        });

        if (Number(lastDayBigInt) === getCurrentUTCDay()) {
            setHasGMed(true);
        } else {
            setHasGMed(false);
        }
    } catch (error) {
        console.error("Failed to check GM status:", error);
        setHasGMed(false);
    } finally {
        setIsGMLoading(false);
    }
  }, []);

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
    if (!nextMainClaimTime) return;
    const interval = setInterval(() => {
      const diff = nextMainClaimTime - Date.now();
      if (diff <= 0) { setNextMainClaimTime(null); clearInterval(interval); }
      else { setMainTimerDisplay(formatTimer(diff)); }
    }, 1000);
    return () => clearInterval(interval);
  }, [nextMainClaimTime]);

  useEffect(() => {
    if (!nextBonusClaimTime) return;
    const interval = setInterval(() => {
      const diff = nextBonusClaimTime - Date.now();
      if (diff <= 0) { setNextBonusClaimTime(null); clearInterval(interval); }
      else { setBonusTimerDisplay(formatTimer(diff)); }
    }, 1000);
    return () => clearInterval(interval);
  }, [nextBonusClaimTime]);

  const formatTimer = (diff: number) => {
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      return `${h}h ${m}m ${s}s`;
  }

  const getProvider = () => {
    if ((sdk as any).wallet?.ethProvider) return (sdk as any).wallet.ethProvider;
    if (typeof window !== 'undefined' && (window as any).ethereum) return (window as any).ethereum;
    return null;
  };

  useEffect(() => {
    const load = async () => {
        // Priority: Signal ready immediately to prevent "Not Ready" timeout
        sdk.actions.ready();

        try {
            const context = await sdk.context;
            setContext(context);
            if (context?.client?.added) setAdded(true);
        } catch (err) {
            console.error("Error loading context:", err);
        }
        
        const provider = getProvider();
        if (provider) {
            try {
                const client = createWalletClient({ chain: base, transport: custom(provider) });
                const [addr] = await client.requestAddresses();
                setAddress(addr);
                checkGMStatus(addr);
            } catch (e) {
                console.error("Auto connect error", e);
            }
        }
    };

    if (sdk && !isSDKLoaded) {
        setIsSDKLoaded(true);
        load();
    }
  }, [isSDKLoaded, checkGMStatus]);

  const handleConnect = async () => {
    const provider = getProvider();
    if (!provider) return;
    try {
        const client = createWalletClient({ chain: base, transport: custom(provider) });
        await client.switchChain({ id: base.id }); 
        const [addr] = await client.requestAddresses();
        setAddress(addr);
        checkGMStatus(addr);
    } catch (e: any) {
        setErrorMsg("Failed to connect: " + e.message);
    }
  };

  const handleFollowDev = useCallback(() => {
    sdk.actions.openUrl("https://warpcast.com/0xpocky");
    localStorage.setItem("hasFollowedDev", "true");
    setTimeout(() => setHasFollowed(true), 1000); 
  }, []);

  const executeGM = async () => {
    if (!address) return;
    setIsLoading(true);
    setErrorMsg(null);
    setTxHash(null);

    try {
        const provider = getProvider();
        const walletClient = createWalletClient({ chain: base, transport: custom(provider!) });
        await walletClient.switchChain({ id: base.id });
        const publicClient = createPublicClient({ chain: base, transport: http() });

        const { request } = await publicClient.simulateContract({
            account: address as `0x${string}`,
            address: YOUR_OWN_GM_CONTRACT_ADDRESS as `0x${string}`,
            abi: YOUR_GM_ABI,
            functionName: 'gm',
            args: []
        });

        const hash = await walletClient.writeContract(request);
        setTxHash(hash);
        await publicClient.waitForTransactionReceipt({ hash });

        setHasGMed(true);
        alert("GM Successful! Claims unlocked.");

    } catch (err: any) {
        if (err.message.includes("Already GMed today")) {
            setErrorMsg("You have already GM'ed today!");
            setHasGMed(true);
        } else {
            setErrorMsg(err.message || "GM Transaction failed");
        }
    } finally {
        setIsLoading(false);
    }
  };

  const executeClaim = async (claimType: 'main' | 'bonus') => {
    if (!address) return;
    if (!hasGMed) { setErrorMsg("Please GM on-chain first!"); return; }

    setIsLoading(true);
    setTxHash(null); setErrorMsg(null);

    try {
        const userFid = context?.user?.fid;
        
        const res = await fetch('/api/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userAddress: address, 
                fid: userFid,
                claimType: claimType
            })
        });

        const data = await res.json();

        if (!data.success) {
            if (data.error?.toLowerCase().includes("already claimed")) {
               if (claimType === 'main') setNextMainClaimTime(calculateNextReset());
               else setNextBonusClaimTime(calculateNextReset());

               const typeMsg = claimType === 'bonus' ? 'Bonus' : 'Main';
               throw new Error(`Already claimed the ${typeMsg} reward today!`);
            }
            throw new Error(data.error || "Error");
        }

        const provider = getProvider();
        const walletClient = createWalletClient({ chain: base, transport: custom(provider!) });
        await walletClient.switchChain({ id: base.id });
        const publicClient = createPublicClient({ chain: base, transport: http() });

        const { request } = await publicClient.simulateContract({
            account: address as `0x${string}`,
            address: DEGEN_TOKEN_ADDRESS as `0x${string}`,
            abi: CLAIM_ABI,
            functionName: 'claim',
            args: [BigInt(data.amount), BigInt(data.nonce), data.signature]
        });

        const hash = await walletClient.writeContract(request);
        setTxHash(hash);
        
        await publicClient.waitForTransactionReceipt({ hash });
        
        const amountDisplay = claimType === 'bonus' ? '2' : '10';
        alert(`Success! ${amountDisplay} DEGEN Sent.`);
        
        if (claimType === 'main') setNextMainClaimTime(calculateNextReset());
        else setNextBonusClaimTime(calculateNextReset());

    } catch (err: any) {
        setErrorMsg(err.message || "Transaction failed");
    } finally {
        setIsLoading(false);
    }
  };

  const handleWarpcastShare = useCallback(() => {
    const text = encodeURIComponent(`Just GM'ed and claimed my daily DEGEN rewards! 🎩\n\nMade by @0xpocky. Try it here 👇`);
    const embedUrl = encodeURIComponent(window.location.href); 
    sdk.actions.openUrl(`https://warpcast.com/~/compose?text=${text}&embeds[]=${embedUrl}`);
  }, []);

  const handleAddApp = useCallback(async () => {
    try { await sdk.actions.addFrame(); setAdded(true); } catch (e) {}
  }, []);

  const ClaimButton = ({ type, amount, Icon, timer, timerDisplay, hasGMed }: { type: 'main' | 'bonus', amount: string, Icon: React.ElementType, timer: number | null, timerDisplay: string, hasGMed: boolean }) => {
      const isBonus = type === 'bonus';
      const bgColorStr = isBonus ? 'bg-purple-600 hover:bg-purple-500' : 'bg-blue-600 hover:bg-blue-500';
      const labelStr = isBonus ? `Claim Bonus ${amount} DEGEN` : `Claim ${amount} DEGEN`;

      if (!hasGMed) {
          return (
              <button disabled className="w-full flex items-center justify-center gap-2 bg-gray-700/50 text-gray-400 font-bold py-3 px-6 rounded-xl shadow-inner cursor-not-allowed mb-3 border border-gray-600/30">
                  <Lock className="w-5 h-5" /><span>GM On-Chain First</span>
              </button>
          );
      }

      if (timer) {
          return (
              <button disabled className="w-full flex items-center justify-center gap-2 bg-gray-600 text-gray-300 font-bold py-3 px-6 rounded-xl shadow-inner cursor-not-allowed mb-3">
                  <Clock className="w-5 h-5" /><span>Next: {timerDisplay}</span>
              </button>
          );
      }

      return (
          <button onClick={() => executeClaim(type)} disabled={isLoading} className={`w-full group flex items-center justify-center gap-2 font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200 hover:scale-[1.02] mb-3 ${bgColorStr}`}>
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
              <span>{labelStr}</span>
          </button>
      );
  };

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
          <h1 className="font-['Mountains_of_Christmas'] text-5xl mb-4 text-yellow-400 drop-shadow-md font-bold tracking-wide">DEGEN Xmas</h1>
          <p className="text-xl font-semibold mb-6 tracking-wide">{context?.user?.username ? `Hi @${context.user.username}!` : ''}</p>
          
          {errorMsg && <div className="mb-4 p-2 bg-red-500/50 rounded-lg text-sm text-white font-medium animate-pulse break-words">{errorMsg}</div>}
          
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
                {isGMLoading ? (
                    <div className="flex justify-center py-4 mb-3"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div>
                ) : !hasGMed ? (
                    <button onClick={executeGM} disabled={isLoading} className="w-full group flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200 animate-bounce mb-3">
                        <Coffee className="w-5 h-5" /><span>GM On-Chain to Unlock</span>
                    </button>
                ) : (
                    <div className="text-green-400 font-bold mb-4 flex items-center justify-center gap-2 bg-green-900/30 py-2 rounded-lg border border-green-500/30">
                        <Coffee className="w-5 h-5" /> GM'ed Today! Claims Unlocked.
                    </div>
                )}

                <ClaimButton type="main" amount="10" Icon={Coins} timer={nextMainClaimTime} timerDisplay={mainTimerDisplay} hasGMed={hasGMed} />
                <ClaimButton type="bonus" amount="2" Icon={Sparkles} timer={nextBonusClaimTime} timerDisplay={bonusTimerDisplay} hasGMed={hasGMed} />
              </>
            )}

            {txHash && (
                <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-xs text-blue-300 underline mb-2 block">
                    View Transaction on Basescan
                </a>
            )}

            <button onClick={handleWarpcastShare} className="w-full group flex items-center justify-center gap-2 bg-[#855DCD] hover:bg-[#7c54c2] text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200">
              <ExternalLink className="w-5 h-5" /><span>Share</span>
            </button>
            
            {!added && (
              <button onClick={handleAddApp} className="w-full group flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200">
                <Plus className="w-5 h-5" /><span>Save App</span>
              </button>
            )}
          </div>
        </div>
        <div className="text-center text-white/50 text-sm mt-6">
          Built with ❤️ by <a href="https://warpcast.com/0xpocky" target="_blank" rel="noreferrer" className="hover:text-white/80 underline">@0xpocky</a>
        </div>
      </div>
    </div>
  );
}

export default App;