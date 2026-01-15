const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
require('dotenv').config(); // Load env variables
const { startProxyServer } = require('./services/proxyServer.cjs');
const { startHLSServer, findOrDownloadFFmpeg, cleanHLSDir } = require('./services/ffmpegManager.cjs');
const { setupIpcHandlers } = require('./handlers/ipcHandlers.cjs');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#ffffff', // Set default background to white to prevent visual lag
        autoHideMenuBar: true, // Hide menu bar by default
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
            webSecurity: false, // Disable web security for IPTV streams (handled by proxy)
            allowRunningInsecureContent: true,
            experimentalFeatures: true
        }
    });
    
    // Remove default menu to make it cleaner
    mainWindow.setMenuBarVisibility(false);
    
    // Setup IPC handlers
    setupIpcHandlers(mainWindow);

    // Disable CORS completely (Extra safety, though proxy handles it too)
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        // Check for custom User-Agent header from frontend
        const customUA = details.requestHeaders['X-IPTV-User-Agent'] || details.requestHeaders['x-iptv-user-agent'];
        
        if (customUA) {
            details.requestHeaders['User-Agent'] = customUA;
            delete details.requestHeaders['X-IPTV-User-Agent'];
            delete details.requestHeaders['x-iptv-user-agent'];
        } else {
            details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        }
        
        callback({ requestHeaders: details.requestHeaders });
    });

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
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
        mainWindow.loadURL(startUrl);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(async () => {
    // Start proxy server first
    await startProxyServer();
    
    // Start HLS server for FFmpeg output
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
    cleanHLSDir();
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
