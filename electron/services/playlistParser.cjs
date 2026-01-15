const { parse } = require('iptv-playlist-parser');

// Detect content type from URL
const detectContentType = (url, groupTitle, channelName) => {
    const lowerUrl = (url || '').toLowerCase();
    const lowerGroup = String(groupTitle || '').toLowerCase();
    const lowerName = String(channelName || '').toLowerCase();

    // Playlists (Nested M3U)
    if (lowerUrl.includes('type=m3u') ||
        lowerUrl.includes('get.php') ||
        lowerUrl.includes('playlist.php') ||
        (lowerUrl.includes('.m3u') && !lowerUrl.includes('.m3u8'))) {
        return 'playlist';
    }

    // Movies
    if (lowerUrl.includes('/movie/') ||
        lowerGroup.includes('movie') ||
        lowerGroup.includes('film') ||
        lowerGroup.includes('sinema') ||
        lowerGroup.includes('vod') ||
        lowerName.includes('(movie)')) {
        return 'movie';
    }

    // Series
    if (lowerUrl.includes('/series/') ||
        lowerGroup.includes('series') ||
        lowerGroup.includes('dizi') ||
        lowerGroup.includes('season') ||
        lowerGroup.includes('episode') ||
        lowerName.includes('s0') || lowerName.includes('e0') ||
        /s\d{1,2}e\d{1,2}/i.test(channelName)) {
        return 'series';
    }

    // Live TV
    return 'live';
};

const processParsedItems = (items) => {
    const groups = {};
    const categories = { live: [], movie: [], series: [], playlist: [] };

    const channels = items.map((item, index) => {
        const rawUrl = item.url || '';
        const sources = rawUrl.split(',').map(u => u.trim()).filter(u => u.length > 0);
        const mainUrl = sources.length > 0 ? sources[0] : '';

        const groupTitle = item.group?.title || item.group || item.category || 'Other';
        const contentType = detectContentType(mainUrl, groupTitle, item.name);

        if (!groups[groupTitle]) {
            groups[groupTitle] = [];
        }

        const channelObj = {
            id: index,
            name: item.name || `Channel ${index + 1}`,
            logo: item.tvg?.logo || item.logo || '',
            url: mainUrl,
            sources: sources,
            group: groupTitle,
            type: contentType,
            userAgent: item.http?.['user-agent'] || item.userAgent || '',
            referrer: item.http?.referrer || item.referrer || '',
        };

        groups[groupTitle].push(channelObj);
        if (!categories[contentType]) categories[contentType] = [];
        categories[contentType].push(channelObj);

        return channelObj;
    });

    return { channels, groups, categories };
};

const parsePlaylist = (content) => {
    try {
        console.log('Parsing M3U content in Main Process, length:', content.length);

        // Clean up content
        const cleanContent = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        let items = [];

        // 1. Try Library Parser
        try {
            const result = parse(cleanContent);
            if (result && result.items && result.items.length > 0) {
                items = result.items;
                console.log('Main Process: Library parser found', items.length, 'items');
            }
        } catch (libError) {
            console.warn('Main Process: Library parser failed:', libError.message);
        }

        // 2. Fallback: Manual Regex Parser
        if (items.length === 0) {
            console.warn('Main Process: Trying manual regex parsing...');
            const lines = cleanContent.split('\n');
            let currentItem = {};
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                if (line.startsWith('#EXTINF:')) {
                    currentItem = {};
                    // Extract info
                    const infoMatch = line.match(/#EXTINF:(-?\d+)(.*),(.*)$/);
                    if (infoMatch) {
                        const params = infoMatch[2];
                        currentItem.name = infoMatch[3].trim();
                        
                        // Extract attributes
                        const tvgLogoMatch = params.match(/tvg-logo="([^"]*)"/);
                        if (tvgLogoMatch) currentItem.logo = tvgLogoMatch[1];
                        
                        const groupMatch = params.match(/group-title="([^"]*)"/);
                        if (groupMatch) currentItem.group = { title: groupMatch[1] };
                        
                        const tvgIdMatch = params.match(/tvg-id="([^"]*)"/);
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
            console.log('Main Process: Manual parser found', items.length, 'items');
        }

        if (items.length === 0) {
            throw new Error('No items found in parsed result');
        }

        return processParsedItems(items);
    } catch (error) {
        console.error("Main Process: Error parsing M3U:", error);
        throw error;
    }
};

module.exports = { parsePlaylist };
