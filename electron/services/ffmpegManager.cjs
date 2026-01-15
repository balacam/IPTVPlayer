const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn, execSync } = require('child_process');
const AdmZip = require('adm-zip');
const { getAvailablePort } = require('./utils.cjs');

// State
let ffmpegPath = null;
const activeSessions = new Map(); // Store active sessions: streamId -> { process, sessionId }
let hlsServer = null;
let HLS_PORT = 0;
let currentSessionId = 0;

const HLS_DIR = path.join(app.getPath('temp'), `iptv-hls-${process.pid}`);

// Clean HLS directory
function cleanHLSDir(exceptSessionIds = []) {
    if (!fs.existsSync(HLS_DIR)) return;

    try {
        const items = fs.readdirSync(HLS_DIR);
        for (const item of items) {
            const itemPath = path.join(HLS_DIR, item);
            
            // Check if this directory belongs to any active session
            if (exceptSessionIds.includes(item)) {
                continue;
            }

            try {
                if (fs.lstatSync(itemPath).isDirectory()) {
                    fs.rmSync(itemPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(itemPath);
                }
            } catch (e) {
                console.log(`Failed to delete ${item}:`, e.message);
            }
        }
    } catch (err) {
        console.log('Failed to clean HLS directory:', err.message);
    }
}

// Start HLS Server
async function startHLSServer() {
    HLS_PORT = await getAvailablePort(9877);
    console.log(`Using HLS port: ${HLS_PORT}`);
    
    if (!fs.existsSync(HLS_DIR)) {
        fs.mkdirSync(HLS_DIR, { recursive: true });
    }
    
    hlsServer = http.createServer((req, res) => {
        try {
            const reqPath = decodeURIComponent(req.url.split('?')[0]);
            const filePath = path.join(HLS_DIR, reqPath);
            const normalizedPath = path.normalize(filePath);
            
            if (!normalizedPath.startsWith(HLS_DIR)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Cache-Control', 'no-cache');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            
            fs.stat(normalizedPath, (err, stat) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                
                if (!stat.isFile()) {
                    res.writeHead(403);
                    res.end('Forbidden: Not a file');
                    return;
                }
                
                let contentType = 'application/octet-stream';
                if (normalizedPath.endsWith('.m3u8')) {
                    contentType = 'application/x-mpegURL';
                } else if (normalizedPath.endsWith('.ts')) {
                    contentType = 'video/MP2T';
                }
                
                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Content-Length': stat.size,
                });
                
                const stream = fs.createReadStream(normalizedPath);
                stream.on('error', (streamErr) => {
                    console.error('Stream error:', streamErr);
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end('Internal Server Error');
                    }
                });
                stream.pipe(res);
            });
        } catch (error) {
            console.error('HLS Server Error:', error);
            if (!res.headersSent) {
                res.writeHead(500);
                res.end('Internal Server Error');
            }
        }
    });
    
    hlsServer.listen(HLS_PORT, '127.0.0.1', () => {
        console.log(`HLS server running on http://127.0.0.1:${HLS_PORT}`);
    });
}

// Find or Download FFmpeg
async function findOrDownloadFFmpeg() {
    const ffmpegDir = path.join(app.getPath('userData'), 'ffmpeg');
    const ffmpegExe = path.join(ffmpegDir, 'ffmpeg.exe');
    
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
    
    try {
        execSync('where ffmpeg', { encoding: 'utf8' });
        ffmpegPath = 'ffmpeg';
        console.log('FFmpeg found in PATH');
        return 'ffmpeg';
    } catch {}
    
    console.log('FFmpeg not found, will download when needed');
    return null;
}

async function downloadFFmpeg(progressCallback) {
    const ffmpegDir = path.join(app.getPath('userData'), 'ffmpeg');
    const ffmpegExe = path.join(ffmpegDir, 'ffmpeg.exe');
    const zipPath = path.join(ffmpegDir, 'ffmpeg.zip');
    
    if (!fs.existsSync(ffmpegDir)) {
        fs.mkdirSync(ffmpegDir, { recursive: true });
    }
    
    const downloadUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
    
    console.log('Downloading FFmpeg from:', downloadUrl);
    progressCallback && progressCallback({ status: 'downloading', progress: 0 });
    
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(zipPath);
        
        const download = (url) => {
            https.get(url, (response) => {
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
                        
                        for (const entry of entries) {
                            if (entry.entryName.endsWith('ffmpeg.exe')) {
                                zip.extractEntryTo(entry, ffmpegDir, false, true);
                                break;
                            }
                        }
                        
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

// Start Transcoding
async function startFFmpegTranscode(streamUrl, streamId = 'primary', userAgent = null) {
    if (!ffmpegPath) {
        return { success: false, error: 'FFmpeg not available' };
    }
    
    currentSessionId++;
    const sessionId = currentSessionId;
    
    // Stop existing process for this streamId if any
    if (activeSessions.has(streamId)) {
        try { 
            activeSessions.get(streamId).process.kill('SIGKILL'); 
        } catch (e) {}
        activeSessions.delete(streamId);
        await new Promise(r => setTimeout(r, 200));
    }

    // Clean up old sessions that are not in activeSessions
    const activeSessionIds = Array.from(activeSessions.values()).map(s => s.sessionId.toString());
    cleanHLSDir(activeSessionIds);
    
    const sessionDir = path.join(HLS_DIR, sessionId.toString());
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    const outputPath = path.join(sessionDir, 'stream.m3u8');
    
    const finalUserAgent = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const args = [
        '-y',
        '-loglevel', 'error',
        '-fflags', '+igndts+discardcorrupt+genpts+nobuffer+flush_packets',
        '-flags', 'low_delay',
        '-analyzeduration', '5000000', 
        '-probesize', '5000000', 
        '-err_detect', 'ignore_err',
        '-user_agent', finalUserAgent,
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_on_network_error', '1',
        '-reconnect_on_http_error', '4xx,5xx',
        '-reconnect_delay_max', '10',
        '-reconnect_at_eof', '1',
        '-rw_timeout', '15000000',
        '-i', streamUrl,
        '-max_muxing_queue_size', '4096', 
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-tag:v', 'hvc1',
        '-avoid_negative_ts', 'make_zero',
        '-f', 'hls',
        '-hls_time', '3', 
        '-hls_list_size', '10', 
        '-hls_flags', 'delete_segments+omit_endlist+split_by_time',
        '-hls_segment_filename', path.join(sessionDir, 'segment%03d.ts'),
        outputPath
    ];
    
    return new Promise((resolve) => {
        const proc = spawn(ffmpegPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Store session immediately
        activeSessions.set(streamId, { process: proc, sessionId: sessionId });
        
        let started = false;
        let errorOutput = '';
        let checkInterval = null;
        let timeoutId = null;
        
        const cleanup = () => {
            if (checkInterval) clearInterval(checkInterval);
            if (timeoutId) clearTimeout(timeoutId);
        };
        
        proc.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        proc.on('error', (err) => {
            console.error(`FFmpeg error (${streamId}):`, err);
            cleanup();
            if (!started && activeSessions.get(streamId)?.sessionId === sessionId) {
                activeSessions.delete(streamId);
                resolve({ success: false, error: err.message });
            }
        });
        
        proc.on('exit', (code) => {
            cleanup();
            // If this process exit was unexpected (we still have it in map as active)
            if (activeSessions.get(streamId)?.sessionId === sessionId) {
                 activeSessions.delete(streamId);
                 if (!started) {
                     resolve({ success: false, error: 'FFmpeg exited: ' + errorOutput.slice(-500) });
                 }
            }
        });
        
        checkInterval = setInterval(() => {
            // Check if session was cancelled/replaced
            if (activeSessions.get(streamId)?.sessionId !== sessionId) {
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
                            hlsUrl: `http://127.0.0.1:${HLS_PORT}/${sessionId}/stream.m3u8`,
                            sessionId: sessionId // Return ID so client can track
                        });
                    }
                } catch (e) {}
            }
        }, 500);
        
        timeoutId = setTimeout(() => {
            if (!started && activeSessions.get(streamId)?.sessionId === sessionId) {
                cleanup();
                proc.kill('SIGKILL');
                activeSessions.delete(streamId);
                resolve({ success: false, error: 'Timeout waiting for stream' });
            }
        }, 30000);
    });
}

async function stopFFmpegTranscode(streamId = null) {
    if (streamId) {
        // Stop specific stream
        if (activeSessions.has(streamId)) {
            try { activeSessions.get(streamId).process.kill('SIGKILL'); } catch {}
            activeSessions.delete(streamId);
        }
    } else {
        // Stop all
        for (const [id, session] of activeSessions.entries()) {
            try { session.process.kill('SIGKILL'); } catch {}
        }
        activeSessions.clear();
    }
    
    // Clean directories of remaining sessions
    const activeSessionIds = Array.from(activeSessions.values()).map(s => s.sessionId.toString());
    cleanHLSDir(activeSessionIds);
    
    return { success: true };
}

function getFFmpegStatus() {
    return {
        available: !!ffmpegPath,
        path: ffmpegPath,
    };
}

module.exports = {
    startHLSServer,
    findOrDownloadFFmpeg,
    downloadFFmpeg,
    startFFmpegTranscode,
    stopFFmpegTranscode,
    getFFmpegStatus,
    cleanHLSDir
};
