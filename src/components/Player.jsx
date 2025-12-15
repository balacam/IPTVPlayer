import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { ExternalLink, Copy, Info, Loader, AlertCircle, Volume2, VolumeX, RotateCcw, Monitor, Download, Zap } from 'lucide-react';

const isElectron = () => {
    try { return !!window.require; } catch { return false; }
};

// Formats that need FFmpeg transcoding or VLC
const TRANSCODE_EXTENSIONS = ['.mkv', '.avi', '.wmv', '.flv', '.mov', '.divx', '.rmvb', '.asf'];

const needsTranscoding = (url) => {
    if (!url) return false;
    const lowerUrl = url.toLowerCase().split('?')[0];
    return TRANSCODE_EXTENSIONS.some(ext => lowerUrl.endsWith(ext));
};

// Player modes
const PLAYER_MODES = {
    AUTO: 'auto',           // Try built-in, fallback to FFmpeg, then VLC
    FFMPEG: 'ffmpeg',       // Always use FFmpeg transcoding
    VLC_EXTERNAL: 'vlc',    // Always use external VLC
};

const Player = ({ channel }) => {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const mpegtsRef = useRef(null);
    const retryTimeoutRef = useRef(null);
    const vlcFallbackTimeoutRef = useRef(null);
    const [showUrl, setShowUrl] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showVlcPrompt, setShowVlcPrompt] = useState(false);
    const [playerMode, setPlayerMode] = useState(() => {
        return localStorage.getItem('player-mode') || PLAYER_MODES.AUTO;
    });
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('player-volume');
        return saved ? parseFloat(saved) : 1;
    });
    const [isMuted, setIsMuted] = useState(false);
    const [bufferInfo, setBufferInfo] = useState('');
    const [ffmpegStatus, setFfmpegStatus] = useState({ available: false, downloading: false, progress: 0 });
    const [isTranscoding, setIsTranscoding] = useState(false);

    // Check FFmpeg status on mount
    useEffect(() => {
        if (isElectron()) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('get-ffmpeg-status').then(setFfmpegStatus);
            
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
        if (vlcFallbackTimeoutRef.current) {
            clearTimeout(vlcFallbackTimeoutRef.current);
            vlcFallbackTimeoutRef.current = null;
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (mpegtsRef.current) {
            mpegtsRef.current.destroy();
            mpegtsRef.current = null;
        }
        // Stop FFmpeg transcoding
        if (isElectron() && isTranscoding) {
            try {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('stop-ffmpeg-transcode');
            } catch {}
        }
        setIsTranscoding(false);
        setShowVlcPrompt(false);
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

    const cyclePlayerMode = useCallback(() => {
        const modes = [PLAYER_MODES.AUTO, PLAYER_MODES.FFMPEG, PLAYER_MODES.VLC_EXTERNAL];
        const currentIndex = modes.indexOf(playerMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        const newMode = modes[nextIndex];
        setPlayerMode(newMode);
        localStorage.setItem('player-mode', newMode);
    }, [playerMode]);

    const getModeLabel = () => {
        switch (playerMode) {
            case PLAYER_MODES.FFMPEG: return 'FFmpeg';
            case PLAYER_MODES.VLC_EXTERNAL: return 'VLC';
            default: return 'Auto';
        }
    };

    const downloadFFmpeg = useCallback(async () => {
        if (!isElectron()) return;
        setFfmpegStatus(prev => ({ ...prev, downloading: true, progress: 0 }));
        try {
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('download-ffmpeg');
            if (result.success) {
                setFfmpegStatus({ available: true, downloading: false });
            } else {
                setFfmpegStatus(prev => ({ ...prev, downloading: false, error: result.error }));
            }
        } catch (err) {
            setFfmpegStatus(prev => ({ ...prev, downloading: false, error: err.message }));
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
            // Auto retry on error - quick reconnect
            if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = setTimeout(() => {
                console.log('Auto-reconnecting after error...');
                try {
                    player.unload();
                    player.load();
                    video.play().catch(() => {});
                } catch (e) {
                    console.error('Reconnect failed:', e);
                }
            }, 1000);
        });

        // Handle network disconnection
        player.on(mpegts.Events.LOADING_COMPLETE, () => {
            console.log('Stream loading complete, checking if ended...');
            // Stream might have ended, try to reconnect
            retryTimeoutRef.current = setTimeout(() => {
                console.log('Reconnecting after stream end...');
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

    const playChannel = useCallback(async (url, retryCount = 0) => {
        const video = videoRef.current;
        if (!video || !url) return;

        // VLC mode - always open in VLC
        if (playerMode === PLAYER_MODES.VLC_EXTERNAL) {
            console.log('VLC mode enabled, opening in VLC');
            setIsLoading(false);
            openInVLC(url);
            return;
        }

        // FFmpeg mode - always use FFmpeg transcoding
        if (playerMode === PLAYER_MODES.FFMPEG) {
            if (!ffmpegStatus.available) {
                setError('FFmpeg not installed. Click to download.');
                return;
            }
            await destroyPlayers();
            video.pause();
            video.removeAttribute('src');
            video.load();
            setError(null);
            setIsLoading(true);
            
            const success = await playWithFFmpeg(url, video);
            if (!success) {
                setError('FFmpeg transcoding failed. Try VLC.');
                setIsLoading(false);
            }
            return;
        }

        // AUTO mode - smart detection
        const requiresTranscode = needsTranscoding(url);
        
        if (requiresTranscode && ffmpegStatus.available) {
            // Use FFmpeg for formats that need transcoding
            await destroyPlayers();
            video.pause();
            video.removeAttribute('src');
            video.load();
            setError(null);
            setIsLoading(true);
            
            const success = await playWithFFmpeg(url, video);
            if (success) return;
            
            // FFmpeg failed, try VLC
            console.log('FFmpeg failed, falling back to VLC');
            openInVLC(url);
            setIsLoading(false);
            return;
        }
        
        if (requiresTranscode && !ffmpegStatus.available) {
            // No FFmpeg, use VLC for unsupported formats
            console.log('Unsupported format, no FFmpeg, using VLC');
            openInVLC(url);
            return;
        }

        // Standard playback with built-in players
        await destroyPlayers();
        video.pause();
        video.removeAttribute('src');
        video.load();
        setError(null);
        setIsLoading(true);
        setShowVlcPrompt(false);

        console.log('Playing:', url, 'Retry:', retryCount);

        // Try HLS first, fallback to MPEG-TS
        if (!playWithHls(url, video)) {
            playWithMpegts(url, video);
        }

        // Show VLC/FFmpeg prompt after 5 seconds if not playing
        vlcFallbackTimeoutRef.current = setTimeout(() => {
            if (video.readyState < 2) {
                console.log('Stream slow to load, showing fallback options');
                setShowVlcPrompt(true);
            }
        }, 5000);

        // Auto-retry if not playing after 30 seconds
        retryTimeoutRef.current = setTimeout(() => {
            if (video.readyState < 2 && retryCount < 3) {
                console.log('Auto-retrying... attempt', retryCount + 1);
                playChannel(url, retryCount + 1);
            } else if (video.readyState < 2) {
                setIsLoading(false);
                setError('Connection failed - Try FFmpeg or VLC');
            }
        }, 30000);
    }, [destroyPlayers, playWithHls, playWithMpegts, playWithFFmpeg, playerMode, ffmpegStatus.available, openInVLC]);

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
            setShowVlcPrompt(false); // Hide VLC prompt when playing starts
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

    const retryPlay = () => channel?.url && playChannel(channel.url);


    if (!channel) {
        return (
            <div className="flex-1 bg-gray-900 flex flex-col items-center justify-center text-gray-500">
                <span className="text-6xl mb-4">▶</span>
                <p className="text-lg mb-2">Select a channel to play</p>
                <p className="text-sm text-gray-600 mb-4">Double-click to open in VLC</p>
                
                {/* Player Mode Toggle */}
                <button 
                    onClick={cyclePlayerMode}
                    className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                        playerMode === PLAYER_MODES.FFMPEG ? 'bg-purple-600 hover:bg-purple-700 text-white' :
                        playerMode === PLAYER_MODES.VLC_EXTERNAL ? 'bg-orange-600 hover:bg-orange-700 text-white' : 
                        'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                >
                    <Monitor size={16} />
                    Player: {getModeLabel()}
                </button>
                <p className="text-xs text-gray-600 mt-2">
                    {playerMode === PLAYER_MODES.FFMPEG ? 'FFmpeg transcoding (best compatibility)' :
                     playerMode === PLAYER_MODES.VLC_EXTERNAL ? 'External VLC player' : 
                     'Auto: Built-in → FFmpeg → VLC'}
                </p>
                
                {/* FFmpeg Status */}
                <div className="mt-6 text-center">
                    {ffmpegStatus.downloading ? (
                        <div className="bg-gray-800 rounded-lg p-4">
                            <Loader className="animate-spin text-purple-500 mx-auto mb-2" size={24} />
                            <p className="text-sm text-gray-300">
                                {ffmpegStatus.status === 'extracting' ? 'Extracting FFmpeg...' : `Downloading FFmpeg... ${ffmpegStatus.progress}%`}
                            </p>
                        </div>
                    ) : ffmpegStatus.available ? (
                        <div className="flex items-center gap-2 text-green-500 text-sm">
                            <Zap size={16} />
                            FFmpeg ready
                        </div>
                    ) : (
                        <button
                            onClick={downloadFFmpeg}
                            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2"
                        >
                            <Download size={16} />
                            Install FFmpeg (~100MB)
                        </button>
                    )}
                    <p className="text-xs text-gray-600 mt-2">
                        FFmpeg enables playback of all video formats
                    </p>
                </div>
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
                            
                            {showVlcPrompt && (
                                <div className="bg-yellow-900/50 border border-yellow-600 rounded-lg p-3 mb-4 max-w-xs mx-auto">
                                    <p className="text-yellow-200 text-sm mb-2">Stream is slow. Try FFmpeg or VLC.</p>
                                </div>
                            )}
                            
                            <div className="flex gap-2 justify-center">
                                {ffmpegStatus.available && !isTranscoding && (
                                    <button 
                                        onClick={() => playWithFFmpeg(channel?.url, videoRef.current)} 
                                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm"
                                    >
                                        <Zap size={16} /> FFmpeg
                                    </button>
                                )}
                                <button onClick={() => openInVLC(channel?.url)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm">
                                    <ExternalLink size={16} /> VLC
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {error && !isLoading && (
                    <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                        <div className="text-center p-6">
                            <AlertCircle className="text-red-500 mx-auto mb-3" size={48} />
                            <p className="text-white text-lg mb-4">{error}</p>
                            <div className="flex gap-2 justify-center flex-wrap">
                                <button onClick={retryPlay} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2">
                                    <RotateCcw size={18} /> Retry
                                </button>
                                {ffmpegStatus.available && (
                                    <button 
                                        onClick={() => playWithFFmpeg(channel?.url, videoRef.current)} 
                                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                                    >
                                        <Zap size={18} /> FFmpeg
                                    </button>
                                )}
                                {!ffmpegStatus.available && !ffmpegStatus.downloading && (
                                    <button 
                                        onClick={downloadFFmpeg} 
                                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                                    >
                                        <Download size={18} /> Install FFmpeg
                                    </button>
                                )}
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
                    <div className="flex items-center gap-2">
                        {/* Player Mode Toggle */}
                        <button 
                            onClick={cyclePlayerMode} 
                            className={`px-2 py-1.5 rounded text-xs flex items-center gap-1 transition-colors ${
                                playerMode === PLAYER_MODES.FFMPEG ? 'bg-purple-600 hover:bg-purple-700 text-white' :
                                playerMode === PLAYER_MODES.VLC_EXTERNAL ? 'bg-orange-600 hover:bg-orange-700 text-white' : 
                                'bg-gray-700 hover:bg-gray-600 text-gray-300'
                            }`}
                            title={`Current: ${getModeLabel()} - Click to change`}
                        >
                            <Monitor size={14} />
                            {getModeLabel()}
                        </button>
                        {/* FFmpeg button */}
                        {ffmpegStatus.available && (
                            <button 
                                onClick={() => playWithFFmpeg(channel?.url, videoRef.current)} 
                                className="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1.5 rounded text-xs flex items-center gap-1"
                                title="Play with FFmpeg transcoding"
                            >
                                <Zap size={14} />
                            </button>
                        )}
                        <button onClick={() => setShowUrl(!showUrl)} className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-xs" title="Show URL">
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
                {showUrl && <div className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-400 break-all font-mono">{channel.url}</div>}
            </div>
        </div>
    );
};

export default Player;
