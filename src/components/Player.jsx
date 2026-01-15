import { useRef } from 'react';
import { Monitor, SkipForward, Play } from 'lucide-react';
import { openExternalPlayer } from '../services/api';

const Player = ({ channel, onPlaybackError, autoSkipEnabled, onToggleAutoSkip }) => {
    const containerRef = useRef(null);

    const openPlayer = async () => {
        if (!channel?.url) return;
        try {
            await openExternalPlayer(channel.url, { userAgent: channel.userAgent });
        } catch (e) {
            console.error('Player error:', e);
        }
    };

    if (!channel) {
        return (
            <div className="flex-1 bg-gray-900 flex flex-col items-center justify-center text-gray-500">
                <span className="text-6xl mb-4">📺</span>
                <p className="text-lg mb-2">Kanal seçin</p>
                <p className="text-sm text-gray-600">Kumandanın OK tuşuna basarak kanal açın</p>
            </div>
        );
    }

    return (
        <div className="flex-1 bg-gray-900 flex flex-col" ref={containerRef}>
            <div className="flex-1 relative bg-black flex flex-col items-center justify-center">
                <div className="text-center p-8">
                    <Monitor size={64} className="text-orange-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-white mb-2">{channel.name}</h2>
                    <p className="text-gray-400 mb-6">{channel.group}</p>
                    
                    <button 
                        onClick={openPlayer}
                        className="bg-orange-600 hover:bg-orange-700 text-white px-8 py-4 rounded-lg flex items-center gap-3 mx-auto text-lg font-medium"
                    >
                        <Play size={24} /> Oynat
                    </button>
                </div>
            </div>

            {/* Bottom Bar */}
            <div className="p-3 bg-gray-800 border-t border-gray-700">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-sm font-semibold text-white truncate">{channel.name}</h2>
                        <p className="text-xs text-gray-400 truncate">{channel.group}</p>
                    </div>

                    <button
                        onClick={onToggleAutoSkip}
                        className={`px-3 py-1.5 rounded text-xs flex items-center gap-1 ${
                            autoSkipEnabled ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300'
                        }`}
                    >
                        <SkipForward size={14} />
                        Otomatik Geç: {autoSkipEnabled ? 'AÇIK' : 'KAPALI'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Player;
