import { parse } from 'iptv-playlist-parser';

// Detect content type from URL
const detectContentType = (url, groupTitle, channelName) => {
    const lowerUrl = url.toLowerCase();
    const lowerGroup = (groupTitle || '').toLowerCase();
    const lowerName = (channelName || '').toLowerCase();

    // Playlists (Nested M3U)
    if (lowerUrl.includes('type=m3u') ||
        lowerUrl.includes('get.php') ||
        lowerUrl.includes('playlist.php') ||
        (lowerUrl.includes('.m3u') && !lowerUrl.includes('.m3u8'))) {
        return 'playlist';
    }

    // Movies - check URL pattern AND group/name keywords
    if (lowerUrl.includes('/movie/') ||
        lowerGroup.includes('movie') ||
        lowerGroup.includes('film') ||
        lowerGroup.includes('sinema') ||
        lowerGroup.includes('vod') ||
        lowerName.includes('(movie)')) {
        return 'movie';
    }

    // Series - check URL pattern AND group/name keywords
    if (lowerUrl.includes('/series/') ||
        lowerGroup.includes('series') ||
        lowerGroup.includes('dizi') ||
        lowerGroup.includes('season') ||
        lowerGroup.includes('episode') ||
        lowerName.includes('s0') || lowerName.includes('e0') ||
        /s\d{1,2}e\d{1,2}/i.test(channelName)) {
        return 'series';
    }

    // Live TV - everything else (most IPTV streams are live)
    // Standard IPTV URLs like http://server:port/user/pass/channelid are live
    return 'live';
};

export const processParsedItems = (items) => {
    const groups = {};
    const categories = { live: [], movie: [], series: [], playlist: [] };

    const channels = items.map((item, index) => {
        // Handle multiple URLs (comma separated)
        // e.g. "http://url1,http://url2"
        const rawUrl = item.url || '';
        const sources = rawUrl.split(',').map(u => u.trim()).filter(u => u.length > 0);
        const mainUrl = sources.length > 0 ? sources[0] : '';

        // Handle different input structures (M3U parser vs Database)
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
            sources: sources, // Store all available sources
            group: groupTitle,
            type: contentType,
            userAgent: item.http?.['user-agent'] || item.userAgent || '',
            referrer: item.http?.referrer || item.referrer || '',
        };

        groups[groupTitle].push(channelObj);
        // Ensure category exists before pushing (though we initialized known ones)
        if (!categories[contentType]) categories[contentType] = [];
        categories[contentType].push(channelObj);

        return channelObj;
    });

    return { channels, groups, categories };
};

export const parseM3U = (content) => {
    try {
        console.log('Parsing M3U content, length:', content.length);

        // Clean up content - remove BOM and normalize line endings
        const cleanContent = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const result = parse(cleanContent);

        if (!result || !result.items || result.items.length === 0) {
            console.warn('No items found in parsed result');
            return { channels: [], groups: {}, categories: { live: [], movie: [], series: [] } };
        }

        const { channels, groups, categories } = processParsedItems(result.items);

        console.log('Parsed', channels.length, 'channels:',
            categories.live.length, 'live,',
            categories.movie.length, 'movies,',
            categories.series.length, 'series');

        return { channels, groups, categories };
    } catch (error) {
        console.error("Error parsing M3U:", error);
        return { channels: [], groups: {}, categories: { live: [], movie: [], series: [] } };
    }
};
