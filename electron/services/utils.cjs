const net = require('net');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { app } = require('electron');

function getAvailablePort(startPort) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(startPort, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', () => {
            getAvailablePort(startPort + 1).then(resolve);
        });
    });
}

function findVlcPath() {
    const vlcPaths = [
        'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
        'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
    ];
    
    for (const p of vlcPaths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function findMpvPath() {
    const mpvPaths = [
        'C:\\Program Files\\mpv\\mpv.exe',
        'C:\\Program Files (x86)\\mpv\\mpv.exe',
        path.join(app.getPath('userData'), 'mpv', 'mpv.exe'),
    ];
    
    for (const p of mpvPaths) {
        if (fs.existsSync(p)) return p;
    }
    
    try {
        execSync('where mpv', { encoding: 'utf8' });
        return 'mpv';
    } catch {
        return null;
    }
}

module.exports = { getAvailablePort, findVlcPath, findMpvPath };
