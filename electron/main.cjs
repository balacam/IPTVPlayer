const { app, BrowserWindow, ipcMain, shell } = require('electron');
const https = require('https');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const url = require('url');

// Proxy server for IPTV streams
let proxyServer = null;
const PROXY_PORT = 9876;

function startProxyServer() {
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
        
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive'
            }
        };

        const proxyReq = client.get(targetUrl, options, (proxyRes) => {
            // Forward status and headers
            res.writeHead(proxyRes.statusCode, {
                ...proxyRes.headers,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Expose-Headers': '*'
            });
            
            // Pipe the response
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (error) => {
            console.error('Proxy error:', error);
            res.writeHead(500);
            res.end('Proxy error: ' + error.message);
        });

        proxyReq.setTimeout(30000, () => {
            proxyReq.destroy();
            res.writeHead(504);
            res.end('Gateway timeout');
        });
    });

    proxyServer.listen(PROXY_PORT, '127.0.0.1', () => {
        console.log(`Proxy server running on http://127.0.0.1:${PROXY_PORT}`);
    });

    proxyServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.log(`Port ${PROXY_PORT} already in use, proxy server may already be running`);
        } else {
            console.error('Proxy server error:', error);
        }
    });
}

// IPC handler to get proxy URL
ipcMain.handle('get-proxy-url', (event, streamUrl) => {
    return `http://127.0.0.1:${PROXY_PORT}/stream?url=${encodeURIComponent(streamUrl)}`;
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

// IPC handler for opening external player
ipcMain.handle('open-external-player', async (event, url, playerType = 'vlc') => {
    try {
        console.log(`Opening ${playerType} with URL:`, url);
        
        if (playerType === 'vlc') {
            // Try different VLC paths
            const vlcPaths = [
                'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
                'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
                'vlc' // If VLC is in PATH
            ];
            
            for (const vlcPath of vlcPaths) {
                try {
                    spawn(vlcPath, [url], { detached: true, stdio: 'ignore' });
                    return { success: true, message: 'VLC opened successfully' };
                } catch (error) {
                    console.log(`Failed to open VLC at ${vlcPath}:`, error.message);
                    continue;
                }
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

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false, // Disable web security for IPTV streams
            allowRunningInsecureContent: true,
            experimentalFeatures: true
        }
    });

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

app.whenReady().then(() => {
    // Start proxy server first
    startProxyServer();
    
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
