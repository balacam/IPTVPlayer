import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { isElectron } from '../utils/platform';
import { openExternalPlayer } from '../services/api';

const PLAYER_MODES = {
    FFMPEG: 'ffmpeg',
    VLC_EXTERNAL: 'vlc',
};

export const usePlayer = ({ channel, videoRef, backupVideoRef, autoSkipEnabled, onPlaybackError }) => {
    const hlsRef = useRef(null);
    const backupHlsRef = useRef(null);
    const retryTimeoutRef = useRef(null);
    const errorTimeoutRef = useRef(null);
    const currentUrlRef = useRef(null);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [playerMode, setPlayerMode] = useState(() => {
        return localStorage.getItem('player-mode') || PLAYER_MODES.FFMPEG;
    });
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('player-volume');
        return saved ? parseFloat(saved) : 1;
    });
    const [isMuted, setIsMuted] = useState(false);
    const [bufferInfo, setBufferInfo] = useState('');
    const [ffmpegStatus, setFfmpegStatus] = useState({ available: false, downloading: false, progress: 0 });
    const [isTranscoding, setIsTranscoding] = useState(false);
    const [currentSourceIndex, setCurrentSourceIndex] = useState(0);
    const [activePlayer, setActivePlayer] = useState('primary'); // 'primary' or 'backup'

    // Check FFmpeg status on mount
    useEffect(() => {
        if (isElectron()) {
            window.electronAPI.invoke('get-ffmpeg-status').then(status => {
                setFfmpegStatus(status);
                if (!status.available) {
                    console.log('FFmpeg not found, starting auto-download...');
                    window.electronAPI.invoke('download-ffmpeg');
                }
            });
            
            const cleanup = window.electronAPI.on('ffmpeg-download-progress', (_, progress) => {
                setFfmpegStatus(prev => ({ ...prev, downloading: true, ...progress }));
                if (progress.status === 'complete') {
                    setFfmpegStatus({ available: true, downloading: false });
                }
            });

            return () => {
                if (cleanup) cleanup();
            };
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
        if (backupHlsRef.current) {
            backupHlsRef.current.destroy();
            backupHlsRef.current = null;
        }
        if (isElectron() && isTranscoding) {
            try {
                await window.electronAPI.invoke('stop-ffmpeg-transcode');
            } catch {}
        }
        setIsTranscoding(false);
        setActivePlayer('primary');
    }, [isTranscoding]);

    const openInVLC = useCallback(async (url) => {
        if (!url) return;
        try {
            await openExternalPlayer(url);
        } catch (err) {
            console.error('External player error:', err);
        }
    }, []);

    const toggleVlcMode = useCallback(() => {
        const newMode = playerMode === PLAYER_MODES.VLC_EXTERNAL 
            ? PLAYER_MODES.FFMPEG 
            : PLAYER_MODES.VLC_EXTERNAL;
        setPlayerMode(newMode);
        localStorage.setItem('player-mode', newMode);
    }, [playerMode]);

    const isDirectVideoFile = useCallback((url) => {
        return /\.(mkv|mp4|avi|mov|wmv|flv|webm)(\?|$)/i.test(url);
    }, []);

    const playWithFFmpeg = useCallback(async (url, video, isBackup = false) => {
        if (!isElectron() || !ffmpegStatus.available) return false;
        
        const streamId = isBackup ? 'backup' : 'primary';
        console.log(`Starting FFmpeg (${streamId}) for:`, url);
        
        if (!isBackup) {
            setIsTranscoding(true);
            setBufferInfo('Transcoding...');
        }
        
        try {
            const result = await window.electronAPI.invoke('start-ffmpeg-transcode', url, streamId);
            
            // Check if context changed while starting
            if (!isBackup && url !== currentUrlRef.current) {
                console.log('Aborting FFmpeg playback - URL changed');
                return false;
            }

            if (!result.success) {
                console.error(`FFmpeg failed (${streamId}):`, result.error);
                if (!isBackup) setIsTranscoding(false);
                return false;
            }
            
            console.log(`FFmpeg HLS ready (${streamId}):`, result.hlsUrl);
            if (!isBackup) setBufferInfo('');
            
            if (Hls.isSupported()) {
                const hlsConfig = {
                    enableWorker: true,
                    lowLatencyMode: true,
                    liveSyncDurationCount: isBackup ? 4 : 3,
                    liveMaxLatencyDurationCount: isBackup ? 10 : 6,
                    maxBufferLength: isBackup ? 15 : 60,
                    maxMaxBufferLength: isBackup ? 30 : 120,
                    manifestLoadingTimeOut: 20000,
                    manifestLoadingMaxRetry: 5,
                    levelLoadingTimeOut: 20000,
                    levelLoadingMaxRetry: 5,
                    fragLoadingTimeOut: 30000,
                    fragLoadingMaxRetry: 5,
                    autoStartLoad: true,
                };

                const hls = new Hls(hlsConfig);
                
                if (isBackup) {
                    backupHlsRef.current = hls;
                } else {
                    hlsRef.current = hls;
                }
                
                hls.attachMedia(video);
                hls.loadSource(result.hlsUrl);
                
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    if (!isBackup) setIsLoading(false);
                    video.play().catch(() => {});
                    if (isBackup) video.muted = true; // Ensure backup is muted
                });
                
                hls.on(Hls.Events.ERROR, (_, data) => {
                    if (data.fatal) {
                        console.error(`HLS error on transcoded stream (${streamId}):`, data);
                        hls.destroy();
                        if (isBackup) {
                            backupHlsRef.current = null;
                        } else {
                            hlsRef.current = null;
                            setIsTranscoding(false);
                            setError('Stream error. Try VLC.');
                            setIsLoading(false);
                        }
                    }
                });
                
                return true;
            }
        } catch (err) {
            console.error(`FFmpeg error (${streamId}):`, err);
            if (!isBackup) setIsTranscoding(false);
        }
        return false;
    }, [ffmpegStatus.available]);

    const setupHls = useCallback((url, videoElement, isBackup = false) => {
        if (!Hls.isSupported()) return null;

        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true, // Enable low latency for direct playback too
            // Optimization for backup: less buffer to save bandwidth
            maxBufferLength: isBackup ? 15 : 30, 
            maxMaxBufferLength: isBackup ? 30 : 60,
            liveSyncDurationCount: isBackup ? 3 : 2, // Aggressive sync for primary
            liveMaxLatencyDurationCount: isBackup ? 5 : 3,
        });

        hls.loadSource(url);
        hls.attachMedia(videoElement);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!isBackup) {
                setIsLoading(false);
            }
            videoElement.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
                console.error(`HLS Error (${isBackup ? 'Backup' : 'Primary'}):`, data);
                hls.destroy();
                if (isBackup) {
                    backupHlsRef.current = null;
                } else {
                    hlsRef.current = null;
                    handleFailover('Stream error');
                }
            }
        });

        return hls;
    }, []);

    const selectBestSource = useCallback(async (sources) => {
        if (!sources || sources.length <= 1) return sources ? sources[0] : null;

        console.log('Testing sources for best speed:', sources);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout

        try {
            const requests = sources.map(url => 
                fetch(url, { method: 'HEAD', signal: controller.signal })
                    .then(() => url)
                    .catch(() => null)
            );

            // Race the requests to see which responds first
            const winner = await Promise.race(requests);
            clearTimeout(timeoutId);

            if (winner) {
                console.log('Best source selected:', winner);
                return winner;
            }
        } catch (e) {
            console.error('Source selection failed:', e);
        }
        
        return sources[0]; // Fallback to first
    }, []);

    const playChannel = useCallback(async (overrideUrl) => {
        const video = videoRef.current;
        const backupVideo = backupVideoRef.current;
        
        // Smart Selection Logic
        let mainUrl = overrideUrl;
        let backupUrl = null;

        if (!mainUrl && channel?.sources) {
            // If manual selection (clicking #1 or #2), use that. 
            // If auto (initial load), try to find best source.
            if (channel.sources.length > 1 && currentSourceIndex === 0) {
                 // For initial load, check which server is faster
                 setBufferInfo('Finding fastest server...');
                 const bestUrl = await selectBestSource(channel.sources);
                 
                 mainUrl = bestUrl;
                 
                 // Update index so UI shows the correct source number
                 const bestIndex = channel.sources.indexOf(bestUrl);
                 if (bestIndex !== -1 && bestIndex !== currentSourceIndex) {
                     console.log(`Redirecting to faster source: #${bestIndex + 1}`);
                     setCurrentSourceIndex(bestIndex);
                     // Stop here, let the useEffect[currentSourceIndex] trigger the actual play
                     // to avoid setting up players twice
                     return;
                 }
                 
                 // If best is current (0), set backup to the next one
                 backupUrl = channel.sources.find(s => s !== mainUrl);
            } else {
                 mainUrl = channel.sources[currentSourceIndex] || channel.url;
                 backupUrl = channel.sources.find(s => s !== mainUrl);
            }
        } else if (!mainUrl) {
            mainUrl = channel?.url;
        }

        if (!video || !mainUrl) return;

        if (playerMode === PLAYER_MODES.VLC_EXTERNAL) {
            console.log('VLC ON, opening in VLC');
            setIsLoading(false);
            openInVLC(mainUrl);
            return;
        }

        if (isElectron() && isDirectVideoFile(mainUrl)) {
            console.log('VOD file detected, opening in VLC...');
            setIsLoading(false);
            openInVLC(mainUrl);
            return;
        }

        await destroyPlayers();

        if (channel.url !== currentUrlRef.current) {
            console.log('Aborting playChannel - Channel changed');
            return;
        }

        // Reset videos
        video.pause();
        video.removeAttribute('src');
        video.load();
        
        if (backupVideo) {
            backupVideo.pause();
            backupVideo.removeAttribute('src');
            backupVideo.load();
        }

        setError(null);
        setIsLoading(true);
        setActivePlayer('primary');
        setBufferInfo('Connecting...');

        if (isElectron() && !ffmpegStatus.available) {
             setError('FFmpeg downloading... Please wait.');
             setIsLoading(false);
             return;
        }

        if (isElectron() && playerMode === PLAYER_MODES.FFMPEG) {
            // FFmpeg mode
            // We can't easily run two FFmpeg instances for background buffering without high CPU usage.
            // But we MUST support failover.
            const success = await playWithFFmpeg(mainUrl, video);
            if (!success) {
                console.log('FFmpeg initial playback failed');
                handleFailover('FFmpeg playback failed');
            }
        } else {
            // Direct / HLS Mode
            console.log('Direct playback attempt:', mainUrl);
            
            if (Hls.isSupported()) {
                // Setup Primary
                hlsRef.current = setupHls(mainUrl, video, false);

                // Setup Backup (if exists)
                if (backupUrl && backupVideo) {
                    console.log('Setting up backup stream:', backupUrl);
                    backupHlsRef.current = setupHls(backupUrl, backupVideo, true);
                    // Ensure backup is muted
                    backupVideo.muted = true;
                }
            } else {
                // Native fallback (Safari etc) - No backup support implemented for native yet
                video.src = mainUrl;
                video.play().catch(e => {
                    console.error('Native play error:', e);
                    handleFailover('Native playback failed');
                });
            }
        }
    }, [destroyPlayers, playWithFFmpeg, isDirectVideoFile, playerMode, ffmpegStatus.available, openInVLC, autoSkipEnabled, onPlaybackError, channel, setupHls]);

    const handleFailover = useCallback((reason) => {
        console.log(`Failover triggered: ${reason}`);
        
        // Scenario 1: We have a backup ready in background (Direct Mode)
        // Note: We disabled Active Dual Buffering for FFmpeg, but Direct Mode might still have it.
        // If we want to disable it completely, we should rely on Scenario 2.
        // But let's keep Scenario 1 for Direct Mode if it happens to be active.
        if (activePlayer === 'primary' && backupHlsRef.current && backupVideoRef.current) {
            console.log('Switching to Backup Player (Background Buffer)');
            setBufferInfo('Switched to Backup Stream');
            setActivePlayer('backup');
            setIsLoading(false);
            
            if (backupVideoRef.current) {
                backupVideoRef.current.muted = isMuted;
                backupVideoRef.current.volume = volume;
            }
            return;
        } 
        
        // Scenario 2: FFmpeg Mode or No Background Buffer (Standard Failover)
        if (channel?.sources && channel.sources.length > 1) {
             const nextIndex = (currentSourceIndex + 1) % channel.sources.length;
             
             // Avoid infinite loops if all fail
             if (nextIndex === 0 && reason.includes('FFmpeg')) {
                 console.log('All sources failed in FFmpeg mode.');
                 setError('All sources failed. Try VLC.');
                 setIsLoading(false);
                 return;
             }

             console.log(`Switching to source index ${nextIndex} (FFmpeg/Manual Switch)`);
             setBufferInfo(`Switching to Source ${nextIndex + 1}...`);
             setCurrentSourceIndex(nextIndex);
             
             // Force playChannel with new source
             setTimeout(() => {
                 playChannel(channel.sources[nextIndex]);
             }, 500);
             return;
        }

        // Scenario 3: No backup available
        console.log('No backup available or already failed over.');
        setError(`${reason}. Try External Player.`);
        setIsLoading(false);
        
        if (autoSkipEnabled && onPlaybackError) {
            errorTimeoutRef.current = setTimeout(() => {
                onPlaybackError();
            }, 3000);
        }
    }, [channel, activePlayer, isMuted, volume, autoSkipEnabled, onPlaybackError, currentSourceIndex, playChannel]);

    // Effect to handle source index change
    useEffect(() => {
        if (channel && currentSourceIndex > 0) {
             // If index changed and it's not 0 (which is handled by main channel effect), play the new source
             playChannel();
        }
    }, [currentSourceIndex]);

    // Buffer monitoring and Auto-reload
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !channel) return;

        const handleStalled = () => {
            console.log('Video stalled, attempting failover/retry...');
            setBufferInfo('Buffering/Stalled...');
            retryTimeoutRef.current = setTimeout(() => {
                if (channel?.url) {
                    handleFailover('Stalled (7s Timeout)');
                }
            }, 7000); // 7s Timeout as requested
        };

        const handleEnded = () => {
            console.log('Stream ended, reloading...');
            if (channel?.url) {
                setTimeout(() => playChannel(), 1000);
            }
        };

        const handleWaiting = () => {
            setBufferInfo('Buffering...');
        };

        const handlePlaying = () => {
            setBufferInfo(activePlayer === 'backup' ? 'Playing Backup Source' : '');
            setIsLoading(false);
            if (errorTimeoutRef.current) {
                clearTimeout(errorTimeoutRef.current);
                errorTimeoutRef.current = null;
            }
            if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current);
                retryTimeoutRef.current = null;
            }
        };

        const handleError = () => {
            console.log('Video error occurred');
            handleFailover('Video Error');
        };

        const bufferInterval = setInterval(() => {
            if (video.buffered.length > 0) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                const bufferAhead = bufferedEnd - video.currentTime;
                if (bufferAhead > 0) {
                    setBufferInfo(`Buffer: ${bufferAhead.toFixed(1)}s`);
                }
            }
        }, 1000);

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
    }, [channel, playChannel, autoSkipEnabled, onPlaybackError, handleFailover, activePlayer]);

    // Main playback effect
    useEffect(() => {
        if (!channel) {
            currentUrlRef.current = null;
            destroyPlayers();
            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.removeAttribute('src');
            }
            if (backupVideoRef.current) {
                backupVideoRef.current.pause();
                backupVideoRef.current.removeAttribute('src');
            }
            setError(null);
            setIsLoading(false);
            return;
        }

        if (channel.url.includes('get.php') || channel.url.includes('type=m3u')) return;

        // New channel selected
        if (channel.url !== currentUrlRef.current) {
            currentUrlRef.current = channel.url;
            setCurrentSourceIndex(0); // Reset to first source
            playChannel();
        }
    }, [channel]);

    // Volume effect
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = isMuted ? 0 : volume;
        }
        if (backupVideoRef.current) {
             // Backup video should be muted unless it is the active player
             if (activePlayer === 'backup') {
                 backupVideoRef.current.volume = isMuted ? 0 : volume;
                 backupVideoRef.current.muted = isMuted;
             } else {
                 backupVideoRef.current.volume = 0;
                 backupVideoRef.current.muted = true;
             }
        }
    }, [volume, isMuted, activePlayer]);

    const handleVolumeChange = (e) => {
        const v = parseFloat(e.target.value);
        setVolume(v);
        setIsMuted(v === 0);
        localStorage.setItem('player-volume', v.toString());
    };

    const retryPlay = () => channel?.url && playChannel(channel.url);

    return {
        isLoading,
        error,
        playerMode,
        PLAYER_MODES,
        ffmpegStatus,
        isTranscoding,
        bufferInfo,
        volume,
        isMuted,
        activePlayer, // 'primary' or 'backup'
        toggleVlcMode,
        openInVLC,
        handleVolumeChange,
        retryPlay,
        setVolume,
        setIsMuted
    };
};
