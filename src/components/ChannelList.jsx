import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Search, Trash2 } from 'lucide-react';
import { useDebounce } from '../hooks/useDebounce';

// Global logo cache
const logoCache = new Map();

const preloadLogo = (url) => {
    if (!url || logoCache.has(url)) return;
    const img = new Image();
    img.onload = () => logoCache.set(url, 'loaded');
    img.onerror = () => logoCache.set(url, 'error');
    img.src = url;
};

// Channel Logo component
const ChannelLogo = ({ logo }) => {
    const [status, setStatus] = useState(() => {
        if (!logo) return 'error';
        if (logoCache.has(logo)) return logoCache.get(logo);
        return 'loading';
    });

    useEffect(() => {
        if (!logo) { setStatus('error'); return; }
        if (logoCache.has(logo)) { setStatus(logoCache.get(logo)); return; }
        setStatus('loading');
    }, [logo]);

    if (!logo || status === 'error') {
        return (
            <div className="flex-shrink-0 flex items-center justify-center bg-gray-700 rounded"
                style={{ width: '40px', height: '40px' }}>
                <span className="text-orange-500 text-sm">▶</span>
            </div>
        );
    }

    return (
        <div className="flex-shrink-0 flex items-center justify-center bg-gray-800 rounded overflow-hidden"
            style={{ width: '40px', height: '40px' }}>
            <img
                src={logo}
                alt=""
                style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                onLoad={() => { logoCache.set(logo, 'loaded'); setStatus('loaded'); }}
                onError={() => { logoCache.set(logo, 'error'); setStatus('error'); }}
            />
        </div>
    );
};

const ChannelList = ({ channels, selectedChannel, onSelectChannel, onDeleteChannel, isPlaylistView, canDelete }) => {
    const [expandedGroups, setExpandedGroups] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, channel: null });
    const listRef = useRef(null);
    const contextMenuRef = useRef(null);

    // Close context menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
                setContextMenu({ visible: false, x: 0, y: 0, channel: null });
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleContextMenu = useCallback((e, channel) => {
        e.preventDefault();
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            channel
        });
    }, []);

    const handleDeleteClick = useCallback(() => {
        if (contextMenu.channel && onDeleteChannel) {
            onDeleteChannel(contextMenu.channel);
        }
        setContextMenu({ visible: false, x: 0, y: 0, channel: null });
    }, [contextMenu.channel, onDeleteChannel]);

    // Filter channels by search
    const filteredChannels = useMemo(() => {
        if (!debouncedSearchTerm.trim()) return channels;
        const term = debouncedSearchTerm.toLowerCase();
        return channels.filter(ch => 
            ch.name.toLowerCase().includes(term) || 
            (ch.group && ch.group.toLowerCase().includes(term))
        );
    }, [channels, debouncedSearchTerm]);

    // Group channels
    const groupedChannels = useMemo(() => {
        return filteredChannels.reduce((acc, channel) => {
            const groupName = isPlaylistView ? 'All' : (channel.group || 'Other');
            if (!acc[groupName]) acc[groupName] = [];
            acc[groupName].push(channel);
            return acc;
        }, {});
    }, [filteredChannels, isPlaylistView]);

    // Build flat list with group headers for virtualization
    const flatList = useMemo(() => {
        const items = [];
        Object.entries(groupedChannels).forEach(([groupName, groupChannels]) => {
            if (!isPlaylistView) {
                items.push({ type: 'header', groupName, count: groupChannels.length });
            }
            if (isPlaylistView || expandedGroups[groupName]) {
                groupChannels.forEach(channel => {
                    items.push({ type: 'channel', channel });
                });
            }
        });
        return items;
    }, [groupedChannels, expandedGroups, isPlaylistView]);

    const toggleGroup = useCallback((groupName) => {
        setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }));
    }, []);

    // Preload logos
    useEffect(() => {
        if (channels?.length > 0) {
            channels.slice(0, 100).forEach(ch => ch.logo && preloadLogo(ch.logo));
        }
    }, [channels]);

    // Row renderer
    const Row = useCallback(({ index, style }) => {
        const item = flatList[index];
        
        if (item.type === 'header') {
            const isExpanded = expandedGroups[item.groupName];
            return (
                <div style={style}
                    className="bg-[#1e293b] border-b border-gray-700/50 px-4 flex items-center cursor-pointer hover:bg-[#253248] transition-colors"
                    onClick={() => toggleGroup(item.groupName)}>
                    <div className="flex items-center gap-2 flex-1">
                        {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                        {isExpanded ? <FolderOpen size={14} className="text-orange-500" /> : <Folder size={14} className="text-gray-400" />}
                        <span className="font-bold text-orange-500 text-sm">{item.groupName}</span>
                    </div>
                    <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full">{item.count}</span>
                </div>
            );
        }

        const channel = item.channel;
        const isSelected = selectedChannel?.id === channel.id;
        const isPlaylist = channel.url.includes('get.php') || channel.url.includes('type=m3u');

        return (
            <div style={style}
                className={`flex items-center px-4 gap-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-600/20 border-l-4 border-l-blue-500' : 'hover:bg-gray-800/50 border-l-4 border-l-transparent'
                }`}
                onClick={() => onSelectChannel(channel, false)}
                onDoubleClick={() => onSelectChannel(channel, true)}
                onContextMenu={(e) => handleContextMenu(e, channel)}>
                <ChannelLogo logo={channel.logo} />
                <div className="flex-1 min-w-0">
                    <div className={`font-medium text-sm truncate ${isSelected ? 'text-blue-100' : 'text-gray-200'}`}>
                        {channel.name}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{channel.group || '-'}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${isPlaylist ? 'bg-purple-900/50 text-purple-300' : 'bg-gray-800 text-gray-400'}`}>
                    {isPlaylist ? 'Link' : 'Stream'}
                </span>
            </div>
        );
    }, [flatList, expandedGroups, selectedChannel, onSelectChannel, toggleGroup, handleContextMenu]);


    return (
        <div className="w-[450px] bg-[#0f172a] border-r border-gray-800 h-full flex flex-col relative">
            {/* Context Menu */}
            {contextMenu.visible && canDelete && (
                <div
                    ref={contextMenuRef}
                    className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    <button
                        onClick={handleDeleteClick}
                        className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-900/30 flex items-center gap-2 transition-colors"
                    >
                        <Trash2 size={14} />
                        Kanalı Sil
                    </button>
                </div>
            )}

            {/* Search */}
            <div className="p-3 border-b border-gray-800">
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        type="text"
                        placeholder="Search channels..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-orange-500"
                    />
                </div>
                <div className="mt-2 text-xs text-gray-500">
                    {filteredChannels.length} channels {searchTerm && `(for "${searchTerm}")`}
                </div>
            </div>

            {/* Virtualized List */}
            <div className="flex-1">
                {flatList.length === 0 ? (
                    <div className="p-12 text-gray-500 text-sm text-center flex flex-col items-center justify-center h-full">
                        <span className="text-4xl mb-4">📺</span>
                        <p>No channels found.</p>
                    </div>
                ) : (
                    <AutoSizer>
                        {({ height, width }) => (
                            <List
                                ref={listRef}
                                height={height}
                                width={width}
                                itemCount={flatList.length}
                                itemSize={56}
                                overscanCount={10}
                            >
                                {Row}
                            </List>
                        )}
                    </AutoSizer>
                )}
            </div>
        </div>
    );
};

export default ChannelList;
