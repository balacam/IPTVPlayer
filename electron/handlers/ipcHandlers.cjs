const { ipcMain, shell, BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const { getProxyUrl } = require('../services/proxyServer.cjs');
const { 
    startFFmpegTranscode, 
    stopFFmpegTranscode, 
    getFFmpegStatus, 
    downloadFFmpeg 
} = require('../services/ffmpegManager.cjs');
const { findVlcPath, findMpvPath } = require('../services/utils.cjs');
const { parsePlaylist } = require('../services/playlistParser.cjs');

let vlcWindow = null;
let vlcProcess = null;

function setupIpcHandlers(mainWindow) {
    // Proxy URL
    ipcMain.handle('get-proxy-url', (event, streamUrl) => {
        return getProxyUrl(streamUrl);
    });

    // Fetch and Parse Playlist (Main Process)
    ipcMain.handle('fetch-and-parse-playlist', async (event, url) => {
        try {
            console.log('Fetching and parsing playlist from:', url);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            if (!response.ok) {
                console.error(`HTTP Error: ${response.status} ${response.statusText}`);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const text = await response.text();
            console.log('Content fetched successfully. Length:', text.length);
            
            if (!text || text.length < 10) {
                throw new Error('Received empty or invalid playlist content');
            }

            // Parse content in Main Process
            const parsedData = parsePlaylist(text);
            console.log('Playlist parsed successfully. Channels:', parsedData.channels.length);
            
            return { success: true, data: parsedData };

        } catch (error) {
            console.error('Fetch and parse error:', error);
            return { success: false, error: error.message };
        }
    });

    // Supabase Fetch
    ipcMain.handle('supabase-fetch-channels', async (event, url, key) => {
        try {
            console.log('Fetching channels from Supabase via Main Process');
            if (!url || !key) throw new Error('Missing URL or Key');

            const supabase = createClient(url, key);
            
            const { data, error } = await supabase
                .from('channels')
                .select('*')
                .order('id', { ascending: true });

            if (error) throw error;
            return { success: true, data };
        } catch (error) {
            console.error('Supabase fetch error:', error);
            return { success: false, error: error.message };
        }
    });

    // Delete Channel
    ipcMain.handle('delete-channel-from-file', async (event, filePath, channelName, channelUrl) => {
        try {
            console.log('Deleting channel from file:', filePath);

            // Security check
            if (!filePath.toLowerCase().endsWith('.m3u') && !filePath.toLowerCase().endsWith('.m3u8')) {
                return { success: false, error: 'Invalid file type' };
            }

            if (!fs.existsSync(filePath)) {
                return { success: false, error: 'File not found' };
            }

            const content = await fs.promises.readFile(filePath, 'utf8');
            const lines = content.split(/\r?\n/);
            const newLines = [];
            let skipNext = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (skipNext) {
                    skipNext = false;
                    continue;
                }

                if (line.startsWith('#EXTINF')) {
                    const nextLine = lines[i + 1] || '';
                    if (nextLine.trim() === channelUrl.trim()) {
                        skipNext = true;
                        continue;
                    }
                }

                newLines.push(line);
            }

            await fs.promises.writeFile(filePath, newLines.join('\n'), 'utf8');
            return { success: true };
        } catch (error) {
            console.error('Failed to delete channel:', error);
            return { success: false, error: error.message };
        }
    });

    // Fetch Content
    ipcMain.handle('fetch-content', async (event, url) => {
        try {
            console.log('Fetching content from:', url);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            if (!response.ok) {
                console.error(`HTTP Error: ${response.status} ${response.statusText}`);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const text = await response.text();
            console.log('Content fetched successfully. Length:', text.length);
            console.log('Content preview (first 500 chars):', text.substring(0, 500));
            
            return text;
        } catch (error) {
            console.error('Fetch content error:', error);
            throw error;
        }
    });

    // Open External Player
    ipcMain.handle('open-external-player', async (event, url, playerType = 'vlc', options = {}) => {
        try {
            console.log(`Opening ${playerType} with URL:`, url);
            
            if (playerType === 'vlc') {
                const vlcPath = findVlcPath();
                if (vlcPath) {
                    const args = [url];
                    
                    // Add User-Agent if provided
                    if (options && options.userAgent) {
                        console.log('Setting VLC User-Agent:', options.userAgent);
                        args.push(`:http-user-agent=${options.userAgent}`);
                    }

                    spawn(vlcPath, args, { detached: true, stdio: 'ignore' });
                    return { success: true, message: 'VLC opened successfully' };
                }
                
                await shell.openExternal(url);
                return { success: true, message: 'Opened with default application' };
                
            } else {
                await shell.openExternal(url);
                return { success: true, message: 'Opened with default application' };
            }
        } catch (error) {
            console.error('Failed to open external player:', error);
            return { success: false, message: error.message };
        }
    });

    // Get Player Info
    ipcMain.handle('get-player-info', async () => {
        const ffmpegStatus = getFFmpegStatus();
        return {
            vlcAvailable: !!findVlcPath(),
            mpvAvailable: !!findMpvPath(),
            ffmpegAvailable: ffmpegStatus.available,
            vlcPath: findVlcPath(),
            mpvPath: findMpvPath(),
            ffmpegPath: ffmpegStatus.path,
        };
    });

    // Embedded VLC
    ipcMain.handle('play-embedded-vlc', async (event, streamUrl) => {
        try {
            const vlcPath = findVlcPath();
            if (!vlcPath) {
                return { success: false, message: 'VLC not found' };
            }

            if (vlcProcess) {
                try { vlcProcess.kill(); } catch {}
                vlcProcess = null;
            }

            if (vlcWindow && !vlcWindow.isDestroyed()) {
                vlcWindow.close();
            }

            vlcWindow = new BrowserWindow({
                width: 800,
                height: 500,
                parent: mainWindow,
                frame: false,
                transparent: false,
                backgroundColor: '#000000',
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                },
                show: false,
            });

            const hwnd = vlcWindow.getNativeWindowHandle();
            const hwndInt = hwnd.readUInt32LE(0);
            
            vlcWindow.show();

            const vlcArgs = [
                '--intf=dummy',
                '--no-video-title-show',
                '--no-embedded-video',
                `--drawable-hwnd=${hwndInt}`,
                '--no-qt-fs-controller',
                '--no-osd',
                streamUrl
            ];
            
            vlcProcess = spawn(vlcPath, vlcArgs, {
                stdio: 'ignore',
                windowsHide: true,
            });

            vlcProcess.on('error', (err) => {
                console.error('VLC process error:', err);
            });

            vlcProcess.on('exit', (code) => {
                vlcProcess = null;
            });

            if (mainWindow) {
                const mainBounds = mainWindow.getBounds();
                vlcWindow.setBounds({
                    x: mainBounds.x + 460,
                    y: mainBounds.y + 30,
                    width: mainBounds.width - 470,
                    height: mainBounds.height - 100,
                });
            }

            return { success: true, message: 'VLC embedded started' };
        } catch (error) {
            console.error('Failed to start embedded VLC:', error);
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('stop-embedded-vlc', async () => {
        if (vlcProcess) {
            try { vlcProcess.kill(); } catch {}
            vlcProcess = null;
        }
        if (vlcWindow && !vlcWindow.isDestroyed()) {
            vlcWindow.close();
            vlcWindow = null;
        }
        return { success: true };
    });

    // FFmpeg Handlers
    ipcMain.handle('get-ffmpeg-status', async () => {
        return getFFmpegStatus();
    });

    ipcMain.handle('download-ffmpeg', async (event) => {
        try {
            const result = await downloadFFmpeg((progress) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('ffmpeg-download-progress', progress);
                }
            });
            return { success: true, path: result };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('start-ffmpeg-transcode', async (event, streamUrl, streamId = 'primary', userAgent = null) => {
        return await startFFmpegTranscode(streamUrl, streamId, userAgent);
    });

    ipcMain.handle('stop-ffmpeg-transcode', async (event, streamId = null) => {
        return await stopFFmpegTranscode(streamId);
    });
}

module.exports = { setupIpcHandlers };
