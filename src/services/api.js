
import { isElectron, isCapacitor } from '../utils/platform';

// For Capacitor, we'll need to import these dynamically or assume they are available globally if we were using a bundler that supports it nicely.
// Since we are in Vite, we can import them, but we need to make sure we install them.
// import { Http } from '@capacitor/http';
// import { App as CapacitorApp } from '@capacitor/app';

/**
 * Fetch content from a URL handling CORS if necessary
 * @param {string} url 
 * @returns {Promise<string>}
 */
export const fetchContent = async (url) => {
    if (isElectron()) {
        return await window.electronAPI.invoke('fetch-content', url);
    } else if (isCapacitor()) {
        // Use Capacitor HTTP to bypass CORS on Android
        // We assume @capacitor/http is installed
        const { Http } = await import('@capacitor/http');
        const response = await Http.get({ url });
        return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    } else {
        // Web fallback (CORS might be an issue)
        const response = await fetch(url);
        return await response.text();
    }
};

/**
 * Open a URL in an external player (VLC)
 * @param {string} url 
 * @returns {Promise<void>}
 */
export const openExternalPlayer = async (url) => {
    if (isElectron()) {
        await window.electronAPI.invoke('open-external-player', url, 'vlc');
    } else if (isCapacitor()) {
        // On Android, we can try to open the URL with an Intent
        // This usually prompts the user to choose an app (VLC, MX Player, etc.)
        const { App: CapacitorApp } = await import('@capacitor/app');
        await CapacitorApp.openUrl({ url });
    } else {
        window.open(url, '_blank');
    }
};

/**
 * Delete a channel from the local M3U file
 * @param {string} filePath 
 * @param {string} channelName 
 * @param {string} channelUrl 
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteChannelFromFile = async (filePath, channelName, channelUrl) => {
    if (isElectron()) {
        return await window.electronAPI.invoke('delete-channel-from-file', filePath, channelName, channelUrl);
    } else {
        // File modification not fully supported in Web/Capacitor mode for external M3U files yet
        // We could implement filesystem access for Capacitor later
        return { success: false, error: 'File editing is only supported in Desktop mode' };
    }
};

/**
 * Get info about available players
 */
export const getPlayerInfo = async () => {
    if (isElectron()) {
        return await window.electronAPI.invoke('get-player-info');
    } else {
        return {
            vlcAvailable: false,
            mpvAvailable: false,
            ffmpegAvailable: false
        };
    }
};
