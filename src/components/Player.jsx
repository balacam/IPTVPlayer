import { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';
import { ExternalLink, Copy, Info, Loader, AlertCircle } from 'lucide-react';

const Player = ({ channel }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const [showUrl, setShowUrl] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Cleanup previous HLS instance
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        video.pause();
        video.removeAttribute('src');
        video.load();
        setError(null);
        setIsLoading(false);

        if (!channel) {
            return;
        }

        // Skip playlist URLs (nested m3u links)
        if (channel.url.includes('get.php') || channel.url.includes('type=m3u')) {
            return;
        }

        setIsLoading(true);
        const url = channel.url;
        console.log('Playing:', url);

        // Timeout for loading
        const loadTimeout = setTimeout(() => {
            setIsLoading(false);
            if (!video.readyState) {
                setError('Yükleme zaman aşımı - VLC ile deneyin');
            }
        }, 15000);

        // Try HLS.js first (works for most IPTV streams)
        if (Hls.isSupported()) {
            console.log('Using HLS.js');
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                fragLoadingTimeOut: 20000,
                manifestLoadingTimeOut: 20000,
                levelLoadingTimeOut: 20000,
                fragLoadingMaxRetry: 3,
                manifestLoadingMaxRetry: 3,
            });
            hlsRef.current = hls;

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                clearTimeout(loadTimeout);
                console.log('HLS: Manifest parsed, playing...');
                setIsLoading(false);
                video.play().catch(e => console.warn('Autoplay blocked:', e));
            });

            hls.on(Hls.Events.FRAG_LOADED, () => {
                if (isLoading) {
                    clearTimeout(loadTimeout);
                    setIsLoading(false);
                }
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
                console.error('HLS Error:', data.type, data.details);
                
                if (data.fatal) {
                    clearTimeout(loadTimeout);
                    
                    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                        console.log('HLS: Recovering from media error...');
                        hls.recoverMediaError();
                    } else {
                        // Network or other fatal error - try direct playback
                        console.log('HLS failed, trying direct playback...');
                        hls.destroy();
                        hlsRef.current = null;
                        
                        // Try direct video src
                        video.src = url;
                        video.load();
                        
                        video.oncanplay = () => {
                            setIsLoading(false);
                            video.play().catch(e => console.warn('Autoplay blocked:', e));
                        };
                        
                        video.onerror = () => {
                            setIsLoading(false);
                            setError('Stream oynatılamadı - VLC ile deneyin');
                        };
                    }
                }
            });

            hls.loadSource(url);
            hls.attachMedia(video);
            
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS support
            console.log('Using native HLS (Safari)');
            video.src = url;
            
            video.onloadedmetadata = () => {
                clearTimeout(loadTimeout);
                setIsLoading(false);
                video.play().catch(e => console.warn('Autoplay blocked:', e));
            };
            
            video.onerror = () => {
                clearTimeout(loadTimeout);
                setIsLoading(false);
                setError('Stream oynatılamadı - VLC ile deneyin');
            };
        } else {
            // Fallback to direct playback
            console.log('Using direct playback');
            video.src = url;
            
            video.oncanplay = () => {
                clearTimeout(loadTimeout);
                setIsLoading(false);
                video.play().catch(e => console.warn('Autoplay blocked:', e));
            };
            
            video.onerror = () => {
                clearTimeout(loadTimeout);
                setIsLoading(false);
                setError('Stream oynatılamadı - VLC ile deneyin');
            };
            
            video.load();
        }

        return () => {
            clearTimeout(loadTimeout);
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [channel]);

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
                    className="w-full h-full object-contain"
                />

                {/* Loading Overlay */}
                {isLoading && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                        <div className="text-center">
                            <Loader className="animate-spin text-orange-500 mx-auto mb-3" size={40} />
                            <p className="text-white">Yükleniyor...</p>
                        </div>
                    </div>
                )}

                {/* Error Overlay */}
                {error && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                        <div className="text-center max-w-md p-6">
                            <AlertCircle className="text-red-500 mx-auto mb-3" size={40} />
                            <p className="text-white mb-4">{error}</p>
                            <button
                                onClick={openInVLC}
                                className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 mx-auto"
                            >
                                <ExternalLink size={18} />
                                VLC'de Aç
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Info Bar */}
            <div className="p-3 bg-gray-800 border-t border-gray-700">
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0 mr-4">
                        <h2 className="text-sm font-semibold text-white truncate">{channel.name}</h2>
                        <p className="text-xs text-gray-400 truncate">{channel.group}</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowUrl(!showUrl)}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1"
                            title="URL Göster"
                        >
                            <Info size={12} />
                        </button>
                        <button
                            onClick={copyUrl}
                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1"
                            title="URL Kopyala"
                        >
                            <Copy size={12} />
                        </button>
                        <button
                            onClick={openInVLC}
                            className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1"
                            title="VLC'de Aç"
                        >
                            <ExternalLink size={12} />
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
