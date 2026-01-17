const { parse } = require('iptv-playlist-parser');

// Pre-compiled regex patterns
const PATTERNS = {
    EXTINF: /#EXTINF:(-?\d+)(.*),(.*)$/,
    TVG_LOGO: /tvg-logo="([^"]*)"/,
    GROUP_TITLE: /group-title="([^"]*)"/,
    TVG_ID: /tvg-id="([^"]*)"/,
    SERIES_EPISODE: /s\d{1,2}e\d{1,2}/i,
    // Pre-compile common content type indicators for faster matching
    TYPE_M3U: /type=m3u|get\.php|playlist\.php|\.m3u(?!8)/i,
    TYPE_MOVIE: /\/movie\/|movie|film|sinema|vod|\(movie\)/i,
    TYPE_SERIES: /\/series\/|series|dizi|season|episode|s0|e0/i
};

// Detect content type from URL
const detectContentType = (url, groupTitle, channelName) => {
    // Optimization: Check most common cases first and avoid repeated string ops
    // Combine fields for single regex check where possible or check sequentially efficiently
    
    // Playlists (Nested M3U)
    if (PATTERNS.TYPE_M3U.test(url)) {
        return 'playlist';
    }

    // Prepare lower case strings once if needed, but regex with /i is often faster than toLowerCase() + includes
    // However, for multiple checks, toLowerCase might be better. 
    // Let's stick to regex with 'i' flag which is optimized in V8.
    
    const groupLower = String(groupTitle || '').toLowerCase();
    
    // Movies
    if (url.includes('/movie/') || 
        PATTERNS.TYPE_MOVIE.test(groupLower) || 
        (channelName && channelName.toLowerCase().includes('(movie)'))) {
        return 'movie';
    }

    // Series
    if (url.includes('/series/') || 
        PATTERNS.TYPE_SERIES.test(groupLower) || 
        PATTERNS.SERIES_EPISODE.test(channelName)) {
        return 'series';
    }

    // Live TV
    return 'live';
};

const processParsedItems = (items) => {
    const groups = {};
    const categories = { live: [], movie: [], series: [], playlist: [] };
    const channels = [];
    
    const len = items.length;
    // Pre-allocate channels array if possible, but push is fast enough in V8
    
    for (let i = 0; i < len; i++) {
        const item = items[i];
        const rawUrl = item.url || '';
        
        // Optimization: Avoid split/map/filter if no comma
        let mainUrl = rawUrl;
        let sources = null;

        if (rawUrl.indexOf(',') > -1) {
            sources = rawUrl.split(',').map(u => u.trim()).filter(u => u.length > 0);
            mainUrl = sources.length > 0 ? sources[0] : '';
        } else {
            sources = [rawUrl];
        }
        
        if (!mainUrl) continue;

        const groupTitle = item.group?.title || item.group || item.category || 'Other';
        const contentType = detectContentType(mainUrl, groupTitle, item.name);

        if (!groups[groupTitle]) {
            groups[groupTitle] = [];
        }

        const channelObj = {
            id: i,
            name: item.name || `Channel ${i + 1}`,
            logo: item.tvg?.logo || item.logo || '',
            tvg: item.tvg || {},
            url: mainUrl,
            sources: sources,
            group: groupTitle,
            type: contentType,
            userAgent: item.http?.['user-agent'] || item.userAgent || '',
            referrer: item.http?.referrer || item.referrer || '',
        };

        groups[groupTitle].push(channelObj);
        channels.push(channelObj);
        
        if (!categories[contentType]) categories[contentType] = [];
        categories[contentType].push(channelObj);
    }

    return { channels, groups, categories };
};

const parsePlaylist = (content) => {
    try {
        // console.time('Main Process Parse'); // Removed for production
        // console.log('Parsing M3U content in Main Process, length:', content.length);

        // Clean up content - Optimized replace
        // Removing BOM and normalizing newlines
        const cleanContent = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        let items = [];

        // 1. Try Library Parser
        try {
            const result = parse(cleanContent);
            if (result && result.items && result.items.length > 0) {
                items = result.items;
                // console.log('Main Process: Library parser found', items.length, 'items');
            }
        } catch (libError) {
            console.warn('Main Process: Library parser failed:', libError.message);
        }

        // 2. Fallback: Manual Regex Parser
        if (items.length === 0) {
            console.warn('Main Process: Trying manual regex parsing...');
            const lines = cleanContent.split('\n');
            const linesLen = lines.length;
            let currentItem = {};
            
            for (let i = 0; i < linesLen; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                if (line.startsWith('#EXTINF:')) {
                    currentItem = {};
                    // Extract info
                    const infoMatch = line.match(PATTERNS.EXTINF);
                    if (infoMatch) {
                        const params = infoMatch[2];
                        currentItem.name = infoMatch[3].trim();
                        
                        // Extract attributes
                        const tvgLogoMatch = params.match(PATTERNS.TVG_LOGO);
                        if (tvgLogoMatch) currentItem.logo = tvgLogoMatch[1];
                        
                        const groupMatch = params.match(PATTERNS.GROUP_TITLE);
                        if (groupMatch) currentItem.group = { title: groupMatch[1] };
                        
                        const tvgIdMatch = params.match(PATTERNS.TVG_ID);
                        if (tvgIdMatch) currentItem.tvg = { id: tvgIdMatch[1], ...currentItem.tvg };
                    }
                } else if (!line.startsWith('#')) {
                    if (currentItem.name) {
                        currentItem.url = line;
                        items.push(currentItem);
                        currentItem = {}; 
                    }
                }
            }
            // console.log('Main Process: Manual parser found', items.length, 'items');
        }

        if (items.length === 0) {
            throw new Error('No items found in parsed result');
        }

        const result = processParsedItems(items);
        // console.timeEnd('Main Process Parse');
        return result;
        
    } catch (error) {
        console.error("Main Process: Error parsing M3U:", error);
        throw error;
    }
};

module.exports = { parsePlaylist };
