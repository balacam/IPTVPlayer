
import { useState } from 'react';
import { Upload, Loader, RefreshCw, Home, ChevronLeft } from 'lucide-react';
import ChannelList from './components/ChannelList';
import Player from './components/Player';
import CategorySelection from './components/CategorySelection';
import { parseM3U } from './utils/m3uParser';

function App() {
    const [data, setData] = useState({ channels: [], groups: {}, categories: { live: [], movie: [], series: [] } });
    const [selectedGroup, setSelectedGroup] = useState('All');
    const [selectedChannel, setSelectedChannel] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState(null); // null = show category screen
    const [isPlaylistView, setIsPlaylistView] = useState(false); // true if showing a list of playlists (flat view)
    const [autoSkipEnabled, setAutoSkipEnabled] = useState(() => {
        return localStorage.getItem('auto-skip-enabled') === 'true';
    });

    const openInVLC = async (url) => {
        try {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external-player', url, 'vlc');
        } catch (error) {
            console.error('Failed to open VLC:', error);
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
            // Found nested playlists - show flat list, skip category screen
            setSelectedCategory('all');
            setIsPlaylistView(true);
            console.log('Detected playlist directory - forcing flat view');
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
                    const { ipcRenderer } = window.require('electron');
                    text = await ipcRenderer.invoke('fetch-content', channel.url);
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

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const parsedData = parseM3U(content);
            processPlaylistData(parsedData);
        };
        reader.readAsText(file);
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

            {/* File Upload Overlay if no data */}
            {data.channels.length === 0 && (
                <div className="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-6">
                    <div className="bg-white p-8 rounded-lg shadow-lg border border-gray-200 max-w-md w-full text-center">
                        <div className="w-16 h-16 bg-orange-500 rounded-lg flex items-center justify-center mx-auto mb-6">
                            <Upload size={32} className="text-white" />
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900 mb-6">Welcome to IPTV Player</h1>

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
                            isPlaylistView={isPlaylistView}
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

