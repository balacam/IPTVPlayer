import { useState, useEffect } from 'react';
import { Loader, Download } from 'lucide-react';
import ChannelList from './components/ChannelList';
import Player from './components/Player';
import CategorySelection from './components/CategorySelection';
import { parseM3U, processParsedItems } from './utils/m3uParser';
import { fetchAndParsePlaylist } from './services/api';
import { fetchChannelsFromSupabase } from './services/supabase';
import { checkForUpdate, downloadAndInstallUpdate } from './services/autoUpdate';

function App() {
    const [data, setData] = useState({ channels: [], groups: {}, categories: { live: [], movie: [], series: [] } });
    const [selectedChannel, setSelectedChannel] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [isPlaylistView, setIsPlaylistView] = useState(false);
    const [autoSkipEnabled, setAutoSkipEnabled] = useState(() => {
        return localStorage.getItem('auto-skip-enabled') === 'true';
    });

    // Supabase Config from env
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

    // Update State
    const [updateInfo, setUpdateInfo] = useState(null);
    const [showUpdateModal, setShowUpdateModal] = useState(false);
    const [error, setError] = useState(null);

    // Auto-connect on startup
    useEffect(() => {
        const init = async () => {
            try {
                // Check for updates
                try {
                    const update = await checkForUpdate(supabaseUrl, supabaseKey);
                    if (update.hasUpdate) {
                        setUpdateInfo(update);
                        setShowUpdateModal(true);
                    }
                } catch (e) {
                    console.warn('Update check failed:', e);
                }

                // Load channels
                const channels = await fetchChannelsFromSupabase(supabaseUrl, supabaseKey);
                if (channels?.length > 0) {
                    const processedData = processParsedItems(channels);
                    setData(processedData);
                } else {
                    setError('Veritabanında kanal bulunamadı');
                }
            } catch (e) {
                console.error('Init failed:', e);
                setError(e.message || 'Bağlantı hatası');
            } finally {
                setIsLoading(false);
            }
        };
        init();
    }, []);

    const handleUpdateDownload = async () => {
        if (updateInfo?.apkUrl) {
            try {
                await downloadAndInstallUpdate(updateInfo.apkUrl);
            } catch (e) {
                window.open(updateInfo.apkUrl, '_blank');
            }
        }
        setShowUpdateModal(false);
    };

    const isPlaylistUrl = (url) => {
        const lower = url.toLowerCase();
        return lower.includes('type=m3u') || lower.includes('get.php') || 
               lower.includes('playlist.php') || (lower.includes('.m3u') && !lower.includes('.m3u8'));
    };

    const handleChannelSelect = async (channel) => {
        const isPlaylist = isPlaylistUrl(channel.url);

        if (isPlaylist) {
            setIsLoading(true);
            try {
                const result = await fetchAndParsePlaylist(channel.url);
                if (!result.success) throw new Error(result.error);

                const parsedData = result.rawText ? parseM3U(result.rawText) : null;
                if (!parsedData?.channels?.length) throw new Error('Kanal bulunamadı');

                setData(parsedData);
                setSelectedChannel(null);
                setSelectedCategory(null);
                setIsPlaylistView(false);
            } catch (e) {
                console.error('Playlist load error:', e);
                alert('Playlist yüklenemedi: ' + e.message);
            } finally {
                setIsLoading(false);
            }
        } else {
            // Set channel and auto-play
            setSelectedChannel({ ...channel });
            
            // Auto open player
            try {
                const { openExternalPlayer } = await import('./services/api');
                await openExternalPlayer(channel.url, { userAgent: channel.userAgent });
            } catch (e) {
                console.error('Auto-play error:', e);
            }
        }
    };

    const getDisplayedChannels = () => {
        if (selectedCategory && selectedCategory !== 'all' && data.categories) {
            return data.categories[selectedCategory] || [];
        }
        return data.channels;
    };

    const toggleAutoSkip = () => {
        setAutoSkipEnabled(prev => {
            const newValue = !prev;
            localStorage.setItem('auto-skip-enabled', newValue.toString());
            return newValue;
        });
    };

    const handlePlaybackError = () => {
        if (!autoSkipEnabled || !selectedChannel) return;

        const channels = getDisplayedChannels();
        const idx = channels.findIndex(ch => ch.id === selectedChannel.id);

        if (idx !== -1 && idx < channels.length - 1) {
            setSelectedChannel({ ...channels[idx + 1] });
        } else if (channels.length > 1) {
            setSelectedChannel({ ...channels[0] });
        }
    };

    const handleRetry = () => {
        setError(null);
        setIsLoading(true);
        window.location.reload();
    };

    // Loading Screen
    if (isLoading) {
        return (
            <div className="flex h-screen w-screen bg-gray-900 items-center justify-center">
                <div className="text-center">
                    <Loader className="animate-spin text-orange-500 mx-auto mb-4" size={64} />
                    <p className="text-white text-xl">Yükleniyor...</p>
                </div>
            </div>
        );
    }

    // Error Screen
    if (error) {
        return (
            <div className="flex h-screen w-screen bg-gray-900 items-center justify-center">
                <div className="bg-gray-800 p-8 rounded-lg text-center max-w-md">
                    <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <span className="text-white text-3xl">!</span>
                    </div>
                    <h1 className="text-xl font-bold text-white mb-4">Bağlantı Hatası</h1>
                    <p className="text-red-400 mb-6">{error}</p>
                    <button
                        onClick={handleRetry}
                        className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-lg font-medium"
                    >
                        Tekrar Dene
                    </button>
                </div>
            </div>
        );
    }

    // Update Modal
    if (showUpdateModal && updateInfo) {
        return (
            <div className="flex h-screen w-screen bg-gray-900 items-center justify-center">
                <div className="bg-white p-6 rounded-lg w-full max-w-md">
                    <div className="text-center">
                        <div className="w-16 h-16 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Download size={32} className="text-white" />
                        </div>
                        <h2 className="text-xl font-bold mb-2 text-gray-900">Güncelleme Mevcut!</h2>
                        <p className="text-gray-600 mb-4">
                            Yeni versiyon: <span className="font-bold text-orange-600">{updateInfo.latestVersion}</span>
                        </p>
                        <p className="text-sm text-gray-500 mb-4">
                            Mevcut: {updateInfo.currentVersion}
                        </p>
                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={() => setShowUpdateModal(false)}
                                className="px-6 py-2 text-gray-600 border rounded-lg"
                            >
                                Sonra
                            </button>
                            <button
                                onClick={handleUpdateDownload}
                                className="px-6 py-2 bg-orange-500 text-white rounded-lg flex items-center gap-2"
                            >
                                <Download size={18} /> Güncelle
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Category Selection
    if (selectedCategory === null && data.channels.length > 0) {
        return (
            <CategorySelection
                categories={data.categories}
                onSelectCategory={(cat) => {
                    setSelectedCategory(cat);
                    setIsPlaylistView(false);
                }}
            />
        );
    }

    // Main App
    return (
        <div className="flex h-screen w-screen bg-gray-900 overflow-hidden">
            <ChannelList
                channels={getDisplayedChannels()}
                selectedChannel={selectedChannel}
                onSelectChannel={handleChannelSelect}
                isPlaylistView={isPlaylistView}
            />
            <Player
                channel={selectedChannel}
                onPlaybackError={handlePlaybackError}
                autoSkipEnabled={autoSkipEnabled}
                onToggleAutoSkip={toggleAutoSkip}
            />
        </div>
    );
}

export default App;
