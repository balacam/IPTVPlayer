
import { useState } from 'react';
import { Upload, Loader, RefreshCw, Home, ChevronLeft, Database } from 'lucide-react';
import ChannelList from './components/ChannelList';
import Player from './components/Player';
import CategorySelection from './components/CategorySelection';
import { parseM3U, processParsedItems } from './utils/m3uParser';
import { fetchContent, openExternalPlayer, deleteChannelFromFile } from './services/api';
import { fetchChannelsFromSupabase } from './services/supabase';
import { isElectron } from './utils/platform';

function App() {
    const [data, setData] = useState({ channels: [], groups: {}, categories: { live: [], movie: [], series: [] } });
    const [selectedGroup, setSelectedGroup] = useState('All');
    const [selectedChannel, setSelectedChannel] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState(null); // null = show category screen
    const [isPlaylistView, setIsPlaylistView] = useState(false); // true if showing a list of playlists (flat view)
    const [currentPlaylistPath, setCurrentPlaylistPath] = useState(null); // Track the current M3U file path
    const [urlInput, setUrlInput] = useState('');
    const [autoSkipEnabled, setAutoSkipEnabled] = useState(() => {
        return localStorage.getItem('auto-skip-enabled') === 'true';
    });

    // Supabase State
    const [supabaseConfig, setSupabaseConfig] = useState({
        url: import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('supabase-url') || '',
        key: import.meta.env.VITE_SUPABASE_KEY || localStorage.getItem('supabase-key') || ''
    });
    const [showSupabaseModal, setShowSupabaseModal] = useState(false);

    const openInVLC = async (url) => {
        try {
            await openExternalPlayer(url);
        } catch (error) {
            console.error('Failed to open external player:', error);
        }
    };

    const isPlaylistUrl = (url) => {
        const lowerUrl = url.toLowerCase();
        return lowerUrl.includes('type=m3u') ||
            lowerUrl.includes('get.php') ||
            lowerUrl.includes('playlist.php') ||
            (lowerUrl.includes('.m3u') && !lowerUrl.includes('.m3u8'));
    };

    const processPlaylistData = (parsedData) => {
        console.log('Processing Playlist Data:', {
            totalChannels: parsedData.channels.length,
            categories: Object.keys(parsedData.categories).map(k => `${k}: ${parsedData.categories[k].length}`)
        });

        // Check if we have detected playlists in the parser
        // The parser now automatically categorizes nested lists as 'playlist'
        const hasPlaylists = parsedData.categories &&
            parsedData.categories.playlist &&
            parsedData.categories.playlist.length > 0;

        // Also fallback to group name check OR raw URL check just in case
        const containsPlaylists = hasPlaylists || parsedData.channels.some(ch =>
            isPlaylistUrl(ch.url) ||
            (ch.group && ch.group.toLowerCase().includes('playlist'))
        );

        console.log('Processing playlist. hasPlaylists:', hasPlaylists, 'containsPlaylists:', containsPlaylists);

        setData(parsedData);
        setSelectedGroup('All');
        setSelectedChannel(null); // Clear player

        if (containsPlaylists) {
            // Count how many playlist links we have
            const playlistLinks = parsedData.channels.filter(ch => 
                isPlaylistUrl(ch.url) || (ch.group && ch.group.toLowerCase().includes('playlist'))
            );
            
            if (playlistLinks.length === 1) {
                // Only 1 link - auto-open it
                console.log('Only 1 playlist link found, auto-opening:', playlistLinks[0].name);
                // We need to load this playlist - will be handled after state update
                setTimeout(() => {
                    handleChannelSelect(playlistLinks[0], false);
                }, 100);
                return; // Don't update state yet, handleChannelSelect will do it
            }
            
            // Multiple links - show flat list
            setSelectedCategory('all');
            setIsPlaylistView(true);
            console.log('Detected playlist directory with', playlistLinks.length, 'links - showing flat view');
        } else {
            // Standard channels - show category selection
            setSelectedCategory(null);
            setIsPlaylistView(false);
            console.log('Detected standard channels - showing category selection');
        }
    };

    const handleChannelSelect = async (channel, openExternal = false) => {
        // Check if the channel URL looks like a playlist (nested m3u)
        const isPlaylist = isPlaylistUrl(channel.url);

        // If double-clicked and not a playlist, open in VLC
        if (openExternal && !isPlaylist) {
            openInVLC(channel.url);
            setSelectedChannel(channel);
            return;
        }

        if (isPlaylist) {
            setIsLoading(true);
            try {
                console.log('Loading nested playlist from:', channel.url);

                let text;

                try {
                    text = await fetchContent(channel.url);
                } catch (fetchError) {
                    console.error('Fetch error:', fetchError);
                    throw new Error(`Network error: ${fetchError.message}`);
                }

                console.log('Received playlist content length:', text.length);

                if (!text || text.length < 10) {
                    throw new Error('Received empty or invalid playlist content');
                }

                // Check if content looks like M3U
                if (!text.includes('#EXTM3U') && !text.includes('#EXTINF')) {
                    console.warn('Content does not appear to be M3U format:', text.substring(0, 200));
                    throw new Error('Invalid M3U format received');
                }

                // Parse it
                const parsedData = parseM3U(text);

                if (!parsedData.channels || parsedData.channels.length === 0) {
                    throw new Error('No channels found in the playlist');
                }

                console.log('Successfully parsed', parsedData.channels.length, 'channels');

                // Process the new data
                processPlaylistData(parsedData);

            } catch (error) {
                console.error("Failed to load nested playlist:", error);

                const errorMsg = error.message.includes('timeout')
                    ? 'Connection timed out. Please try again.'
                    : error.message.includes('CORS')
                        ? 'Server access error. This playlist may not be supported.'
                        : `Failed to load playlist: ${error.message}`;

                console.warn('User-friendly error:', errorMsg);

                setTimeout(() => {
                    if (confirm(`${errorMsg}\n\nWould you like to try again?`)) {
                        handleChannelSelect(channel);
                    }
                }, 100);

            } finally {
                setIsLoading(false);
            }
        } else {
            // Normal channel playback
            setSelectedChannel(channel);
        }
    };

    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // Store the file path for later use (deletion)
        setCurrentPlaylistPath(file.path || null);

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const parsedData = parseM3U(content);
            processPlaylistData(parsedData);
        };
        reader.readAsText(file);
    };

    const handleUrlLoad = async () => {
        if (!urlInput.trim()) return;
        
        setIsLoading(true);
        try {
            console.log('Loading playlist from URL:', urlInput);
            
            const text = await fetchContent(urlInput);
            
            if (!text || text.length < 10) {
                throw new Error('Received empty or invalid playlist content');
            }

            const parsedData = parseM3U(text);
            if (!parsedData.channels || parsedData.channels.length === 0) {
                throw new Error('No channels found in the playlist');
            }

            // Clear file path since we are loading from URL
            setCurrentPlaylistPath(null);
            
            processPlaylistData(parsedData);
        } catch (error) {
            console.error('URL Load Error:', error);
            alert(`Failed to load playlist: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteChannel = async (channel) => {
        if (!currentPlaylistPath) {
            alert('Dosya yolu bulunamadı. Kanal silinemedi.');
            return;
        }

        const confirmDelete = confirm(`"${channel.name}" kanalını silmek istediğinizden emin misiniz?\n\nBu işlem dosyadan kalıcı olarak silinecektir.`);
        if (!confirmDelete) return;

        try {
            const result = await deleteChannelFromFile(currentPlaylistPath, channel.name, channel.url);

            if (result.success) {
                // Remove from local state
                setData(prevData => {
                    const newChannels = prevData.channels.filter(ch => ch.id !== channel.id);
                    const newGroups = {};
                    const newCategories = { live: [], movie: [], series: [], playlist: [] };

                    newChannels.forEach((ch, index) => {
                        ch.id = index; // Re-index
                        const groupName = ch.group || 'Other';
                        if (!newGroups[groupName]) newGroups[groupName] = [];
                        newGroups[groupName].push(ch);

                        if (!newCategories[ch.type]) newCategories[ch.type] = [];
                        newCategories[ch.type].push(ch);
                    });

                    return { channels: newChannels, groups: newGroups, categories: newCategories };
                });

                // Clear selection if deleted channel was selected
                if (selectedChannel?.id === channel.id) {
                    setSelectedChannel(null);
                }
            } else {
                alert('Kanal silinemedi: ' + (result.error || 'Bilinmeyen hata'));
            }
        } catch (error) {
            console.error('Delete channel error:', error);
            alert('Kanal silinirken hata oluştu: ' + error.message);
        }
    };

    const getDisplayedChannels = () => {
        // Filter by category first, then by group
        let channels = data.channels;

        if (selectedCategory && selectedCategory !== 'all' && data.categories) {
            channels = data.categories[selectedCategory] || [];
        }

        if (selectedGroup === 'All') {
            return channels;
        }

        // Filter by group within category
        return channels.filter(ch => ch.group === selectedGroup);
    };

    const getGroupsForCategory = () => {
        if (!selectedCategory || !data.categories) {
            return data.groups;
        }

        // Build groups from category channels
        const categoryChannels = data.categories[selectedCategory] || [];
        const groups = {};
        categoryChannels.forEach(ch => {
            if (!groups[ch.group]) {
                groups[ch.group] = [];
            }
            groups[ch.group].push(ch);
        });
        return groups;
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
        
        const displayedChannels = getDisplayedChannels();
        const currentIndex = displayedChannels.findIndex(ch => ch.id === selectedChannel.id);
        
        if (currentIndex !== -1 && currentIndex < displayedChannels.length - 1) {
            // Skip to next channel
            const nextChannel = displayedChannels[currentIndex + 1];
            console.log('Auto-skipping to next channel:', nextChannel.name);
            setSelectedChannel(nextChannel);
        } else if (currentIndex === displayedChannels.length - 1 && displayedChannels.length > 1) {
            // If at the end, go back to first channel
            const firstChannel = displayedChannels[0];
            console.log('Auto-skipping to first channel:', firstChannel.name);
            setSelectedChannel(firstChannel);
        }
    };

    const handleSupabaseConnect = async () => {
        if (!supabaseConfig.url || !supabaseConfig.key) {
            alert('Please enter both Supabase URL and Key');
            return;
        }

        setIsLoading(true);
        try {
            // Save credentials
            localStorage.setItem('supabase-url', supabaseConfig.url);
            localStorage.setItem('supabase-key', supabaseConfig.key);

            const channels = await fetchChannelsFromSupabase(supabaseConfig.url, supabaseConfig.key);
            
            if (!channels || channels.length === 0) {
                throw new Error('No channels found in the database');
            }

            console.log('Fetched', channels.length, 'channels from Supabase');

            // Process data
            const processedData = processParsedItems(channels);
            
            // Clear file path since we are loading from Database
            setCurrentPlaylistPath(null);

            processPlaylistData(processedData);
            setShowSupabaseModal(false);
            
        } catch (error) {
            console.error('Supabase Connect Error:', error);
            alert('Failed to load from database: ' + error.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex h-screen w-screen bg-white text-gray-900 overflow-hidden relative">
            {/* Loading Overlay - Tam ekran modal */}
            {isLoading && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 99999
                    }}
                >
                    <div
                        style={{
                            backgroundColor: 'white',
                            padding: '48px 64px',
                            borderRadius: '16px',
                            textAlign: 'center',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                            border: '3px solid #f97316'
                        }}
                    >
                        <Loader
                            className="animate-spin"
                            size={80}
                            style={{ color: '#f97316', marginBottom: '24px' }}
                        />
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1f2937', marginBottom: '8px' }}>
                            Loading Playlist...
                        </div>
                        <div style={{ fontSize: '14px', color: '#6b7280' }}>
                            Please wait
                        </div>
                    </div>
                </div>
            )}

            {/* Supabase Configuration Modal */}
            {showSupabaseModal && (
                <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
                    <div className="bg-white p-6 rounded-lg w-full max-w-md shadow-2xl border border-gray-200">
                        <h2 className="text-xl font-bold mb-4 text-gray-900 flex items-center gap-2">
                            <Database size={24} className="text-orange-500" />
                            Load from Database
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Supabase URL</label>
                                <input
                                    type="text"
                                    value={supabaseConfig.url}
                                    onChange={e => setSupabaseConfig(prev => ({ ...prev, url: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-orange-500 outline-none"
                                    placeholder="https://xyz.supabase.co"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Supabase Anon Key</label>
                                <input
                                    type="password"
                                    value={supabaseConfig.key}
                                    onChange={e => setSupabaseConfig(prev => ({ ...prev, key: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-orange-500 outline-none"
                                    placeholder="eyJh..."
                                />
                            </div>
                            <div className="flex justify-end gap-2 mt-6">
                                <button
                                    onClick={() => setShowSupabaseModal(false)}
                                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSupabaseConnect}
                                    className="px-4 py-2 bg-orange-500 text-white hover:bg-orange-600 rounded-lg font-medium"
                                >
                                    Connect & Load
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* File Upload Overlay if no data */}
            {data.channels.length === 0 && (
                <div className="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-6">
                    <div className="bg-white p-8 rounded-lg shadow-lg border border-gray-200 max-w-md w-full text-center">
                        <div className="w-16 h-16 bg-orange-500 rounded-lg flex items-center justify-center mx-auto mb-6">
                            <Upload size={32} className="text-white" />
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900 mb-6">Welcome to IPTV Player</h1>

                        {/* URL Input Section */}
                        <div className="mb-6">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Enter Playlist URL (http://...)"
                                    value={urlInput}
                                    onChange={(e) => setUrlInput(e.target.value)}
                                    spellCheck={false}
                                    autoComplete="off"
                                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-gray-800"
                                    onKeyDown={(e) => e.key === 'Enter' && handleUrlLoad()}
                                />
                                <button
                                    onClick={handleUrlLoad}
                                    disabled={!urlInput.trim()}
                                    className="bg-gray-800 hover:bg-gray-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                                >
                                    Load
                                </button>
                            </div>
                            <div className="relative my-4">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-gray-300"></div>
                                </div>
                                <div className="relative flex justify-center text-sm">
                                    <span className="px-2 bg-white text-gray-500">OR</span>
                                </div>
                            </div>
                        </div>

                        <label className="block w-full cursor-pointer">
                            <input
                                type="file"
                                accept=".m3u,.m3u8"
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                            <div className="flex items-center justify-center gap-3 bg-orange-500 hover:bg-orange-600 text-white py-3 px-6 rounded-lg font-semibold transition-colors">
                                <Upload size={20} />
                                Select Playlist File
                            </div>
                        </label>

                        <button
                            onClick={() => {
                                if (supabaseConfig.url && supabaseConfig.key) {
                                    handleSupabaseConnect();
                                } else {
                                    setShowSupabaseModal(true);
                                }
                            }}
                            className="flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-6 rounded-lg font-semibold transition-colors mt-3 w-full"
                        >
                            <Database size={20} />
                            {supabaseConfig.url && supabaseConfig.key ? 'Connect to Database' : 'Load from Database'}
                        </button>

                        <p className="mt-4 text-xs text-gray-500">
                            Supports .m3u and .m3u8 playlist files
                        </p>
                    </div>
                </div>
            )}

            {/* Main Layout - Show when data is loaded */}
            {data.channels.length > 0 && (
                selectedCategory === null && !isPlaylistView ? (
                    <CategorySelection
                        categories={data.categories}
                        onSelectCategory={setSelectedCategory}
                        onLoadNewPlaylist={() => {
                            setData({ channels: [], groups: {}, categories: { live: [], movie: [], series: [] } });
                            setSelectedChannel(null);
                            setSelectedGroup('All');
                            setSelectedCategory(null);
                        }}
                    />
                ) : (

                    <>
                        {/* Control Buttons */}
                        <div className="absolute top-4 right-4 z-40 flex gap-2">
                            <button
                                onClick={() => {
                                    setSelectedCategory(null);
                                    setIsPlaylistView(false);
                                    setSelectedChannel(null);
                                }}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-4 py-2 rounded-lg border border-gray-700 shadow-sm transition-colors flex items-center gap-2"
                                title="Back to Categories"
                            >
                                <ChevronLeft size={16} />
                                <span className="text-sm font-medium">Back</span>
                            </button>
                            <button
                                onClick={() => {
                                    setData({ channels: [], groups: {}, categories: { live: [], movie: [], series: [] } });
                                    setSelectedChannel(null);
                                    setSelectedGroup('All');
                                    setSelectedCategory(null);
                                }}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-200 p-2 rounded-lg border border-gray-700 shadow-sm transition-colors"
                                title="Load new playlist"
                            >
                                <RefreshCw size={16} />
                            </button>
                        </div>

                        <ChannelList
                            channels={getDisplayedChannels()}
                            selectedChannel={selectedChannel}
                            onSelectChannel={handleChannelSelect}
                            onDeleteChannel={handleDeleteChannel}
                            isPlaylistView={isPlaylistView}
                            canDelete={!!currentPlaylistPath && isElectron()}
                        />

                        <Player 
                            channel={selectedChannel} 
                            onPlaybackError={handlePlaybackError}
                            autoSkipEnabled={autoSkipEnabled}
                            onToggleAutoSkip={toggleAutoSkip}
                        />
                    </>
                )
            )
            }
        </div >
    );
}

export default App;

