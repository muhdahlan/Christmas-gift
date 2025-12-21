import React, { useEffect, useState, useCallback } from 'react';
import { Gift, ExternalLink, Plus, Coins, Loader2, Zap, Clock, UserPlus, Star, Layers, Lock } from 'lucide-react';
import sdk from '@farcaster/frame-sdk';
import { createWalletClient, custom, createPublicClient, http } from 'viem';
import { base, arbitrum, celo } from 'viem/chains';

const ARB_UNLOCK_TIME = new Date(Date.UTC(2025, 11, 22, 8, 20, 0)).getTime();
const CELO_UNLOCK_TIME = new Date(Date.UTC(2025, 11, 23, 8, 20, 0)).getTime();

const CHAIN_CONFIG = {
    [base.id]: { name: 'Base', token: 'DEGEN', amountDisplay: '10', address: "0x410f69e4753429950bd66a3bfc12129257571df9", chainDef: base },
    [arbitrum.id]: { name: 'Arbitrum', token: 'ARB', amountDisplay: '0.1', address: "0xc5e582aB8C9f9A6C3eD612CADdB06E5814aa18EC", chainDef: arbitrum },
    [celo.id]: { name: 'Celo', token: 'CELO', amountDisplay: '0.1', address: "0xc5e582aB8C9f9A6C3eD612CADdB06E5814aa18EC", chainDef: celo }
};

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
  const [selectedChainId, setSelectedChainId] = useState<number>(base.id);
  const [isLoading, setIsLoading] = useState(false);
  const [nextClaimTime, setNextClaimTime] = useState<number | null>(null);
  const [timerDisplay, setTimerDisplay] = useState<string>("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  const activeChainConfig = CHAIN_CONFIG[selectedChainId];

  useEffect(() => {
    const checkFollow = localStorage.getItem("hasFollowedDev");
    if (checkFollow === "true") setHasFollowed(true);
    
    const timer = setInterval(() => setCurrentTime(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
      setTxHash(null);
      setErrorMsg(null);
      setNextClaimTime(null);
  }, [selectedChainId]);

  const calculateNextReset = () => {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(8, 20, 0, 0); 
    if (now.getTime() >= target.getTime()) target.setUTCDate(target.getUTCDate() + 1);
    return target.getTime();
  };

  useEffect(() => {
    if (!nextClaimTime) return;
    const interval = setInterval(() => {
      const diff = nextClaimTime - Date.now();
      if (diff <= 0) { setNextClaimTime(null); clearInterval(interval); }
      else {
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        setTimerDisplay(`${h}h ${m}m`);
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
    try {
        const client = createWalletClient({ chain: base, transport: custom(provider) });
        await client.switchChain({ id: base.id }); 
        const [addr] = await client.requestAddresses();
        setAddress(addr);
        setSelectedChainId(base.id);
    } catch (e: any) {
        setErrorMsg("Failed to connect: " + e.message);
    }
  };

  const handleFollowDev = useCallback(() => {
    sdk.actions.openUrl("https://warpcast.com/0xpocky");
    localStorage.setItem("hasFollowedDev", "true");
    setTimeout(() => setHasFollowed(true), 1000); 
  }, []);

  const executeClaim = async (targetChainId: number) => {
    if (!address) return;
    setSelectedChainId(targetChainId);
    setIsLoading(true);
    setTxHash(null); setErrorMsg(null);

    const targetConfig = CHAIN_CONFIG[targetChainId];

    try {
        const userFid = context?.user?.fid;
        
        const res = await fetch('/api/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userAddress: address, 
                fid: userFid,
                chainId: targetChainId
            })
        });

        const data = await res.json();

        if (!data.success) {
            if (data.error?.toLowerCase().includes("already claimed")) {
               setNextClaimTime(calculateNextReset());
               throw new Error(`Already claimed on ${targetConfig.name} today!`);
            }
            if (data.error?.toLowerCase().includes("locked")) {
                throw new Error(data.error);
            }
            throw new Error(data.error || "Error");
        }

        const provider = getProvider();
        const walletClient = createWalletClient({ chain: targetConfig.chainDef, transport: custom(provider!) });
        
        try {
            await walletClient.switchChain({ id: targetChainId });
        } catch (switchError: any) {
             throw new Error(`Please switch your wallet network to ${targetConfig.name}.`);
        }
        
        const publicClient = createPublicClient({ chain: targetConfig.chainDef, transport: http() });

        const { request } = await publicClient.simulateContract({
            account: address as `0x${string}`,
            address: targetConfig.address as `0x${string}`,
            abi: ABI,
            functionName: 'claim',
            args: [BigInt(data.amount), BigInt(data.nonce), data.signature]
        });

        const hash = await walletClient.writeContract(request);
        setTxHash(hash);
        
        await publicClient.waitForTransactionReceipt({ hash });
        
        alert(`Success! ${targetConfig.amountDisplay} ${targetConfig.token} Sent on ${targetConfig.name}.`);
        
        setNextClaimTime(calculateNextReset());

    } catch (err: any) {
        setErrorMsg(err.message || "Transaction failed");
    } finally {
        setIsLoading(false);
    }
  };

  const handleWarpcastShare = useCallback(() => {
    const text = encodeURIComponent(`Claiming my daily crypto across Base, Arbitrum, and Celo! 🚀\n\nMade by @0xpocky. Try it here 👇`);
    const embedUrl = encodeURIComponent(window.location.href); 
    sdk.actions.openUrl(`https://warpcast.com/~/compose?text=${text}&embeds[]=${embedUrl}`);
  }, []);

  const handleAddApp = useCallback(async () => {
    try { await sdk.actions.addFrame(); setAdded(true); } catch (e) {}
  }, []);

  const ClaimButton = ({ chainId, Icon }: { chainId: number, Icon: React.ElementType }) => {
      const config = CHAIN_CONFIG[chainId];
      const isLocked = (chainId === arbitrum.id && currentTime < ARB_UNLOCK_TIME) || 
                       (chainId === celo.id && currentTime < CELO_UNLOCK_TIME);
      const isActiveChain = selectedChainId === chainId;
      const showTimer = isActiveChain && nextClaimTime;
      const showLoading = isActiveChain && isLoading;

      if (isLocked) {
          return (
              <button disabled className="w-full flex items-center justify-center gap-2 bg-black/20 text-white/40 font-bold py-3 px-6 rounded-xl cursor-not-allowed border border-white/10">
                  <Lock className="w-5 h-5" /><span>Claim {config.token} (Locked)</span>
              </button>
          );
      }

      if (showTimer) {
          return (
              <button disabled className="w-full flex items-center justify-center gap-2 bg-gray-600 text-gray-300 font-bold py-3 px-6 rounded-xl shadow-inner cursor-not-allowed">
                  <Clock className="w-5 h-5" /><span>Next {config.token}: {timerDisplay}</span>
              </button>
          );
      }

      return (
          <button onClick={() => executeClaim(chainId)} disabled={isLoading} className={`w-full group flex items-center justify-center gap-2 font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200 hover:scale-[1.02] ${chainId === base.id ? 'bg-blue-600 hover:bg-blue-500' : chainId === celo.id ? 'bg-green-600 hover:bg-green-500' : 'bg-pink-600 hover:bg-pink-500'}`}>
              {showLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
              <span>Claim {config.amountDisplay} {config.token}</span>
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
          <h1 className="font-['Mountains_of_Christmas'] text-5xl mb-4 text-yellow-400 drop-shadow-md font-bold tracking-wide">Multi-Chain Xmas</h1>
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
                <ClaimButton chainId={base.id} Icon={Coins} />
                <ClaimButton chainId={celo.id} Icon={Layers} />
                <ClaimButton chainId={arbitrum.id} Icon={Star} />
              </>
            )}

            {txHash && (
                <a 
                    href={selectedChainId === base.id ? `https://basescan.org/tx/${txHash}` : selectedChainId === arbitrum.id ? `https://arbiscan.io/tx/${txHash}` : `https://celoscan.io/tx/${txHash}`} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-xs text-blue-300 underline mb-2"
                >
                    View Transaction on {activeChainConfig.name} Scan
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
      </div>
    </div>
  );
}

export default App;