const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Invoke methods (Promise based)
    invoke: (channel, ...args) => {
        const validChannels = [
            'fetch-content',
            'fetch-and-parse-playlist',
            'open-external-player',
            'delete-channel-from-file',
            'get-player-info',
            'get-ffmpeg-status',
            'download-ffmpeg',
            'stop-ffmpeg-transcode',
            'start-ffmpeg-transcode',
            'get-proxy-url',
            'play-embedded-vlc',
            'stop-embedded-vlc',
            'supabase-fetch-channels'
        ];
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args);
        }
        return Promise.reject(new Error(`Invalid channel: ${channel}`));
    },
    
    // On methods (Event listener)
    on: (channel, func) => {
        const validChannels = ['ffmpeg-download-progress'];
        if (validChannels.includes(channel)) {
            // Strip event as it includes sender
            const subscription = (event, ...args) => func(event, ...args);
            ipcRenderer.on(channel, subscription);
            
            // Return cleanup function
            return () => {
                ipcRenderer.removeListener(channel, subscription);
            };
        }
    },

    // Remove listener
    removeListener: (channel, func) => {
        const validChannels = ['ffmpeg-download-progress'];
        if (validChannels.includes(channel)) {
            ipcRenderer.removeListener(channel, func);
        }
    }
});
