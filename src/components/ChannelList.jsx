import { useState, useEffect, useRef } from 'react';

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

const ChannelList = ({ channels, selectedChannel, onSelectChannel }) => {
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

    return (
        <div className="w-[420px] bg-gray-50 border-r border-gray-200 h-full flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-2 py-1.5">
                <div className="flex items-center">
                    <div style={{ width: '48px', marginRight: '12px' }}></div>
                    <div className="flex-1 grid grid-cols-3 gap-2">
                        <span className="text-xs font-medium text-gray-600">Başlık</span>
                        <span className="text-xs font-medium text-gray-600">Grup</span>
                        <span className="text-xs font-medium text-gray-600">Tür</span>
                    </div>
                </div>
            </div>
            
            {/* Channel List */}
            <div className="flex-1 overflow-y-auto bg-white">
                {channels.length === 0 ? (
                    <div className="p-8 text-gray-500 text-xs text-center">
                        Bu grupta kanal yok.
                    </div>
                ) : (
                    <div>
                        {channels.map((channel) => (
                            <div
                                key={channel.id}
                                className={`flex items-center px-2 py-1.5 border-b border-gray-100 cursor-pointer transition-colors ${
                                    selectedChannel?.id === channel.id 
                                        ? 'bg-blue-100 border-blue-200' 
                                        : 'hover:bg-gray-50'
                                }`}
                                onClick={() => onSelectChannel(channel, false)}
                                onDoubleClick={() => onSelectChannel(channel, true)}
                            >
                                {/* Channel Logo */}
                                <ChannelLogo logo={channel.logo} />
                                
                                {/* Channel Info - 12px minimum font */}
                                <div className="flex-1 min-w-0 grid grid-cols-3 gap-2">
                                    <div className="truncate">
                                        <span className="text-xs text-gray-900 font-medium" style={{ fontSize: '12px' }}>
                                            {channel.name}
                                        </span>
                                    </div>
                                    <div className="truncate">
                                        <span className="text-xs text-gray-600" style={{ fontSize: '12px' }}>
                                            {channel.url.includes('get.php') || channel.url.includes('type=m3u') 
                                                ? 'Playlist' 
                                                : channel.group || '-'
                                            }
                                        </span>
                                    </div>
                                    <div className="truncate">
                                        <span className="text-xs text-gray-600" style={{ fontSize: '12px' }}>
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
                )}
            </div>
        </div>
    );
};

export default ChannelList;