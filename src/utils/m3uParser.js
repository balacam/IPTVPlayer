import { parse } from 'iptv-playlist-parser';

// Detect content type from URL
const detectContentType = (url, groupTitle) => {
    const lowerUrl = url.toLowerCase();
    const lowerGroup = (groupTitle || '').toLowerCase();

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
        lowerGroup.includes('sinema')) {
        return 'movie';
    }

    // Series
    if (lowerUrl.includes('/series/') ||
        lowerGroup.includes('series') ||
        lowerGroup.includes('dizi')) {
        return 'series';
    }

    // Live TV (default for streams)
    return 'live';
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

        // Transform result into a more usable format for our UI
        const groups = {};
        const categories = { live: [], movie: [], series: [], playlist: [] };

        const channels = result.items.map((item, index) => {
            const groupTitle = item.group?.title || 'Other';
            const contentType = detectContentType(item.url, groupTitle);

            if (!groups[groupTitle]) {
                groups[groupTitle] = [];
            }

            const channelObj = {
                id: index,
                name: item.name || `Channel ${index + 1}`,
                logo: item.tvg?.logo || '',
                url: item.url,
                group: groupTitle,
                type: contentType,
                userAgent: item.http?.['user-agent'] || '',
                referrer: item.http?.referrer || '',
            };

            groups[groupTitle].push(channelObj);
            // Ensure category exists before pushing (though we initialized known ones)
            if (!categories[contentType]) categories[contentType] = [];
            categories[contentType].push(channelObj);

            return channelObj;
        });

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
