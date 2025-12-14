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

        if (!channel) {
            video.src = '';
            setError(null);
            setIsLoading(false);
            return;
        }

        // Skip playlist URLs
        if (channel.url.includes('get.php') || channel.url.includes('type=m3u')) {
            return;
        }

        const loadStream = async () => {
            setIsLoading(true);
            setError(null);

            // Timeout - if video doesn't load in 5 seconds, show error
            const timeout = setTimeout(() => {
                if (isLoading) {
                    setIsLoading(false);
                    setError('Stream yüklenemedi - VLC ile deneyin');
                }
            }, 5000);

            try {
                // Get proxy URL
                const { ipcRenderer } = window.require('electron');
                const proxyUrl = await ipcRenderer.invoke('get-proxy-url', channel.url);
                console.log('Loading stream via proxy:', proxyUrl);

                // Check if it's a video file
                const isVideoFile = channel.url.includes('.mp4') || 
                                   channel.url.includes('.mkv') || 
                                   channel.url.includes('.avi') ||
                                   channel.url.includes('/movie/') ||
                                   channel.url.includes('/series/');

                if (isVideoFile) {
                    // Regular video file (MP4, MKV, etc.)
                    console.log('Using native video for:', channel.url);
                    video.src = proxyUrl;
                    
                    video.onloadeddata = () => {
                        clearTimeout(timeout);
                        setIsLoading(false);
                        video.play().catch(e => console.error('Autoplay error:', e));
                    };

                    video.onerror = () => {
                        clearTimeout(timeout);
                        setIsLoading(false);
                        setError('Video formatı desteklenmiyor - VLC ile deneyin');
                    };

                    video.load();
                } else {
                    // Live TV - MPEG-TS format, browser doesn't support it
                    // Auto-open in VLC
                    clearTimeout(timeout);
                    setIsLoading(false);
                    
                    // Automatically open in VLC for live streams
                    try {
                        await ipcRenderer.invoke('open-external-player', channel.url, 'vlc');
                        setError('Canlı TV - VLC\'de açıldı');
                    } catch (vlcError) {
                        setError('Canlı TV - VLC ile izleyin');
                    }
                }

            } catch (err) {
                clearTimeout(timeout);
                console.error('Stream load error:', err);
                setIsLoading(false);
                setError('Stream yüklenemedi');
            }
        };

        loadStream();

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
    }, [channel]);

    const copyUrl = () => {
        if (channel?.url) {
            navigator.clipboard.writeText(channel.url).then(() => {
                alert('URL kopyalandı!');
            });
        }
    };

    const openInVLC = async () => {
        if (channel?.url) {
            try {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('open-external-player', channel.url, 'vlc');
            } catch (error) {
                console.error('Failed to open VLC:', error);
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