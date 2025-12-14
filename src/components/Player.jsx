import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { ExternalLink, Copy, Info, Loader, AlertCircle, Volume2, VolumeX, RotateCcw } from 'lucide-react';

// Check if running in Electron
const isElectron = () => {
    try {
        return !!window.require;
    } catch {
        return false;
    }
};

// Get proxy URL for stream
const getProxyUrl = async (streamUrl) => {
    if (!isElectron()) return streamUrl;
    try {
        const { ipcRenderer } = window.require('electron');
        return await ipcRenderer.invoke('get-proxy-url', streamUrl);
    } catch {
        return streamUrl;
    }
};

// Detect stream type from URL
const detectStreamType = (url) => {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('.m3u8')) return 'hls';
    if (lowerUrl.includes('.ts')) return 'mpegts';
    if (lowerUrl.includes('.mp4')) return 'mp4';
    if (lowerUrl.includes('.flv')) return 'flv';
    // IPTV URLs without extension are usually MPEG-TS
    if (lowerUrl.match(/:\d+\/\w+\/\w+\/\d+$/)) return 'mpegts';
    return 'unknown';
};

const Player = ({ channel }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const mpegtsRef = useRef(null);
    const [showUrl, setShowUrl] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('player-volume');
        return saved ? parseFloat(saved) : 1;
    });
    const [isMuted, setIsMuted] = useState(false);
    const [streamType, setStreamType] = useState('');

    // Cleanup all player instances
    const destroyPlayers = useCallback(() => {
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (mpegtsRef.current) {
            mpegtsRef.current.destroy();
            mpegtsRef.current = null;
        }
    }, []);


    // Play with MPEG-TS player
    const playWithMpegts = useCallback((url, video) => {
        console.log('Using mpegts.js for MPEG-TS stream');
        
        if (mpegts.isSupported()) {
            const player = mpegts.createPlayer({
                type: 'mpegts',
                url: url,
                isLive: true,
            }, {
                enableWorker: true,
                enableStashBuffer: false,
                stashInitialSize: 128,
                liveBufferLatencyChasing: true,
                liveBufferLatencyMaxLatency: 1.5,
                liveBufferLatencyMinRemain: 0.3,
            });

            mpegtsRef.current = player;
            player.attachMediaElement(video);
            player.load();
            
            player.on(mpegts.Events.LOADING_COMPLETE, () => {
                console.log('MPEGTS: Loading complete');
            });

            player.on(mpegts.Events.METADATA_ARRIVED, () => {
                console.log('MPEGTS: Metadata arrived');
                setIsLoading(false);
                video.play().catch(e => console.warn('Autoplay blocked:', e));
            });

            player.on(mpegts.Events.ERROR, (type, detail) => {
                console.error('MPEGTS Error:', type, detail);
                setIsLoading(false);
                setError('Stream oynatılamadı - VLC ile deneyin');
            });

            // Fallback play after short delay
            setTimeout(() => {
                if (video.readyState >= 2) {
                    setIsLoading(false);
                    video.play().catch(e => console.warn('Autoplay blocked:', e));
                }
            }, 2000);

            return true;
        }
        return false;
    }, []);

    // Play with HLS.js
    const playWithHls = useCallback((url, video) => {
        console.log('Using HLS.js for HLS stream');
        
        if (Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 90,
                maxBufferLength: 30,
                fragLoadingTimeOut: 20000,
                manifestLoadingTimeOut: 20000,
                fragLoadingMaxRetry: 3,
                manifestLoadingMaxRetry: 3,
            });
            
            hlsRef.current = hls;
            hls.attachMedia(video);
            hls.loadSource(url);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('HLS: Manifest parsed');
                setIsLoading(false);
                video.play().catch(e => console.warn('Autoplay blocked:', e));
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
                console.error('HLS Error:', data.type, data.details);
                if (data.fatal) {
                    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        hls.recoverMediaError();
                    } else {
                        // HLS failed, might be MPEG-TS stream
                        console.log('HLS failed, trying MPEG-TS...');
                        hls.destroy();
                        hlsRef.current = null;
                        if (!playWithMpegts(url, video)) {
                            setIsLoading(false);
                            setError('Stream oynatılamadı - VLC ile deneyin');
                        }
                    }
                }
            });

            return true;
        }
        return false;
    }, [playWithMpegts]);


    // Main play function
    const playChannel = useCallback(async (originalUrl, useProxy = false) => {
        const video = videoRef.current;
        if (!video || !originalUrl) return;

        destroyPlayers();
        video.pause();
        video.removeAttribute('src');
        video.load();

        setError(null);
        setIsLoading(true);

        // Get URL (with or without proxy)
        let url = originalUrl;
        if (useProxy && isElectron()) {
            try {
                url = await getProxyUrl(originalUrl);
                console.log('Using proxy URL:', url);
            } catch (e) {
                console.warn('Failed to get proxy URL:', e);
            }
        }

        const type = detectStreamType(originalUrl);
        setStreamType(type);
        console.log('Playing URL:', url, 'Detected type:', type);

        // Try based on detected type
        if (type === 'mp4') {
            video.src = url;
            video.onloadeddata = () => {
                setIsLoading(false);
                video.play().catch(e => console.warn('Autoplay blocked:', e));
            };
            video.onerror = () => {
                setIsLoading(false);
                setError('Video oynatılamadı');
            };
            video.load();
        } else if (type === 'hls' || type === 'unknown') {
            // Try HLS first, it will fallback to MPEG-TS if needed
            if (!playWithHls(url, video)) {
                playWithMpegts(url, video);
            }
        } else if (type === 'mpegts' || type === 'flv') {
            // Direct MPEG-TS stream
            if (!playWithMpegts(url, video)) {
                // Fallback to direct video src
                video.src = url;
                video.oncanplay = () => {
                    setIsLoading(false);
                    video.play().catch(e => console.warn('Autoplay blocked:', e));
                };
                video.onerror = () => {
                    setIsLoading(false);
                    setError('Stream oynatılamadı - VLC ile deneyin');
                };
                video.load();
            }
        }

        // Timeout
        setTimeout(() => {
            if (isLoading) {
                setIsLoading(false);
                if (!video.readyState) {
                    setError('Yükleme zaman aşımı - Proxy veya VLC ile deneyin');
                }
            }
        }, 15000);
    }, [destroyPlayers, playWithHls, playWithMpegts, isLoading]);

    // Retry functions
    const retryWithProxy = useCallback(() => {
        if (channel?.url) {
            console.log('Retrying with proxy...');
            playChannel(channel.url, true);
        }
    }, [channel, playChannel]);

    const retryDirect = useCallback(() => {
        if (channel?.url) {
            console.log('Retrying direct...');
            playChannel(channel.url, false);
        }
    }, [channel, playChannel]);

    // Effect to play channel when it changes
    useEffect(() => {
        if (!channel) {
            destroyPlayers();
            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.removeAttribute('src');
                videoRef.current.load();
            }
            setError(null);
            setIsLoading(false);
            return;
        }

        // Skip playlist URLs
        if (channel.url.includes('get.php') || channel.url.includes('type=m3u')) {
            return;
        }

        playChannel(channel.url, false);
        return () => destroyPlayers();
    }, [channel]);

    // Volume control
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = isMuted ? 0 : volume;
        }
    }, [volume, isMuted]);

    const handleVolumeChange = (e) => {
        const newVolume = parseFloat(e.target.value);
        setVolume(newVolume);
        setIsMuted(newVolume === 0);
        localStorage.setItem('player-volume', newVolume.toString());
    };

    const toggleMute = () => setIsMuted(!isMuted);

    const copyUrl = () => {
        if (channel?.url) navigator.clipboard.writeText(channel.url);
    };

    const openInVLC = async () => {
        if (channel?.url) {
            try {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('open-external-player', channel.url, 'vlc');
            } catch (err) {
                console.error('VLC error:', err);
            }
        }
    };


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
            {/* Video Player */}
            <div className="flex-1 relative bg-black flex items-center justify-center">
                <video
                    ref={videoRef}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain"
                    style={{ backgroundColor: '#000' }}
                />

                {/* Loading Overlay */}
                {isLoading && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                        <div className="text-center">
                            <Loader className="animate-spin text-orange-500 mx-auto mb-3" size={48} />
                            <p className="text-white text-lg">Yükleniyor...</p>
                            <p className="text-gray-400 text-sm mt-1 mb-4">{channel.name}</p>
                            <div className="flex gap-2 justify-center">
                                <button
                                    onClick={retryWithProxy}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                                >
                                    <RotateCcw size={16} />
                                    Proxy ile Dene
                                </button>
                                <button
                                    onClick={openInVLC}
                                    className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                                >
                                    <ExternalLink size={16} />
                                    VLC
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Error Overlay */}
                {error && !isLoading && (
                    <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                        <div className="text-center max-w-md p-6">
                            <AlertCircle className="text-red-500 mx-auto mb-3" size={48} />
                            <p className="text-white text-lg mb-2">{error}</p>
                            <p className="text-gray-400 text-sm mb-4">Stream türü: {streamType || 'bilinmiyor'}</p>
                            <div className="flex flex-col gap-2">
                                <div className="flex gap-2 justify-center">
                                    <button
                                        onClick={retryWithProxy}
                                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-colors"
                                    >
                                        <RotateCcw size={18} />
                                        Proxy ile Dene
                                    </button>
                                    <button
                                        onClick={retryDirect}
                                        className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium transition-colors"
                                    >
                                        <RotateCcw size={18} />
                                        Tekrar Dene
                                    </button>
                                </div>
                                <button
                                    onClick={openInVLC}
                                    className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 mx-auto font-medium transition-colors"
                                >
                                    <ExternalLink size={20} />
                                    VLC'de Aç
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Info Bar */}
            <div className="p-3 bg-gray-800 border-t border-gray-700">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-sm font-semibold text-white truncate">{channel.name}</h2>
                        <p className="text-xs text-gray-400 truncate">{channel.group}</p>
                    </div>

                    <div className="flex items-center gap-2">
                        <button onClick={toggleMute} className="text-gray-400 hover:text-white transition-colors">
                            {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={isMuted ? 0 : volume}
                            onChange={handleVolumeChange}
                            className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-orange-500"
                        />
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowUrl(!showUrl)}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1 transition-colors"
                            title="URL Göster"
                        >
                            <Info size={14} />
                        </button>
                        <button
                            onClick={copyUrl}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1 transition-colors"
                            title="URL Kopyala"
                        >
                            <Copy size={14} />
                        </button>
                        <button
                            onClick={openInVLC}
                            className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1 font-medium transition-colors"
                            title="VLC'de Aç"
                        >
                            <ExternalLink size={14} />
                            VLC
                        </button>
                    </div>
                </div>
                
                {showUrl && (
                    <div className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-400 break-all font-mono">
                        {channel.url}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Player;
