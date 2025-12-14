import { useState, useRef, useEffect, useCallback } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { ExternalLink, Copy, Info, Loader, AlertCircle, Volume2, VolumeX, RotateCcw } from 'lucide-react';

// Check if running in Electron
const isElectron = () => {
    try {
        return !!window.require;
    } catch {
        return false;
    }
};

const Player = ({ channel }) => {
    const videoRef = useRef(null);
    const playerRef = useRef(null);
    const [showUrl, setShowUrl] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('player-volume');
        return saved ? parseFloat(saved) : 1;
    });
    const [isMuted, setIsMuted] = useState(false);

    // Initialize video.js player
    useEffect(() => {
        if (!videoRef.current) return;

        const player = videojs(videoRef.current, {
            controls: true,
            autoplay: true,
            preload: 'auto',
            fluid: false,
            fill: true,
            liveui: true,
            liveTracker: {
                trackingThreshold: 0,
                liveTolerance: 15,
            },
            html5: {
                vhs: {
                    overrideNative: true,
                    enableLowInitialPlaylist: true,
                    smoothQualityChange: true,
                    fastQualityChange: true,
                },
                nativeAudioTracks: false,
                nativeVideoTracks: false,
            },
            sources: [],
        });

        playerRef.current = player;

        player.on('error', () => {
            const error = player.error();
            console.error('Video.js error:', error);
            setIsLoading(false);
            setError('Stream oynatılamadı - VLC ile deneyin');
        });

        player.on('waiting', () => {
            console.log('Video.js: Buffering...');
        });

        player.on('playing', () => {
            console.log('Video.js: Playing');
            setIsLoading(false);
            setError(null);
        });

        player.on('ended', () => {
            console.log('Video.js: Stream ended, reloading...');
            // Auto-reload for live streams
            setTimeout(() => {
                if (channel?.url) {
                    player.src({ src: channel.url, type: 'application/x-mpegURL' });
                    player.play();
                }
            }, 1000);
        });

        // Set initial volume
        player.volume(volume);

        return () => {
            if (playerRef.current) {
                playerRef.current.dispose();
                playerRef.current = null;
            }
        };
    }, []);


    // Play channel when it changes
    useEffect(() => {
        const player = playerRef.current;
        if (!player || !channel) {
            if (player) {
                player.pause();
                player.src([]);
            }
            setError(null);
            setIsLoading(false);
            return;
        }

        // Skip playlist URLs
        if (channel.url.includes('get.php') || channel.url.includes('type=m3u')) {
            return;
        }

        setError(null);
        setIsLoading(true);

        console.log('Playing:', channel.url);

        // Determine source type
        const url = channel.url.toLowerCase();
        let type = 'application/x-mpegURL'; // Default to HLS
        
        if (url.includes('.mp4')) {
            type = 'video/mp4';
        } else if (url.includes('.webm')) {
            type = 'video/webm';
        } else if (url.includes('.m3u8')) {
            type = 'application/x-mpegURL';
        }

        // Set source and play
        player.src({
            src: channel.url,
            type: type,
        });

        player.play().catch(e => {
            console.warn('Autoplay blocked:', e);
        });

        // Timeout for loading
        const timeout = setTimeout(() => {
            if (isLoading && !player.paused()) {
                setIsLoading(false);
            }
        }, 10000);

        return () => clearTimeout(timeout);
    }, [channel]);

    // Volume sync
    useEffect(() => {
        if (playerRef.current) {
            playerRef.current.volume(isMuted ? 0 : volume);
            playerRef.current.muted(isMuted);
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

    const retryPlay = () => {
        if (channel?.url && playerRef.current) {
            setError(null);
            setIsLoading(true);
            playerRef.current.src({ src: channel.url, type: 'application/x-mpegURL' });
            playerRef.current.play();
        }
    };
