import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';

// Global logo cache - persists across re-renders
const logoCache = new Map();

// Preload logo and cache it
const preloadLogo = (url) => {
    if (!url || logoCache.has(url)) return;

    const img = new Image();
    img.onload = () => {
        logoCache.set(url, 'loaded');
    };
    img.onerror = () => {
        logoCache.set(url, 'error');
    };
    img.src = url;
};

// Channel Logo component with caching
const ChannelLogo = ({ logo }) => {
    const [status, setStatus] = useState(() => {
        if (!logo) return 'error';
        if (logoCache.has(logo)) return logoCache.get(logo);
        return 'loading';
    });
    const imgRef = useRef(null);

    useEffect(() => {
        if (!logo) {
            setStatus('error');
            return;
        }

        // Check cache first
        if (logoCache.has(logo)) {
            setStatus(logoCache.get(logo));
            return;
        }

        // Load the image
        setStatus('loading');
    }, [logo]);

    const handleLoad = () => {
        logoCache.set(logo, 'loaded');
        setStatus('loaded');
    };

    const handleError = () => {
        logoCache.set(logo, 'error');
        setStatus('error');
    };

    if (!logo || status === 'error') {
        return (
            <div
                className="flex-shrink-0 flex items-center justify-center bg-gray-200 rounded"
                style={{ width: '48px', height: '48px', marginRight: '12px' }}
            >
                <span className="text-orange-500 text-lg">▶</span>
            </div>
        );
    }

    return (
        <div
            className="flex-shrink-0 flex items-center justify-center bg-gray-100 rounded overflow-hidden relative"
            style={{ width: '48px', height: '48px', marginRight: '12px' }}
        >
            {status === 'loading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
                    <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            )}
            <img
                ref={imgRef}
                src={logo}
                alt=""
                style={{
                    width: '48px',
                    height: '48px',
                    objectFit: 'contain',
                    opacity: status === 'loaded' ? 1 : 0
                }}
                onLoad={handleLoad}
                onError={handleError}
            />
        </div>
    );
};

const ChannelList = ({ channels, selectedChannel, onSelectChannel, isPlaylistView }) => {
    // Local state for expanded groups
    const [expandedGroups, setExpandedGroups] = useState({});

    // Reset/Init expansion state
    useEffect(() => {
        if (isPlaylistView) {
            setExpandedGroups({ 'List': true });
        } else {
            setExpandedGroups({});
        }
    }, [isPlaylistView, channels]);

    const toggleGroup = (groupName) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupName]: !prev[groupName]
        }));
    };

    // Preload logos when channels change
    useEffect(() => {
        if (channels && channels.length > 0) {
            // Preload first 50 logos immediately
            channels.slice(0, 50).forEach(ch => {
                if (ch.logo) preloadLogo(ch.logo);
            });

            // Preload rest in background
            setTimeout(() => {
                channels.slice(50).forEach(ch => {
                    if (ch.logo) preloadLogo(ch.logo);
                });
            }, 1000);
        }
    }, [channels]);

    // Group channels by their group name, preserving order
    const groupedChannels = channels.reduce((acc, channel) => {
        // If showing playlist view (flat list of links), put everything in one default group
        // Or if you want to use the actual group name but just hide the header?
        // User said "don't group". So flat list.
        const groupName = isPlaylistView ? 'List' : (channel.group || 'Diğer');
        if (!acc[groupName]) {
            acc[groupName] = [];
        }
        acc[groupName].push(channel);
        return acc;
    }, {});

    return (
        <div className="flex-1 bg-[#0f172a] border-r border-gray-800 h-full flex flex-col min-w-[400px]">
            {/* Header */}
            <div className="bg-[#1e293b] border-b border-gray-700 px-4 py-3 shrink-0">
                <div className="flex items-center">
                    <div style={{ width: '48px', marginRight: '16px' }}></div>
                    <div className="flex-1 grid grid-cols-12 gap-4">
                        <span className="col-span-6 text-xs font-semibold uppercase tracking-wider text-gray-400">Başlık</span>
                        <span className="col-span-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Grup</span>
                        <span className="col-span-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Tür</span>
                    </div>
                </div>
            </div>

            {/* Channel List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {channels.length === 0 ? (
                    <div className="p-12 text-gray-500 text-sm text-center flex flex-col items-center justify-center h-full">
                        <span className="text-4xl mb-4">📺</span>
                        <p>Bu grupta kanal bulunamadı.</p>
                    </div>
                ) : (
                    <div className="pb-4">
                        {Object.entries(groupedChannels).map(([groupName, groupChannels]) => {
                            const isExpanded = expandedGroups[groupName];
                            return (
                                <div key={groupName}>
                                    {/* Group Header - Only show if NOT in playlist view */}
                                    {!isPlaylistView && (
                                        <div
                                            className="sticky top-0 z-10 bg-[#1e293b]/95 backdrop-blur supports-[backdrop-filter]:bg-[#1e293b]/80 border-y border-gray-700/50 px-4 py-2 font-bold text-orange-500 text-sm shadow-sm flex justify-between items-center cursor-pointer hover:bg-[#253248] transition-colors"
                                            onClick={() => toggleGroup(groupName)}
                                        >
                                            <div className="flex items-center gap-2">
                                                {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                                                <span className="flex items-center gap-2">
                                                    {isExpanded ? <FolderOpen size={14} className="text-orange-500/80" /> : <Folder size={14} className="text-gray-400" />}
                                                    {groupName}
                                                </span>
                                            </div>
                                            <span className="text-xs font-normal text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full">
                                                {groupChannels.length}
                                            </span>
                                        </div>
                                    )}

                                    {/* Channels in this group */}
                                    {(isPlaylistView || isExpanded) && groupChannels.map((channel) => (
                                        <div
                                            key={channel.id}
                                            className={`flex items-center px-4 py-3 border-b border-gray-800/50 cursor-pointer transition-all duration-200 group ${selectedChannel?.id === channel.id
                                                ? 'bg-blue-600/20 border-l-4 border-l-blue-500'
                                                : 'hover:bg-gray-800/50 border-l-4 border-l-transparent'
                                                }`}
                                            onClick={() => onSelectChannel(channel, false)}
                                            onDoubleClick={() => onSelectChannel(channel, true)}
                                        >
                                            {/* Channel Logo */}
                                            <ChannelLogo logo={channel.logo} />

                                            {/* Channel Info */}
                                            <div className="flex-1 min-w-0 grid grid-cols-12 gap-4 ml-4">
                                                <div className="col-span-6 flex flex-col justify-center">
                                                    <span className={`font-medium text-sm truncate ${selectedChannel?.id === channel.id ? 'text-blue-100' : 'text-gray-200 group-hover:text-white'
                                                        }`}>
                                                        {channel.name}
                                                    </span>
                                                </div>
                                                <div className="col-span-3 flex items-center">
                                                    <span className="text-xs text-gray-500 truncate group-hover:text-gray-400">
                                                        {channel.url.includes('get.php') || channel.url.includes('type=m3u')
                                                            ? 'Playlist'
                                                            : channel.group || '-'
                                                        }
                                                    </span>
                                                </div>
                                                <div className="col-span-3 flex items-center">
                                                    <span className={`text-xs px-2 py-1 rounded-full truncate ${channel.url.includes('get.php') || channel.url.includes('type=m3u')
                                                        ? 'bg-purple-900/50 text-purple-300'
                                                        : 'bg-gray-800 text-gray-400'
                                                        }`}>
                                                        {channel.url.includes('get.php') || channel.url.includes('type=m3u')
                                                            ? 'Link'
                                                            : 'Stream'
                                                        }
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChannelList;