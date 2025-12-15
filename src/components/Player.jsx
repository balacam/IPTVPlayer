import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { ExternalLink, Copy, Info, Loader, AlertCircle, Volume2, VolumeX, RotateCcw, Monitor, SkipForward } from 'lucide-react';

const isElectron = () => {
    try { return !!window.require; } catch { return false; }
};

// Player modes - FFmpeg is default, VLC is optional
const PLAYER_MODES = {
    FFMPEG: 'ffmpeg',       // Default: FFmpeg transcoding (best compatibility)
    VLC_EXTERNAL: 'vlc',    // External VLC player
};

const Player = ({ channel, onPlaybackError, autoSkipEnabled, onToggleAutoSkip }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const retryTimeoutRef = useRef(null);
    const [showUrl, setShowUrl] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [playerMode, setPlayerMode] = useState(() => {
        return localStorage.getItem('player-mode') || PLAYER_MODES.FFMPEG; // FFmpeg is default
    });
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('player-volume');
        return saved ? parseFloat(saved) : 1;
    });
    const [isMuted, setIsMuted] = useState(false);
    const [bufferInfo, setBufferInfo] = useState('');
    const [ffmpegStatus, setFfmpegStatus] = useState({ available: false, downloading: false, progress: 0 });
    const [isTranscoding, setIsTranscoding] = useState(false);
    const errorTimeoutRef = useRef(null);

    // Check FFmpeg status on mount - auto download if not available
    useEffect(() => {
        if (isElectron()) {
            const { ipcRenderer } = window.require('electron');
            
            // Check status and auto-download if needed
            ipcRenderer.invoke('get-ffmpeg-status').then(status => {
                setFfmpegStatus(status);
                // Auto-download FFmpeg if not available
                if (!status.available) {
                    console.log('FFmpeg not found, starting auto-download...');
                    ipcRenderer.invoke('download-ffmpeg');
                }
            });
            
            // Listen for download progress
            ipcRenderer.on('ffmpeg-download-progress', (_, progress) => {
                setFfmpegStatus(prev => ({ ...prev, downloading: true, ...progress }));
                if (progress.status === 'complete') {
                    setFfmpegStatus({ available: true, downloading: false });
                }
            });
        }
    }, []);

    const destroyPlayers = useCallback(async () => {
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
        if (errorTimeoutRef.current) {
            clearTimeout(errorTimeoutRef.current);
            errorTimeoutRef.current = null;
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        // Stop FFmpeg transcoding
        if (isElectron() && isTranscoding) {
            try {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('stop-ffmpeg-transcode');
            } catch {}
        }
        setIsTranscoding(false);
    }, [isTranscoding]);

    const openInVLC = useCallback(async (url) => {
        if (!url || !isElectron()) return;
        try {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external-player', url, 'vlc');
        } catch (err) {
            console.error('VLC error:', err);
        }
    }, []);

    const toggleVlcMode = useCallback(() => {
        const newMode = playerMode === PLAYER_MODES.VLC_EXTERNAL 
            ? PLAYER_MODES.FFMPEG 
            : PLAYER_MODES.VLC_EXTERNAL;
        setPlayerMode(newMode);
        localStorage.setItem('player-mode', newMode);
    }, [playerMode]);

    const isVlcMode = playerMode === PLAYER_MODES.VLC_EXTERNAL;

    // Check if URL is a direct video file (MKV, MP4, etc.)
    const isDirectVideoFile = useCallback((url) => {
        return /\.(mkv|mp4|avi|mov|wmv|flv|webm)(\?|$)/i.test(url);
    }, []);

    // Play direct video file via proxy (no FFmpeg needed)
    const playDirectVideo = useCallback(async (url, video) => {
        if (!isElectron()) return false;
        
        console.log('Playing direct video file:', url);
        setBufferInfo('Loading video...');
        
        try {
            const { ipcRenderer } = window.require('electron');
            const proxyUrl = await ipcRenderer.invoke('get-proxy-url', url);
            
            console.log('Proxy URL:', proxyUrl);
            
            video.src = proxyUrl;
            video.load();
            
            return new Promise((resolve) => {
                const onCanPlay = () => {
                    video.removeEventListener('canplay', onCanPlay);
                    video.removeEventListener('error', onError);
                    setIsLoading(false);
                    setBufferInfo('');
                    video.play().catch(() => {});
                    resolve(true);
                };
                
                const onError = () => {
                    video.removeEventListener('canplay', onCanPlay);
                    video.removeEventListener('error', onError);
                    console.error('Direct video playback failed');
                    resolve(false);
                };
                
                video.addEventListener('canplay', onCanPlay);
                video.addEventListener('error', onError);
                
                // Timeout after 15 seconds
                setTimeout(() => {
                    video.removeEventListener('canplay', onCanPlay);
                    video.removeEventListener('error', onError);
                    resolve(false);
                }, 15000);
            });
        } catch (err) {
            console.error('Direct video error:', err);
            return false;
        }
    }, []);

    const playWithFFmpeg = useCallback(async (url, video) => {
        if (!isElectron() || !ffmpegStatus.available) return false;
        
        console.log('Using FFmpeg transcoding for:', url);
        setIsTranscoding(true);
        setBufferInfo('Transcoding...');
        
        try {
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('start-ffmpeg-transcode', url);
            
            if (!result.success) {
                console.error('FFmpeg failed:', result.error);
                setIsTranscoding(false);
                return false;
            }
            
            console.log('FFmpeg HLS ready:', result.hlsUrl);
            setBufferInfo('');
            
            // Play the transcoded HLS stream
            if (Hls.isSupported()) {
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    backBufferLength: 90,
                });
                
                hlsRef.current = hls;
                hls.attachMedia(video);
                hls.loadSource(result.hlsUrl);
                
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    setIsLoading(false);
                    video.play().catch(() => {});
                });
                
                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (data.fatal) {
                        console.error('HLS error on transcoded stream:', data);
                        hls.destroy();
                        hlsRef.current = null;
                        setIsTranscoding(false);
                    }
                });
                
                return true;
            }
        } catch (err) {
            console.error('FFmpeg error:', err);
            setIsTranscoding(false);
        }
        return false;
    }, [ffmpegStatus.available]);

    const playChannel = useCallback(async (url) => {
        const video = videoRef.current;
        if (!video || !url) return;

        // VLC ON - always open in VLC
        if (playerMode === PLAYER_MODES.VLC_EXTERNAL) {
            console.log('VLC ON, opening in VLC');
            setIsLoading(false);
            openInVLC(url);
            return;
        }

        // MKV/MP4 video files - open in VLC (FFmpeg can't connect to this IPTV server for VOD)
        if (isDirectVideoFile(url)) {
            console.log('VOD file detected, opening in VLC...');
            setIsLoading(false);
            openInVLC(url);
            return;
        }

        await destroyPlayers();
        video.pause();
        video.removeAttribute('src');
        video.load();
        setError(null);
        setIsLoading(true);

        // For live streams - use FFmpeg transcoding
        if (!ffmpegStatus.available) {
            setError('FFmpeg downloading... Please wait.');
            setIsLoading(false);
            return;
        }
        
        const success = await playWithFFmpeg(url, video);
        if (!success) {
            setError('Playback failed. Try VLC.');
            setIsLoading(false);
            // Auto-skip to next channel if enabled
            if (autoSkipEnabled && onPlaybackError) {
                errorTimeoutRef.current = setTimeout(() => {
                    onPlaybackError();
                }, 3000);
            }
        }
    }, [destroyPlayers, playWithFFmpeg, isDirectVideoFile, playerMode, ffmpegStatus.available, openInVLC, autoSkipEnabled, onPlaybackError]);

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
            // Clear error timeout when playing successfully
            if (errorTimeoutRef.current) {
                clearTimeout(errorTimeoutRef.current);
                errorTimeoutRef.current = null;
            }
        };

        const handleError = () => {
            console.log('Video error occurred');
            if (autoSkipEnabled && onPlaybackError) {
                errorTimeoutRef.current = setTimeout(() => {
                    onPlaybackError();
                }, 3000);
            }
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
        video.addEventListener('error', handleError);

        return () => {
            clearInterval(bufferInterval);
            video.removeEventListener('stalled', handleStalled);
            video.removeEventListener('ended', handleEnded);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('error', handleError);
        };
    }, [channel, playChannel, autoSkipEnabled, onPlaybackError]);

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

    const retryPlay = () => channel?.url && playChannel(channel.url);


    if (!channel) {
        return (
            <div className="flex-1 bg-gray-900 flex flex-col items-center justify-center text-gray-500">
                <span className="text-6xl mb-4">▶</span>
                <p className="text-lg mb-2">Select a channel to play</p>
                <p className="text-sm text-gray-600 mb-4">Double-click to open in VLC</p>
                
                {/* VLC Toggle */}
                <button 
                    onClick={toggleVlcMode}
                    className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                        isVlcMode ? 'bg-orange-600 hover:bg-orange-700 text-white' : 
                        'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                >
                    <Monitor size={16} />
                    VLC: {isVlcMode ? 'ON' : 'OFF'}
                </button>
                <p className="text-xs text-gray-600 mt-2">
                    {isVlcMode ? 'Opens channels in external VLC' : 'FFmpeg transcoding (built-in player)'}
                </p>
                
                {/* FFmpeg Status with Progress Bar */}
                {ffmpegStatus.downloading && (
                    <div className="mt-4 bg-gray-800 rounded-lg px-4 py-3 w-64">
                        <div className="flex items-center gap-2 mb-2">
                            <Loader className="animate-spin text-purple-500" size={16} />
                            <span className="text-sm text-gray-300">
                                {ffmpegStatus.status === 'extracting' ? 'FFmpeg kuruluyor...' : 'FFmpeg indiriliyor...'}
                            </span>
                            <span className="text-sm text-purple-400 ml-auto">{ffmpegStatus.progress || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-2">
                            <div 
                                className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${ffmpegStatus.progress || 0}%` }}
                            />
                        </div>
                    </div>
                )}
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
                            <p className="text-white text-lg">{isTranscoding ? 'Transcoding...' : 'Loading...'}</p>
                            <p className="text-gray-400 text-sm mt-1 mb-4">{channel.name}</p>
                            
                            <button onClick={() => openInVLC(channel?.url)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm mx-auto">
                                <ExternalLink size={16} /> Open in VLC
                            </button>
                        </div>
                    </div>
                )}

                {error && !isLoading && (
                    <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                        <div className="text-center p-6">
                            <AlertCircle className="text-red-500 mx-auto mb-3" size={48} />
                            <p className="text-white text-lg mb-4">{error}</p>
                            
                            {/* FFmpeg Download Progress */}
                            {ffmpegStatus.downloading && (
                                <div className="mb-4 w-64 mx-auto">
                                    <div className="flex justify-between text-sm text-gray-300 mb-1">
                                        <span>{ffmpegStatus.status === 'extracting' ? 'Kuruluyor...' : 'İndiriliyor...'}</span>
                                        <span>{ffmpegStatus.progress || 0}%</span>
                                    </div>
                                    <div className="w-full bg-gray-700 rounded-full h-2.5">
                                        <div 
                                            className="bg-purple-500 h-2.5 rounded-full transition-all duration-300"
                                            style={{ width: `${ffmpegStatus.progress || 0}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-gray-400 mt-2">FFmpeg indiriliyor, lütfen bekleyin...</p>
                                </div>
                            )}
                            
                            {autoSkipEnabled && !ffmpegStatus.downloading && (
                                <p className="text-yellow-400 text-sm mb-4 flex items-center justify-center gap-2">
                                    <SkipForward size={16} /> Skipping to next channel in 3s...
                                </p>
                            )}
                            <div className="flex gap-2 justify-center">
                                <button onClick={retryPlay} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2">
                                    <RotateCcw size={18} /> Retry
                                </button>
                                <button onClick={() => openInVLC(channel?.url)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2">
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
                        <p className="text-xs text-gray-400 truncate">{channel.group}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setIsMuted(!isMuted)} className="text-gray-400 hover:text-white">
                            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>
                        <input type="range" min="0" max="1" step="0.1" value={isMuted ? 0 : volume} onChange={handleVolumeChange}
                            className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-orange-500" />
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Auto-Skip Toggle */}
                        <button 
                            onClick={onToggleAutoSkip} 
                            className={`px-2 py-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
                                autoSkipEnabled ? 'bg-green-600 hover:bg-green-700 text-white' : 
                                'bg-gray-700 hover:bg-gray-600 text-gray-300'
                            }`}
                            title={autoSkipEnabled ? 'Auto-skip ON - Skip to next channel on error' : 'Auto-skip OFF - Stay on failed channel'}
                        >
                            <SkipForward size={14} />
                            Skip: {autoSkipEnabled ? 'ON' : 'OFF'}
                        </button>
                        {/* VLC Toggle */}
                        <button 
                            onClick={toggleVlcMode} 
                            className={`px-2 py-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
                                isVlcMode ? 'bg-orange-600 hover:bg-orange-700 text-white' : 
                                'bg-gray-700 hover:bg-gray-600 text-gray-300'
                            }`}
                            title={isVlcMode ? 'VLC ON - Click to use built-in player' : 'VLC OFF - Click to use VLC'}
                        >
                            <Monitor size={14} />
                            VLC: {isVlcMode ? 'ON' : 'OFF'}
                        </button>
                        <button onClick={() => setShowUrl(!showUrl)} className={`px-3 py-1.5 rounded text-xs ${showUrl ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}`} title="Show stream info">
                            <Info size={14} />
                        </button>
                        <button onClick={() => channel?.url && navigator.clipboard.writeText(channel.url)} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-xs" title="Copy URL">
                            <Copy size={14} />
                        </button>
                        <button onClick={() => openInVLC(channel?.url)} className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded text-xs flex items-center gap-1">
                            <ExternalLink size={14} /> VLC
                        </button>
                    </div>
                </div>
                {showUrl && (
                    <div className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-400">
                        <div className="flex justify-between mb-1">
                            <span>URL:</span>
                            <span className="text-orange-400">{bufferInfo || 'Ready'}</span>
                        </div>
                        <div className="font-mono break-all">{channel.url}</div>
                        {isTranscoding && <div className="mt-1 text-purple-400">FFmpeg transcoding active</div>}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Player;
