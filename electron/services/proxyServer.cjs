const http = require('http');
const https = require('https');
const url = require('url');
const { getAvailablePort } = require('./utils.cjs');

let proxyServer = null;
let PROXY_PORT = 0;

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

function getProxyUrl(streamUrl) {
    return `http://127.0.0.1:${PROXY_PORT}/stream?url=${encodeURIComponent(streamUrl)}`;
}

module.exports = { startProxyServer, getProxyUrl };
