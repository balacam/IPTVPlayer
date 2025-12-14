import { parse } from 'iptv-playlist-parser';

export const parseM3U = (content) => {
    try {
        console.log('Parsing M3U content, length:', content.length);
        console.log('First 200 chars:', content.substring(0, 200));
        
        // Clean up content - remove BOM and normalize line endings
        const cleanContent = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        const result = parse(cleanContent);
        console.log('Parser result:', result);
        
        if (!result || !result.items || result.items.length === 0) {
            console.warn('No items found in parsed result');
            return { channels: [], groups: {} };
        }
        
        // Transform result into a more usable format for our UI
        // Group by group-title
        const groups = {};
        const channels = result.items.map((item, index) => {
            const groupTitle = item.group?.title || 'Other';
            if (!groups[groupTitle]) {
                groups[groupTitle] = [];
            }

            const channelObj = {
                id: index,
                name: item.name || `Channel ${index + 1}`,
                logo: item.tvg?.logo || '',
                url: item.url,
                group: groupTitle,
                userAgent: item.http?.['user-agent'] || '',
                referrer: item.http?.referrer || '',
            };

            groups[groupTitle].push(channelObj);
            return channelObj;
        });

        console.log('Successfully parsed', channels.length, 'channels in', Object.keys(groups).length, 'groups');
        return { channels, groups };
    } catch (error) {
        console.error("Error parsing M3U:", error);
        console.error("Content that failed to parse:", content.substring(0, 500));
        return { channels: [], groups: {} };
    }
};
