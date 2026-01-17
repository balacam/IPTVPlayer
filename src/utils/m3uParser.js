
// Pre-compiled regex patterns for better performance
const PATTERNS = {
    EXTINF: /#EXTINF:(-?\d+)(.*),(.*)$/,
    TVG_LOGO: /tvg-logo="([^"]*)"/,
    GROUP_TITLE: /group-title="([^"]*)"/,
    TVG_ID: /tvg-id="([^"]*)"/,
    TVG_NAME: /tvg-name="([^"]*)"/,
    USER_AGENT: /user-agent="([^"]*)"/,
    SERIES_EPISODE: /s\d{1,2}e\d{1,2}/i,
    // Pre-compile common content type indicators for faster matching
    TYPE_M3U: /type=m3u|get\.php|playlist\.php|\.m3u(?!8)/i,
    TYPE_MOVIE: /\/movie\/|movie|film|sinema|vod|\(movie\)/i,
    TYPE_SERIES: /\/series\/|series|dizi|season|episode|s0|e0/i,
    EXTVLCOPT_USER_AGENT: /http-user-agent=(.*)/i,
    EXTVLCOPT_REFERRER: /http-referrer=(.*)/i
};

// Helper function to extract attributes
const getAttribute = (line, pattern) => {
    const match = line.match(pattern);
    return match ? match[1] : null;
};

// Detect content type from URL
const detectContentType = (url, groupTitle, channelName) => {
    // Playlists (Nested M3U)
    if (PATTERNS.TYPE_M3U.test(url)) {
        return 'playlist';
    }

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

export const processParsedItems = (items) => {
    const groups = {};
    const categories = { live: [], movie: [], series: [], playlist: [] };
    const channels = [];
    
    const len = items.length;
    
    for (let i = 0; i < len; i++) {
        const item = items[i];
        const rawUrl = item.url || '';
        
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
            logo: item.logo || item.tvg?.logo || '',
            tvg: item.tvg || {},
            url: mainUrl,
            sources: sources,
            group: groupTitle,
            type: contentType,
            userAgent: item.userAgent || item.http?.['user-agent'] || '',
            referrer: item.referrer || item.http?.referrer || '',
        };

        groups[groupTitle].push(channelObj);
        channels.push(channelObj);
        
        if (!categories[contentType]) categories[contentType] = [];
        categories[contentType].push(channelObj);
    }

    return { channels, groups, categories };
};

export const parseM3U = (content) => {
    try {
        // console.time('M3U Parse Time');
        // Clean up content - remove BOM and normalize line endings
        const cleanContent = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        const lines = cleanContent.split('\n');
        const linesLen = lines.length;
        const items = [];
        
        let currentItem = {
            tvg: {},
            http: {},
            group: {}
        };
        
        for (let i = 0; i < linesLen; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith('#EXTINF:')) {
                // New item starts, reset currentItem but preserve nothing from previous
                // Actually, EXTINF starts a new item definition.
                // If we had a previous item pending without URL (unlikely in valid m3u but possible), it's lost or we could push it?
                // Standard says: EXTINF followed by URL.
                
                currentItem = {
                    tvg: {},
                    http: {},
                    group: {}
                };
                
                const infoMatch = line.match(PATTERNS.EXTINF);
                if (infoMatch) {
                    const params = infoMatch[2];
                    currentItem.name = infoMatch[3].trim();
                    
                    // Extract attributes
                    const logo = getAttribute(params, PATTERNS.TVG_LOGO);
                    if (logo) currentItem.tvg.logo = logo;

                    const id = getAttribute(params, PATTERNS.TVG_ID);
                    if (id) currentItem.tvg.id = id;

                    const name = getAttribute(params, PATTERNS.TVG_NAME);
                    if (name) currentItem.tvg.name = name;

                    const group = getAttribute(params, PATTERNS.GROUP_TITLE);
                    if (group) currentItem.group.title = group;
                    
                    const userAgent = getAttribute(params, PATTERNS.USER_AGENT);
                    if (userAgent) currentItem.http['user-agent'] = userAgent;
                }
            } else if (line.startsWith('#EXTVLCOPT:')) {
                const uaMatch = line.match(PATTERNS.EXTVLCOPT_USER_AGENT);
                if (uaMatch) currentItem.http['user-agent'] = uaMatch[1];
                
                const refMatch = line.match(PATTERNS.EXTVLCOPT_REFERRER);
                if (refMatch) currentItem.http.referrer = refMatch[1];
            } else if (line.startsWith('#EXTGRP:')) {
                 const groupTitle = line.substring(8).trim();
                 if (groupTitle) currentItem.group.title = groupTitle;
            } else if (!line.startsWith('#')) {
                // This is the URL
                if (currentItem.name) {
                    currentItem.url = line;
                    items.push(currentItem);
                    // Reset after adding
                    currentItem = {
                        tvg: {},
                        http: {},
                        group: {}
                    };
                }
            }
        }

        if (items.length === 0) {
            console.warn('No items found in parsed result');
            return { channels: [], groups: {}, categories: { live: [], movie: [], series: [] } };
        }

        const result = processParsedItems(items);
        // console.timeEnd('M3U Parse Time');

        return result;
    } catch (error) {
        console.error("Error parsing M3U:", error);
        return { channels: [], groups: {}, categories: { live: [], movie: [], series: [] } };
    }
};
