import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { ExternalLink, Copy, Info, Loader, AlertCircle, Volume2, VolumeX, RotateCcw } from 'lucide-react';

// Get file extension from URL
const getExtensionFromUrl = (url) => {
    try {
        const pathname = new URL(url).pathname;
        const ext = pathname.split('.').pop()?.toLowerCase();
        return ext || '';
    } catch {
        return '';
    }
};

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

const Player = ({ channel }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const [showUrl, setShowUrl] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('player-volume');
        return saved ? parseFloat(saved) : 1;
    });
    const [isMuted, setIsMuted] = useState(false);

    // Cleanup HLS instance
    const destroyHls = useCallback(() => {
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
    }, []);

    // Play channel
    const playChannel = useCallback(async (originalUrl, useProxy = true) => {
        const video = videoRef.current;
        if (!video || !originalUrl) return;

        destroyHls();
        video.pause();
        
        // Clear existing sources
        while (video.firstChild) {
            video.removeChild(video.firstChild);
        }
        video.removeAttribute('src');
        video.load();

        setError(null);
        setIsLoading(true);

        // Get proxy URL if in Electron and proxy is enabled
        let url = originalUrl;
        if (useProxy && isElectron()) {
            try {
                url = await getProxyUrl(originalUrl);
                console.log('Using proxy URL:', url);
            } catch (e) {
                console.warn('Failed to get proxy URL, using original:', e);
            }
        }

        const extension = getExtensionFromUrl(originalUrl);
        console.log('Playing URL:', url, 'Extension:', extension);

        // For MP4/direct video files, use native player
        if (extension === 'mp4' || extension === 'mpv' || extension === 'mkv' || extension === 'avi') {
            console.log('Using native video player for:', extension);
            const source = document.createElement('source');
            source.src = url;
            source.type = 'video/mp4';
            video.appendChild(source);
            
            video.onloadeddata = () => {
                setIsLoading(false);
                video.play().catch(e => console.warn('Autoplay blocked:', e));
            };
            
            video.onerror = () => {
                setIsLoading(false);
                setError('Video oynatılamadı');
            };
            
            video.load();
            return;
        }

        // For HLS/IPTV streams - try direct first, then proxy
        if (Hls.isSupported()) {
            console.log('Using HLS.js for stream');
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 90,
                maxBufferLength: 30,
                maxMaxBufferLength: 600,
                maxBufferSize: 60 * 1000 * 1000,
                maxBufferHole: 0.5,
                fragLoadingTimeOut: 30000,
                manifestLoadingTimeOut: 30000,
                levelLoadingTimeOut: 30000,
                fragLoadingMaxRetry: 6,
                manifestLoadingMaxRetry: 6,
                levelLoadingMaxRetry: 6,
                startFragPrefetch: true,
                xhrSetup: (xhr) => {
                    xhr.withCredentials = false;
                }
            });
            
            hlsRef.current = hls;
            hls.attachMedia(video);
            hls.loadSource(url);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                console.log('HLS: Manifest parsed, starting playback');
                setIsLoading(false);
                video.play().catch(e => console.warn('Autoplay blocked:', e));
            });

            hls.on(Hls.Events.FRAG_LOADED, () => {
                if (isLoading) setIsLoading(false);
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
                console.error('HLS Error:', data.type, data.details, data.fatal);
                
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log('HLS: Network error, trying to recover...');
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log('HLS: Media error, trying to recover...');
                            hls.recoverMediaError();
                            break;
                        default:
                            console.log('HLS: Fatal error, cannot recover');
                            setIsLoading(false);
                            setError('Stream oynatılamadı - VLC ile deneyin');
                            destroyHls();
                            break;
                    }
                }
            });

        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS
            console.log('Using native HLS (Safari)');
            video.src = url;
            
            video.onloadedmetadata = () => {
                setIsLoading(false);
                video.play().catch(e => console.warn('Autoplay blocked:', e));
            };
            
            video.onerror = () => {
                setIsLoading(false);
                setError('Stream oynatılamadı');
            };
        } else {
            // Fallback - try direct playback
            console.log('Using direct playback fallback');
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

        // Timeout for loading (10 seconds)
        const loadTimeout = setTimeout(() => {
            if (isLoading) {
                setIsLoading(false);
                if (!video.readyState) {
                    setError('Yükleme zaman aşımı - Proxy veya VLC ile deneyin');
                }
            }
        }, 10000);

        return () => clearTimeout(loadTimeout);
    }, [destroyHls, isLoading]);

    // Retry with proxy
    const retryWithProxy = useCallback(() => {
        if (channel?.url) {
            console.log('Retrying with proxy...');
            playChannel(channel.url, true);
        }
    }, [channel, playChannel]);

    // Retry without proxy (direct)
    const retryDirect = useCallback(() => {
        if (channel?.url) {
            console.log('Retrying direct...');
            playChannel(channel.url, false);
        }
    }, [channel, playChannel]);

    // Effect to play channel when it changes
    useEffect(() => {
        if (!channel) {
            destroyHls();
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

        // Try direct first (faster if it works)
        playChannel(channel.url, false);

        return () => destroyHls();
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

    const toggleMute = () => {
        setIsMuted(!isMuted);
    };

    const copyUrl = () => {
        if (channel?.url) {
            navigator.clipboard.writeText(channel.url);
        }
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
                            <p className="text-gray-400 text-sm mb-4">Bu stream tarayıcıda desteklenmiyor olabilir</p>
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
                    {/* Channel Info */}
                    <div className="flex-1 min-w-0">
                        <h2 className="text-sm font-semibold text-white truncate">{channel.name}</h2>
                        <p className="text-xs text-gray-400 truncate">{channel.group}</p>
                    </div>

                    {/* Volume Control */}
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

                    {/* Action Buttons */}
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
