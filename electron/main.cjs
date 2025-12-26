const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const url = require('url');
const AdmZip = require('adm-zip');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

// Embedded player process
let embeddedPlayerProcess = null;
let mainWindow = null;

// FFmpeg transcoding
let ffmpegPath = null;
let ffmpegProcess = null;
let hlsServer = null;
let HLS_PORT = 0;
const HLS_DIR = path.join(app.getPath('temp'), `iptv-hls-${process.pid}`);

// Proxy server for IPTV streams
let proxyServer = null;
let PROXY_PORT = 0;

// Find available port dynamically
function getAvailablePort(startPort) {
    return new Promise((resolve) => {
        const server = require('net').createServer();
        server.listen(startPort, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', () => {
            getAvailablePort(startPort + 1).then(resolve);
        });
    });
}

async function startProxyServer() {
    PROXY_PORT = await getAvailablePort(9876);
    console.log(`Using proxy port: ${PROXY_PORT}`);
    
    proxyServer = http.createServer((req, res) => {
        // Get the target URL from query parameter
        const parsedUrl = url.parse(req.url, true);
        const targetUrl = parsedUrl.query.url;
        
        if (!targetUrl) {
            res.writeHead(400);
            res.end('Missing url parameter');
            return;
        }

        console.log('Proxying stream:', targetUrl);

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Determine http or https
        const client = targetUrl.startsWith('https:') ? https : http;
        
        // Parse target URL for request options
        const targetParsed = new URL(targetUrl);
        
        const options = {
            hostname: targetParsed.hostname,
            port: targetParsed.port || (targetUrl.startsWith('https:') ? 443 : 80),
            path: targetParsed.pathname + targetParsed.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive'
            }
        };

        // Forward Range header for video seeking support
        if (req.headers.range) {
            options.headers['Range'] = req.headers.range;
            console.log('Range request:', req.headers.range);
        }

        const proxyReq = client.request(options, (proxyRes) => {
            // Build response headers
            const responseHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Expose-Headers': '*',
                'Accept-Ranges': 'bytes'
            };
            
            // Forward important headers
            if (proxyRes.headers['content-type']) {
                responseHeaders['Content-Type'] = proxyRes.headers['content-type'];
            }
            if (proxyRes.headers['content-length']) {
                responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
            }
            if (proxyRes.headers['content-range']) {
                responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
            }
            
            // Forward status and headers
            res.writeHead(proxyRes.statusCode, responseHeaders);
            
            // Pipe the response
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (error) => {
            console.error('Proxy error:', error);
            if (!res.headersSent) {
                res.writeHead(500);
                res.end('Proxy error: ' + error.message);
            }
        });

        proxyReq.setTimeout(60000, () => {
            proxyReq.destroy();
            if (!res.headersSent) {
                res.writeHead(504);
                res.end('Gateway timeout');
            }
        });
        
        proxyReq.end();
    });

    proxyServer.listen(PROXY_PORT, '127.0.0.1', () => {
        console.log(`Proxy server running on http://127.0.0.1:${PROXY_PORT}`);
    });

    proxyServer.on('error', (error) => {
        console.error('Proxy server error:', error);
    });
}

// IPC handler to get proxy URL
ipcMain.handle('get-proxy-url', (event, streamUrl) => {
    return `http://127.0.0.1:${PROXY_PORT}/stream?url=${encodeURIComponent(streamUrl)}`;
});

// IPC handler for deleting a channel from M3U file
ipcMain.handle('delete-channel-from-file', async (event, filePath, channelName, channelUrl) => {
    try {
        console.log('Deleting channel from file:', filePath);
        console.log('Channel name:', channelName);
        console.log('Channel URL:', channelUrl);

        if (!fs.existsSync(filePath)) {
            return { success: false, error: 'File not found' };
        }

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        const newLines = [];
        let skipNext = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (skipNext) {
                // This is the URL line after #EXTINF, skip it
                skipNext = false;
                continue;
            }

            // Check if this is the #EXTINF line for the channel we want to delete
            if (line.startsWith('#EXTINF')) {
                // Check if next line matches the URL
                const nextLine = lines[i + 1] || '';
                if (nextLine.trim() === channelUrl.trim()) {
                    // Found the channel to delete, skip this line and the next
                    skipNext = true;
                    continue;
                }
            }

            newLines.push(line);
        }

        // Write back to file
        fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
        console.log('Channel deleted successfully');

        return { success: true };
    } catch (error) {
        console.error('Failed to delete channel:', error);
        return { success: false, error: error.message };
    }
});

// IPC handler for fetching content (bypasses CORS)
ipcMain.handle('fetch-content', async (event, url) => {
    return new Promise((resolve, reject) => {
        console.log('Fetching content from:', url);
        
        const client = url.startsWith('https:') ? https : http;
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache'
            }
        };

        const req = client.get(url, options, (res) => {
            let data = '';
            
            console.log('Response status:', res.statusCode);
            console.log('Response headers:', res.headers);
            
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log('Received data length:', data.length);
                resolve(data);
            });
        });

        req.on('error', (error) => {
            console.error('Request error:', error);
            reject(error);
        });

        req.setTimeout(15000, () => {
            console.log('Request timeout for:', url);
            req.destroy();
            reject(new Error('Request timeout after 15 seconds'));
        });
    });
});

// Find VLC path
function findVlcPath() {
    const vlcPaths = [
        'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
        'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
    ];
    
    const fs = require('fs');
    for (const p of vlcPaths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// Find MPV path
function findMpvPath() {
    const mpvPaths = [
        'C:\\Program Files\\mpv\\mpv.exe',
        'C:\\Program Files (x86)\\mpv\\mpv.exe',
        path.join(app.getPath('userData'), 'mpv', 'mpv.exe'),
    ];
    
    const fs = require('fs');
    for (const p of mpvPaths) {
        if (fs.existsSync(p)) return p;
    }
    
    // Try to find in PATH
    try {
        execSync('where mpv', { encoding: 'utf8' });
        return 'mpv';
    } catch {
        return null;
    }
}

// IPC handler for opening external player
ipcMain.handle('open-external-player', async (event, url, playerType = 'vlc') => {
    try {
        console.log(`Opening ${playerType} with URL:`, url);
        
        if (playerType === 'vlc') {
            const vlcPath = findVlcPath();
            if (vlcPath) {
                spawn(vlcPath, [url], { detached: true, stdio: 'ignore' });
                return { success: true, message: 'VLC opened successfully' };
            }
            
            // If VLC not found, try to open with default app
            await shell.openExternal(url);
            return { success: true, message: 'Opened with default application' };
            
        } else {
            // Default browser/app
            await shell.openExternal(url);
            return { success: true, message: 'Opened with default application' };
        }
    } catch (error) {
        console.error('Failed to open external player:', error);
        return { success: false, message: error.message };
    }
});

// IPC handler for embedded VLC player in a child window
let vlcWindow = null;
let vlcProcess = null;

ipcMain.handle('play-embedded-vlc', async (event, streamUrl) => {
    try {
        const vlcPath = findVlcPath();
        if (!vlcPath) {
            return { success: false, message: 'VLC not found' };
        }

        // Kill existing VLC process
        if (vlcProcess) {
            try { vlcProcess.kill(); } catch {}
            vlcProcess = null;
        }

        // Close existing VLC window
        if (vlcWindow && !vlcWindow.isDestroyed()) {
            vlcWindow.close();
        }

        // Create a new borderless window for VLC
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

        // Get the native window handle
        const hwnd = vlcWindow.getNativeWindowHandle();
        // Convert buffer to hex string for VLC
        const hwndInt = hwnd.readUInt32LE(0);
        
        console.log('VLC Window HWND:', hwndInt);

        // Show window first
        vlcWindow.show();

        // Start VLC with embedded output
        // VLC args: --drawable-hwnd=<hwnd> embeds video into that window
        const vlcArgs = [
            '--intf=dummy',           // No VLC interface
            '--no-video-title-show',  // No title overlay
            '--no-embedded-video',
            `--drawable-hwnd=${hwndInt}`,
            '--no-qt-fs-controller',
            '--no-osd',
            streamUrl
        ];

        console.log('Starting VLC with args:', vlcArgs);
        
        vlcProcess = spawn(vlcPath, vlcArgs, {
            stdio: 'ignore',
            windowsHide: true,
        });

        vlcProcess.on('error', (err) => {
            console.error('VLC process error:', err);
        });

        vlcProcess.on('exit', (code) => {
            console.log('VLC process exited with code:', code);
            vlcProcess = null;
        });

        // Position VLC window
        if (mainWindow) {
            const mainBounds = mainWindow.getBounds();
            vlcWindow.setBounds({
                x: mainBounds.x + 460,  // After channel list
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

ipcMain.handle('get-player-info', async () => {
    return {
        vlcAvailable: !!findVlcPath(),
        mpvAvailable: !!findMpvPath(),
        ffmpegAvailable: !!ffmpegPath,
        vlcPath: findVlcPath(),
        mpvPath: findMpvPath(),
        ffmpegPath: ffmpegPath,
    };
});

// ============ FFmpeg Transcoding Support ============

// Find or download FFmpeg
async function findOrDownloadFFmpeg() {
    const ffmpegDir = path.join(app.getPath('userData'), 'ffmpeg');
    const ffmpegExe = path.join(ffmpegDir, 'ffmpeg.exe');
    
    // Check common paths first
    const commonPaths = [
        ffmpegExe,
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        path.join(process.resourcesPath || '', 'ffmpeg.exe'),
    ];
    
    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            console.log('FFmpeg found at:', p);
            ffmpegPath = p;
            return p;
        }
    }
    
    // Try PATH
    try {
        execSync('where ffmpeg', { encoding: 'utf8' });
        ffmpegPath = 'ffmpeg';
        console.log('FFmpeg found in PATH');
        return 'ffmpeg';
    } catch {}
    
    console.log('FFmpeg not found, will download when needed');
    return null;
}

// Download FFmpeg
async function downloadFFmpeg(progressCallback) {
    const ffmpegDir = path.join(app.getPath('userData'), 'ffmpeg');
    const ffmpegExe = path.join(ffmpegDir, 'ffmpeg.exe');
    const zipPath = path.join(ffmpegDir, 'ffmpeg.zip');
    
    // Create directory
    if (!fs.existsSync(ffmpegDir)) {
        fs.mkdirSync(ffmpegDir, { recursive: true });
    }
    
    // Download URL (using gyan.dev builds - reliable Windows builds)
    const downloadUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
    
    console.log('Downloading FFmpeg from:', downloadUrl);
    progressCallback && progressCallback({ status: 'downloading', progress: 0 });
    
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(zipPath);
        
        const download = (url) => {
            https.get(url, (response) => {
                // Handle redirects
                if (response.statusCode === 302 || response.statusCode === 301) {
                    download(response.headers.location);
                    return;
                }
                
                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;
                
                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    const progress = Math.round((downloadedSize / totalSize) * 100);
                    progressCallback && progressCallback({ status: 'downloading', progress });
                });
                
                response.pipe(file);
                
                file.on('finish', () => {
                    file.close();
                    progressCallback && progressCallback({ status: 'extracting', progress: 100 });
                    
                    try {
                        console.log('Extracting FFmpeg...');
                        const zip = new AdmZip(zipPath);
                        const entries = zip.getEntries();
                        
                        // Find ffmpeg.exe in the zip
                        for (const entry of entries) {
                            if (entry.entryName.endsWith('ffmpeg.exe')) {
                                zip.extractEntryTo(entry, ffmpegDir, false, true);
                                break;
                            }
                        }
                        
                        // Clean up zip
                        fs.unlinkSync(zipPath);
                        
                        if (fs.existsSync(ffmpegExe)) {
                            ffmpegPath = ffmpegExe;
                            console.log('FFmpeg installed at:', ffmpegExe);
                            progressCallback && progressCallback({ status: 'complete', progress: 100 });
                            resolve(ffmpegExe);
                        } else {
                            reject(new Error('FFmpeg extraction failed'));
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            }).on('error', (err) => {
                fs.unlink(zipPath, () => {});
                reject(err);
            });
        };
        
        download(downloadUrl);
    });
}

// IPC handler for FFmpeg status
ipcMain.handle('get-ffmpeg-status', async () => {
    return {
        available: !!ffmpegPath,
        path: ffmpegPath,
    };
});

// IPC handler to download FFmpeg
ipcMain.handle('download-ffmpeg', async (event) => {
    try {
        const result = await downloadFFmpeg((progress) => {
            mainWindow && mainWindow.webContents.send('ffmpeg-download-progress', progress);
        });
        return { success: true, path: result };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Start HLS server for serving transcoded content
async function startHLSServer() {
    HLS_PORT = await getAvailablePort(9877);
    console.log(`Using HLS port: ${HLS_PORT}`);
    
    // Create HLS directory
    if (!fs.existsSync(HLS_DIR)) {
        fs.mkdirSync(HLS_DIR, { recursive: true });
    }
    
    hlsServer = http.createServer((req, res) => {
        const reqPath = req.url.split('?')[0];
        const filePath = path.join(HLS_DIR, reqPath);
        
        // Security check
        if (!filePath.startsWith(HLS_DIR)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Cache-Control', 'no-cache');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        fs.stat(filePath, (err, stat) => {
            if (err) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }
            
            // Set content type
            let contentType = 'application/octet-stream';
            if (filePath.endsWith('.m3u8')) {
                contentType = 'application/x-mpegURL';
            } else if (filePath.endsWith('.ts')) {
                contentType = 'video/MP2T';
            }
            
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': stat.size,
            });
            
            fs.createReadStream(filePath).pipe(res);
        });
    });
    
    hlsServer.listen(HLS_PORT, '127.0.0.1', () => {
        console.log(`HLS server running on http://127.0.0.1:${HLS_PORT}`);
    });
}

// Clean HLS directory
function cleanHLSDir() {
    if (fs.existsSync(HLS_DIR)) {
        const files = fs.readdirSync(HLS_DIR);
        for (const file of files) {
            fs.unlinkSync(path.join(HLS_DIR, file));
        }
    }
}

// Unique session ID to prevent old stream conflicts
let currentSessionId = 0;

// Start FFmpeg transcoding
ipcMain.handle('start-ffmpeg-transcode', async (event, streamUrl) => {
    if (!ffmpegPath) {
        return { success: false, error: 'FFmpeg not available' };
    }
    
    // Increment session ID to invalidate old streams
    currentSessionId++;
    const sessionId = currentSessionId;
    
    // Stop existing process first
    if (ffmpegProcess) {
        console.log('Killing existing FFmpeg process...');
        try { 
            ffmpegProcess.kill('SIGKILL'); 
        } catch (e) {
            console.log('Kill error:', e);
        }
        ffmpegProcess = null;
        // Wait a bit for process to fully terminate
        await new Promise(r => setTimeout(r, 500));
    }
    
    // Clean old files thoroughly
    cleanHLSDir();
    await new Promise(r => setTimeout(r, 200));
    
    // Check if session is still valid
    if (sessionId !== currentSessionId) {
        return { success: false, error: 'Session cancelled' };
    }
    
    const outputPath = path.join(HLS_DIR, 'stream.m3u8');
    
    // Live streams only - VOD files are handled by VLC in Player.jsx
    console.log('Stream URL for FFmpeg:', streamUrl);
    
    // FFmpeg arguments for live streams
    const args = [
        '-y',
        '-loglevel', 'warning',
        '-fflags', '+igndts+discardcorrupt+genpts',
        '-analyzeduration', '20000000', // Increased to 20MB
        '-probesize', '20000000',      // Increased to 20MB
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_on_network_error', '1',
        '-reconnect_on_http_error', '4xx,5xx',
        '-reconnect_delay_max', '10',
        '-reconnect_at_eof', '1',
        '-rw_timeout', '20000000', // 20s network timeout
        '-i', streamUrl,
        '-max_muxing_queue_size', '9999', // Output option: Prevent buffer overflows
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ac', '2',
        '-f', 'hls',
        '-hls_time', '6',         // 6s segments for stability
        '-hls_list_size', '10',   // Keep 10 segments in list
        '-hls_flags', 'delete_segments+omit_endlist', // Auto-delete old segments to prevent disk fill
        '-hls_segment_filename', path.join(HLS_DIR, 'segment%03d.ts'),
        outputPath
    ];
    
    console.log('Starting FFmpeg:', ffmpegPath);
    console.log('Stream URL:', streamUrl);
    console.log('Session ID:', sessionId);
    
    return new Promise((resolve) => {
        ffmpegProcess = spawn(ffmpegPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        
        let started = false;
        let errorOutput = '';
        let checkInterval = null;
        let timeoutId = null;
        
        const cleanup = () => {
            if (checkInterval) clearInterval(checkInterval);
            if (timeoutId) clearTimeout(timeoutId);
        };
        
        ffmpegProcess.stderr.on('data', (data) => {
            const msg = data.toString();
            errorOutput += msg;
            console.log('FFmpeg:', msg);
        });
        
        ffmpegProcess.on('error', (err) => {
            console.error('FFmpeg error:', err);
            cleanup();
            if (!started && sessionId === currentSessionId) {
                resolve({ success: false, error: err.message });
            }
        });
        
        ffmpegProcess.on('exit', (code) => {
            console.log('FFmpeg exited with code:', code);
            cleanup();
            const wasOurProcess = ffmpegProcess !== null;
            ffmpegProcess = null;
            if (!started && wasOurProcess && sessionId === currentSessionId) {
                resolve({ success: false, error: 'FFmpeg exited: ' + errorOutput.slice(-500) });
            }
        });
        
        // Wait for m3u8 file to be created
        checkInterval = setInterval(() => {
            // Check if session is still valid
            if (sessionId !== currentSessionId) {
                cleanup();
                resolve({ success: false, error: 'Session cancelled' });
                return;
            }
            
            if (fs.existsSync(outputPath)) {
                try {
                    const stat = fs.statSync(outputPath);
                    if (stat.size > 0) {
                        cleanup();
                        started = true;
                        resolve({
                            success: true,
                            hlsUrl: `http://127.0.0.1:${HLS_PORT}/stream.m3u8?session=${sessionId}`,
                        });
                    }
                } catch (e) {
                    // File might be locked, try again
                }
            }
        }, 500);
        
        // Timeout after 30 seconds
        timeoutId = setTimeout(() => {
            if (!started && sessionId === currentSessionId) {
                cleanup();
                if (ffmpegProcess) {
                    ffmpegProcess.kill('SIGKILL');
                    ffmpegProcess = null;
                }
                resolve({ success: false, error: 'Timeout waiting for stream' });
            }
        }, 30000);
    });
});

// Stop FFmpeg transcoding
ipcMain.handle('stop-ffmpeg-transcode', async () => {
    if (ffmpegProcess) {
        try { ffmpegProcess.kill('SIGKILL'); } catch {}
        ffmpegProcess = null;
    }
    cleanHLSDir();
    return { success: true };
});

// IPC handler for recognizing channel from video
ipcMain.handle('recognize-channel', async (event, streamUrl) => {
    if (!ffmpegPath) {
        return { success: false, error: 'FFmpeg not available' };
    }

    const tempDir = app.getPath('temp');
    const snapshotPath = path.join(tempDir, `snapshot-${Date.now()}.jpg`);

    try {
        console.log('Taking snapshot from:', streamUrl);
        
        // Take snapshot using FFmpeg
        await new Promise((resolve, reject) => {
            const args = [
                '-y',
                '-i', streamUrl,
                '-ss', '00:00:01',
                '-vframes', '1',
                '-q:v', '2',
                snapshotPath
            ];

            const ffmpeg = spawn(ffmpegPath, args);
            
            ffmpeg.on('close', (code) => {
                if (code === 0 && fs.existsSync(snapshotPath)) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });
            
            ffmpeg.on('error', (err) => reject(err));
            
            // Timeout after 15 seconds
            setTimeout(() => {
                try { ffmpeg.kill(); } catch {}
                reject(new Error('Snapshot timeout'));
            }, 15000);
        });

        console.log('Snapshot taken, analyzing text...');

        // Lazy load Tesseract.js using require
        const { createWorker } = require('tesseract.js');
        
        // Initialize Tesseract worker
        const worker = await createWorker('eng');
        
        // Recognize text
        const ret = await worker.recognize(snapshotPath);
        console.log('OCR Result:', ret.data.text);
        
        await worker.terminate();
        
        // Clean up snapshot
        try { fs.unlinkSync(snapshotPath); } catch {}

        return { 
            success: true, 
            text: ret.data.text,
            confidence: ret.data.confidence
        };

    } catch (error) {
        console.error('Recognition failed:', error);
        // Clean up if exists
        try { if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath); } catch {}
        
        return { success: false, error: error.message };
    }
});

function createWindow() {
    // Create basic menu for Copy/Paste support
    const template = [
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
                { type: 'separator' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#ffffff', // Set default background to white to prevent visual lag
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false, // Disable web security for IPTV streams
            allowRunningInsecureContent: true,
            experimentalFeatures: true
        }
    });
    
    const win = mainWindow;

    // Disable CORS completely
    win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        callback({ requestHeaders: details.requestHeaders });
    });

    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Access-Control-Allow-Origin': ['*'],
                'Access-Control-Allow-Methods': ['GET, POST, PUT, DELETE, OPTIONS'],
                'Access-Control-Allow-Headers': ['*'],
            }
        });
    });

    // In dev, load from localhost. In prod, load index.html
    const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../dist/index.html')}`;

    if (process.env.ELECTRON_START_URL) {
        win.loadURL(startUrl);
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(async () => {
    // Start proxy server first (with dynamic port)
    await startProxyServer();
    
    // Start HLS server for FFmpeg output (with dynamic port)
    await startHLSServer();
    
    // Check for FFmpeg
    await findOrDownloadFFmpeg();
    
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // Clean up FFmpeg process
    if (ffmpegProcess) {
        try { ffmpegProcess.kill('SIGKILL'); } catch {}
    }
    cleanHLSDir();
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
