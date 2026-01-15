import { registerPlugin, CapacitorHttp } from '@capacitor/core';

const VlcLauncher = registerPlugin('VlcLauncher');

/**
 * Fetch content from a URL
 */
export const fetchContent = async (url) => {
    try {
        const response = await CapacitorHttp.get({ url });
        return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    } catch (e) {
        console.warn('Capacitor HTTP failed, falling back to fetch:', e);
        const response = await fetch(url);
        return await response.text();
    }
};

/**
 * Fetch and Parse Playlist
 */
export const fetchAndParsePlaylist = async (url) => {
    try {
        const text = await fetchContent(url);
        return { success: true, rawText: text };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Open a URL in external player (Just Video Player)
 */
export const openExternalPlayer = async (url, options = {}) => {
    try {
        await VlcLauncher.launchVideo({
            url: url,
            userAgent: options.userAgent || ''
        });
    } catch (err) {
        if (err.message === 'PLAYER_NOT_INSTALLED' || err.code === 'PLAYER_NOT_INSTALLED') {
            try {
                const { AppLauncher } = await import('@capacitor/app-launcher');
                await AppLauncher.openUrl({
                    url: 'market://details?id=com.brouken.player'
                });
            } catch (e) {
                console.error('Market open failed:', e);
                window.open('https://play.google.com/store/apps/details?id=com.brouken.player', '_blank');
            }
        } else {
            console.error('Player launch error:', err);
        }
    }
};
