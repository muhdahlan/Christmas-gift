import React, { useEffect, useState, useCallback } from 'react';
import { Gift, ExternalLink, Plus } from 'lucide-react';
import sdk from '@farcaster/frame-sdk';

function App() {
  const [snowflakes, setSnowflakes] = useState<number[]>([]);
  const [context, setContext] = useState<any>(); 
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const context = await sdk.context;
        setContext(context);
        
        if (context?.client?.added) {
          setAdded(true);
        }
        
        sdk.actions.ready();
      } catch (err) {
        sdk.actions.ready();
      }
    };
    
    if (sdk && !isSDKLoaded) {
      setIsSDKLoaded(true);
      load();
    }
  }, [isSDKLoaded]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSnowflakes(prev => {
        const cleanup = prev.length > 50 ? prev.slice(1) : prev;
        return [...cleanup, Date.now()];
      });
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const handleAddApp = useCallback(async () => {
    try {
      const result = await sdk.actions.addFrame();
      
      if (result.notificationDetails) {
        setAdded(true);
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const handleWarpcastShare = useCallback(() => {
    const userName = context?.user?.username || "friend";
    const text = encodeURIComponent(`I just checked my Christmas gift! 🎄\n\nAre you on the Naughty List like @${userName}? Check yours here 👇`);
    const embedUrl = encodeURIComponent(window.location.href); 
    sdk.actions.openUrl(`https://warpcast.com/~/compose?text=${text}&embeds[]=${embedUrl}`);
  }, [context]);

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-red-900 via-red-800 to-red-950 flex items-center justify-center overflow-hidden relative font-['Poppins'] text-white">
      
      {snowflakes.map((flake) => (
        <div key={flake} className="absolute text-white pointer-events-none select-none z-0" style={{top: '-20px', left: `${Math.random() * 100}vw`, fontSize: `${Math.random() * 10 + 10}px`, animation: `fall ${Math.random() * 3 + 3}s linear forwards`, opacity: Math.random() * 0.7 + 0.3}}>❄</div>
      ))}
      <style>{`@keyframes fall { 0% { transform: translateY(-10vh) translateX(-10px); } 100% { transform: translateY(110vh) translateX(10px); } }`}</style>

      <div className="relative z-10 mx-4">
        <div className="bg-white/10 backdrop-blur-lg border border-white/20 p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center transform transition-all duration-300 hover:scale-[1.02]">
          
          <div className="flex justify-center mb-6">
            <Gift className="w-24 h-24 text-yellow-400 animate-bounce drop-shadow-lg" />
          </div>

          <h1 className="font-['Mountains_of_Christmas'] text-5xl mb-4 text-yellow-400 drop-shadow-md font-bold tracking-wide">
            Merry Christmas
          </h1>

          <p className="text-xl font-semibold mb-6 tracking-wide">
            {context?.user?.username ? `Hi @${context.user.username},` : ''} <br/>
            There are no gifts here.
          </p>

          <div className="border-t border-white/20 pt-6 mt-4 mb-8">
            <p className="text-red-200 italic font-medium text-lg leading-relaxed">
              "Get a job and stop being lazy retard."
            </p>
          </div>

          <div className="flex flex-col gap-3">
            
            <button onClick={handleWarpcastShare} className="w-full group flex items-center justify-center gap-2 bg-[#855DCD] hover:bg-[#7c54c2] text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all duration-200">
              <ExternalLink className="w-5 h-5" />
              <span>Share Prank</span>
            </button>

            {!added && (
              <button onClick={handleAddApp} className="w-full group flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200">
                <Plus className="w-5 h-5" />
                <span>Save Gift to Apps</span>
              </button>
            )}

          </div>

        </div>
      </div>
    </div>
  );
}

export default App;