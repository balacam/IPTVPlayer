import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { ExternalLink, Copy, Info, Loader, AlertCircle, Volume2, VolumeX, RotateCcw } from 'lucide-react';

const isElectron = () => {
    try { return !!window.require; } catch { return false; }
};

const Player = ({ channel }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const mpegtsRef = useRef(null);
    const retryTimeoutRef = useRef(null);
    const [showUrl, setShowUrl] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('player-volume');
        return saved ? parseFloat(saved) : 1;
    });
    const [isMuted, setIsMuted] = useState(false);
    const [bufferInfo, setBufferInfo] = useState('');

    const destroyPlayers = useCallback(() => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (mpegtsRef.current) {
            mpegtsRef.current.destroy();
            mpegtsRef.current = null;
        }
    }, []);

    const playWithMpegts = useCallback((url, video) => {
        if (!mpegts.isSupported()) return false;
        
        console.log('Using mpegts.js with aggressive buffering');
        const player = mpegts.createPlayer({
            type: 'mpegts',
            url: url,
            isLive: true,
            hasAudio: true,
            hasVideo: true,
        }, {
            // Worker & Performance
            enableWorker: true,
            enableStashBuffer: true,
            
            // Aggressive buffering like VLC (large buffers)
            stashInitialSize: 1024 * 1024 * 2,  // 2MB initial buffer
            
            // Live stream settings - disable latency chasing for stability
            isLive: true,
            liveBufferLatencyChasing: false,
            liveBufferLatencyMaxLatency: 60,     // Allow up to 60 seconds latency
            liveBufferLatencyMinRemain: 10,      // Keep at least 10 seconds buffer
            
            // Auto cleanup to prevent memory issues
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: 120,  // Keep 2 minutes of backward buffer
            autoCleanupMinBackwardDuration: 60,   // At least 1 minute backward
            
            // Loading behavior
            lazyLoad: false,
            lazyLoadMaxDuration: 0,
            deferLoadAfterSourceOpen: false,
            
            // Fix audio/video sync issues
            fixAudioTimestampGap: true,
            accurateSeek: false,
            
            // Network settings
            seekType: 'range',
            reuseRedirectedURL: true,
        });

        mpegtsRef.current = player;
        player.attachMediaElement(video);
        player.load();

        player.on(mpegts.Events.METADATA_ARRIVED, () => {
            setIsLoading(false);
            video.play().catch(() => {});
        });

        player.on(mpegts.Events.ERROR, (type, detail) => {
            console.error('MPEGTS Error:', type, detail);
            // Auto retry on error
            retryTimeoutRef.current = setTimeout(() => {
                console.log('Auto-retrying...');
                player.unload();
                player.load();
                video.play().catch(() => {});
            }, 2000);
        });

        setTimeout(() => {
            if (video.readyState >= 2) {
                setIsLoading(false);
                video.play().catch(() => {});
            }
        }, 3000);

        return true;
    }, []);


    const playWithHls = useCallback((url, video) => {
        if (!Hls.isSupported()) return false;
        
        console.log('Using HLS.js');
        const hls = new Hls({
            enableWorker: true,
            fragLoadingTimeOut: 20000,
            manifestLoadingTimeOut: 20000,
        });
        
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.loadSource(url);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setIsLoading(false);
            video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    console.log('HLS failed, trying MPEG-TS...');
                    hls.destroy();
                    hlsRef.current = null;
                    playWithMpegts(url, video);
                }
            }
        });

        return true;
    }, [playWithMpegts]);

    const playChannel = useCallback((url, retryCount = 0) => {
        const video = videoRef.current;
        if (!video || !url) return;

        destroyPlayers();
        video.pause();
        video.removeAttribute('src');
        video.load();
        setError(null);
        setIsLoading(true);

        console.log('Playing:', url, 'Retry:', retryCount);

        // Try HLS first, fallback to MPEG-TS
        if (!playWithHls(url, video)) {
            playWithMpegts(url, video);
        }

        // Auto-retry if not playing after 30 seconds (no timeout error, just retry)
        retryTimeoutRef.current = setTimeout(() => {
            if (video.readyState < 2 && retryCount < 3) {
                console.log('Auto-retrying... attempt', retryCount + 1);
                playChannel(url, retryCount + 1);
            } else if (video.readyState < 2) {
                // After 3 retries, show error but allow manual retry
                setIsLoading(false);
                setError('Bağlantı kurulamadı - Tekrar deneyin veya VLC kullanın');
            }
        }, 30000);
    }, [destroyPlayers, playWithHls, playWithMpegts]);

    // Auto-reload when video stalls + buffer monitoring
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !channel) return;

        const handleStalled = () => {
            console.log('Video stalled, will retry...');
            setBufferInfo('Buffering...');
            retryTimeoutRef.current = setTimeout(() => {
                if (channel?.url) {
                    console.log('Retrying after stall...');
                    playChannel(channel.url);
                }
            }, 5000);
        };

        const handleEnded = () => {
            console.log('Stream ended, reloading...');
            if (channel?.url) {
                setTimeout(() => playChannel(channel.url), 1000);
            }
        };

        const handleWaiting = () => {
            setBufferInfo('Buffering...');
        };

        const handlePlaying = () => {
            setBufferInfo('');
            setIsLoading(false);
        };

        // Monitor buffer level
        const bufferInterval = setInterval(() => {
            if (video.buffered.length > 0) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                const bufferAhead = bufferedEnd - video.currentTime;
                if (bufferAhead > 0) {
                    setBufferInfo(`Buffer: ${bufferAhead.toFixed(1)}s`);
                }
            }
        }, 2000);

        video.addEventListener('stalled', handleStalled);
        video.addEventListener('ended', handleEnded);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);

        return () => {
            clearInterval(bufferInterval);
            video.removeEventListener('stalled', handleStalled);
            video.removeEventListener('ended', handleEnded);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
        };
    }, [channel, playChannel]);

    useEffect(() => {
        if (!channel) {
            destroyPlayers();
            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.removeAttribute('src');
            }
            setError(null);
            setIsLoading(false);
            return;
        }

        if (channel.url.includes('get.php') || channel.url.includes('type=m3u')) return;

        playChannel(channel.url);
        return () => destroyPlayers();
    }, [channel]);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = isMuted ? 0 : volume;
        }
    }, [volume, isMuted]);

    const handleVolumeChange = (e) => {
        const v = parseFloat(e.target.value);
        setVolume(v);
        setIsMuted(v === 0);
        localStorage.setItem('player-volume', v.toString());
    };

    const openInVLC = async () => {
        if (channel?.url && isElectron()) {
            try {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('open-external-player', channel.url, 'vlc');
            } catch (err) {
                console.error('VLC error:', err);
            }
        }
    };

    const retryPlay = () => channel?.url && playChannel(channel.url);


    if (!channel) {
        return (
            <div className="flex-1 bg-gray-900 flex flex-col items-center justify-center text-gray-500">
                <span className="text-6xl mb-4">▶</span>
                <p className="text-lg mb-2">Oynatmak için bir kanal seçin</p>
                <p className="text-sm text-gray-600">Çift tıklama ile VLC'de açılır</p>
            </div>
        );
    }

    return (
        <div className="flex-1 bg-gray-900 flex flex-col">
            <div className="flex-1 relative bg-black flex items-center justify-center">
                <video
                    ref={videoRef}
                    controls
                    autoPlay
                    playsInline
                    preload="auto"
                    className="w-full h-full object-contain"
                    style={{ backgroundColor: '#000' }}
                />

                {isLoading && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                        <div className="text-center">
                            <Loader className="animate-spin text-orange-500 mx-auto mb-3" size={48} />
                            <p className="text-white text-lg">Yükleniyor...</p>
                            <p className="text-gray-400 text-sm mt-1 mb-4">{channel.name}</p>
                            <button onClick={openInVLC} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm mx-auto">
                                <ExternalLink size={16} /> VLC'de Aç
                            </button>
                        </div>
                    </div>
                )}

                {error && !isLoading && (
                    <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                        <div className="text-center p-6">
                            <AlertCircle className="text-red-500 mx-auto mb-3" size={48} />
                            <p className="text-white text-lg mb-4">{error}</p>
                            <div className="flex gap-2 justify-center">
                                <button onClick={retryPlay} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2">
                                    <RotateCcw size={18} /> Tekrar Dene
                                </button>
                                <button onClick={openInVLC} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2">
                                    <ExternalLink size={18} /> VLC
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-3 bg-gray-800 border-t border-gray-700">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-sm font-semibold text-white truncate">{channel.name}</h2>
                        <p className="text-xs text-gray-400 truncate">
                            {channel.group}
                            {bufferInfo && <span className="ml-2 text-orange-400">{bufferInfo}</span>}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setIsMuted(!isMuted)} className="text-gray-400 hover:text-white">
                            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>
                        <input type="range" min="0" max="1" step="0.1" value={isMuted ? 0 : volume} onChange={handleVolumeChange}
                            className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-orange-500" />
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setShowUrl(!showUrl)} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-xs" title="URL Göster">
                            <Info size={14} />
                        </button>
                        <button onClick={() => channel?.url && navigator.clipboard.writeText(channel.url)} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-xs" title="Kopyala">
                            <Copy size={14} />
                        </button>
                        <button onClick={openInVLC} className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1">
                            <ExternalLink size={14} /> VLC
                        </button>
                    </div>
                </div>
                {showUrl && <div className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-400 break-all font-mono">{channel.url}</div>}
            </div>
        </div>
    );
};

export default Player;
