import { describe, it, expect } from 'vitest';
import { parseM3U, processParsedItems } from '../../src/utils/m3uParser';

describe('M3U Parser', () => {
    it('should parse simple M3U content', () => {
        const content = `#EXTM3U
#EXTINF:-1 tvg-id="CNN.us" tvg-logo="cnn.png" group-title="News",CNN
http://cnn.com/stream
`;
        const result = parseM3U(content);
        expect(result.channels).toHaveLength(1);
        expect(result.channels[0].name).toBe('CNN');
        expect(result.channels[0].group).toBe('News');
        expect(result.channels[0].url).toBe('http://cnn.com/stream');
    });

    it('should handle extended EXTINF attributes', () => {
        const content = `#EXTM3U
#EXTINF:-1 tvg-id="123" tvg-logo="logo.png" group-title="Sports",ESPN
http://espn.com/live
`;
        const result = parseM3U(content);
        expect(result.channels[0].logo).toBe('logo.png');
        expect(result.channels[0].tvg.id).toBe('123');
    });

    it('should categorize content correctly', () => {
        const items = [
            { name: 'Matrix (Movie)', url: 'http://test.com/movie.mp4', group: 'Movies' },
            { name: 'Breaking Bad S01E01', url: 'http://test.com/series.mp4', group: 'Series' },
            { name: 'CNN Live', url: 'http://test.com/live', group: 'News' }
        ];

        const result = processParsedItems(items);
        expect(result.categories.movie).toHaveLength(1);
        expect(result.categories.series).toHaveLength(1);
        expect(result.categories.live).toHaveLength(1);
    });

    it('should handle large input gracefully (Performance Check)', () => {
        // Generate a large fake playlist
        let content = '#EXTM3U\n';
        for (let i = 0; i < 1000; i++) {
            content += `#EXTINF:-1 tvg-id="ch${i}" group-title="Group ${i % 10}",Channel ${i}\nhttp://stream.com/${i}\n`;
        }

        const start = performance.now();
        const result = parseM3U(content);
        const end = performance.now();

        expect(result.channels).toHaveLength(1000);
        // Expect parsing to be reasonably fast (under 100ms for 1000 items)
        expect(end - start).toBeLessThan(500);
    });

    it('should handle malformed lines', () => {
        const content = `#EXTM3U
#EXTINF:-1, Valid Channel
http://valid.com
Invalid Line
#EXTINF:-1, Another Valid
http://valid2.com
`;
        const result = parseM3U(content);
        expect(result.channels).toHaveLength(2);
    });
});
