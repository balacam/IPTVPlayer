import { useRef, useState } from 'react';
import { ExternalLink, Copy, Info, Loader, AlertCircle, Volume2, VolumeX, RotateCcw, Monitor, SkipForward } from 'lucide-react';
import { usePlayer } from '../hooks/usePlayer';

const Player = ({ channel, onPlaybackError, autoSkipEnabled, onToggleAutoSkip }) => {
    const videoRef = useRef(null);
    const backupVideoRef = useRef(null);
    const [showUrl, setShowUrl] = useState(false);

    const {
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
    } = usePlayer({ channel, videoRef, backupVideoRef, autoSkipEnabled, onPlaybackError });

    const isVlcMode = playerMode === PLAYER_MODES.VLC_EXTERNAL;

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
                {/* Primary Video Player */}
                <video
                    ref={videoRef}
                    controls
                    autoPlay
                    playsInline
                    preload="auto"
                    className={`w-full h-full object-contain ${activePlayer === 'backup' ? 'hidden' : 'block'}`}
                    style={{ backgroundColor: '#000' }}
                />

                {/* Backup Video Player (Background Buffer) */}
                <video
                    ref={backupVideoRef}
                    controls
                    autoPlay
                    playsInline
                    preload="auto"
                    className={`w-full h-full object-contain ${activePlayer === 'backup' ? 'block' : 'hidden'}`}
                    style={{ backgroundColor: '#000' }}
                    muted={activePlayer !== 'backup'} // Always mute if not active
                />

                {isLoading && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                        <div className="text-center">
                            <Loader className="animate-spin text-orange-500 mx-auto mb-3" size={48} />
                            <p className="text-white text-lg">
                                {bufferInfo && (bufferInfo.includes('Switching') || bufferInfo.includes('Connecting')) 
                                    ? bufferInfo 
                                    : (isTranscoding ? 'Transcoding...' : 'Loading...')}
                            </p>
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
                        {channel.sources && channel.sources.length > 1 ? (
                            <div className="space-y-1">
                                {channel.sources.map((url, idx) => (
                                    <div key={idx} className={`font-mono break-all p-1 rounded ${url === (channel.url || channel.sources[0]) ? 'bg-gray-800 text-white border-l-2 border-orange-500' : 'text-gray-500'}`}>
                                        <span className="text-xs font-bold mr-2 text-gray-400">#{idx + 1}</span>
                                        {url}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="font-mono break-all">{channel.url}</div>
                        )}
                        {isTranscoding && <div className="mt-1 text-purple-400">FFmpeg transcoding active</div>}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Player;
