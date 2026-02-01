// Platform Service Worker - Experimental (WIP)
// Tracks known tunnel addresses and detects when accessing stale tunnels

const SW_VERSION = '1.0.0';
const DB_NAME = 'PlatformTunnelDB';
const DB_VERSION = 1;
const STORE_NAME = 'tunnels';

// =============================================================================
// IndexedDB HELPERS
// =============================================================================

function openTunnelDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'address' });
                store.createIndex('lastSeen', 'lastSeen', { unique: false });
                store.createIndex('name', 'name', { unique: false });
            }
        };
    });
}

async function storeTunnelAddress(name, address) {
    try {
        const db = await openTunnelDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        store.put({
            address: address,
            name: name,
            lastSeen: Date.now(),
            isActive: true
        });

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('[Platform SW] Failed to store tunnel:', e);
    }
}

async function getKnownTunnels() {
    try {
        const db = await openTunnelDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.warn('[Platform SW] Failed to get tunnels:', e);
        return [];
    }
}

async function markTunnelInactive(address) {
    try {
        const db = await openTunnelDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const request = store.get(address);
        request.onsuccess = () => {
            if (request.result) {
                request.result.isActive = false;
                request.result.lastFailure = Date.now();
                store.put(request.result);
            }
        };
    } catch (e) {
        console.warn('[Platform SW] Failed to mark tunnel inactive:', e);
    }
}

async function isKnownTunnel(url) {
    try {
        const urlObj = new URL(url);
        const tunnels = await getKnownTunnels();
        return tunnels.find(t => {
            try {
                return urlObj.origin === new URL(t.address).origin;
            } catch {
                return false;
            }
        });
    } catch {
        return null;
    }
}

// =============================================================================
// SERVICE WORKER LIFECYCLE
// =============================================================================

self.addEventListener('install', (event) => {
    console.log('[Platform SW] Installing version', SW_VERSION);
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[Platform SW] Activating version', SW_VERSION);
    event.waitUntil(clients.claim());
});

// =============================================================================
// FETCH INTERCEPTION
// =============================================================================

self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Only intercept tunnel requests (Cloudflare quick tunnels or local network)
    const isTunnelRequest =
        url.includes('trycloudflare.com') ||
        url.match(/192\.168\.\d+\.\d+/) ||
        url.match(/10\.\d+\.\d+\.\d+/) ||
        url.match(/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/);

    if (!isTunnelRequest) {
        return;
    }

    // Skip API, health, and hub endpoints - let them fail naturally
    const urlPath = new URL(url).pathname;
    if (urlPath.startsWith('/api/') ||
        urlPath.startsWith('/hubs/') ||
        urlPath.startsWith('/mcp/') ||
        urlPath.startsWith('/healthz') ||
        urlPath.startsWith('/health')) {
        return;
    }

    event.respondWith(
        (async () => {
            try {
                const response = await fetch(event.request);

                // Successful response - update tunnel as active
                if (response.ok) {
                    const tunnel = await isKnownTunnel(url);
                    if (tunnel) {
                        await storeTunnelAddress(tunnel.name, tunnel.address);
                    }
                }

                return response;
            } catch (error) {
                // Fetch failed - check if this is a known tunnel
                const tunnel = await isKnownTunnel(url);

                if (tunnel) {
                    console.log('[Platform SW] Known tunnel failed:', tunnel.name, tunnel.address);
                    await markTunnelInactive(tunnel.address);

                    // Return friendly offline page
                    return new Response(
                        generateOfflinePage(tunnel),
                        {
                            status: 503,
                            statusText: 'Service Unavailable',
                            headers: { 'Content-Type': 'text/html' }
                        }
                    );
                }

                // Not a known tunnel - let the error propagate
                throw error;
            }
        })()
    );
});

// =============================================================================
// MESSAGE HANDLING
// =============================================================================

self.addEventListener('message', (event) => {
    const { type, name, address } = event.data || {};

    if (type === 'REGISTER_TUNNEL' && name && address) {
        storeTunnelAddress(name, address)
            .then(() => {
                if (event.ports[0]) {
                    event.ports[0].postMessage({ success: true });
                }
            })
            .catch((error) => {
                if (event.ports[0]) {
                    event.ports[0].postMessage({ success: false, error: error.message });
                }
            });
    }

    if (type === 'GET_KNOWN_TUNNELS') {
        getKnownTunnels()
            .then((tunnels) => {
                if (event.ports[0]) {
                    event.ports[0].postMessage({ success: true, tunnels });
                }
            })
            .catch((error) => {
                if (event.ports[0]) {
                    event.ports[0].postMessage({ success: false, error: error.message });
                }
            });
    }

    if (type === 'GET_SW_VERSION') {
        if (event.ports[0]) {
            event.ports[0].postMessage({ version: SW_VERSION });
        }
    }
});

// =============================================================================
// OFFLINE PAGE GENERATOR
// =============================================================================

function generateOfflinePage(tunnel) {
    const tunnelName = tunnel?.name || 'Unknown';
    const tunnelAddress = tunnel?.address || 'Unknown address';
    const lastSeen = tunnel?.lastSeen ? new Date(tunnel.lastSeen).toLocaleString() : 'Unknown';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tunnel Unavailable - Platform</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            text-align: center;
            max-width: 500px;
            width: 100%;
        }
        .icon {
            font-size: 64px;
            margin-bottom: 20px;
        }
        h1 {
            color: #ff6b6b;
            margin-bottom: 15px;
            font-size: 28px;
        }
        p {
            color: rgba(255,255,255,0.8);
            line-height: 1.6;
            margin-bottom: 15px;
        }
        .tunnel-info {
            background: rgba(255,255,255,0.1);
            padding: 20px;
            border-radius: 12px;
            margin: 25px 0;
            text-align: left;
        }
        .tunnel-info div {
            margin-bottom: 10px;
        }
        .tunnel-info strong {
            color: rgba(255,255,255,0.6);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .tunnel-info code {
            display: block;
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
            font-size: 13px;
            color: #fff;
            word-break: break-all;
            margin-top: 4px;
        }
        .actions {
            margin-top: 30px;
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 12px 24px;
            font-size: 14px;
            font-weight: 500;
            text-decoration: none;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .btn-primary {
            background: #5865F2;
            color: #fff;
        }
        .btn-primary:hover {
            background: #4752c4;
        }
        .btn-secondary {
            background: rgba(255,255,255,0.1);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.2);
        }
        .btn-secondary:hover {
            background: rgba(255,255,255,0.15);
        }
        .hint {
            margin-top: 30px;
            font-size: 13px;
            color: rgba(255,255,255,0.5);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">&#x1F50C;</div>
        <h1>Tunnel Unavailable</h1>
        <p>The tunnel address you're trying to access appears to be outdated or temporarily unavailable.</p>

        <div class="tunnel-info">
            <div>
                <strong>Tunnel Name</strong>
                <code>${tunnelName}</code>
            </div>
            <div>
                <strong>Address</strong>
                <code>${tunnelAddress}</code>
            </div>
            <div>
                <strong>Last Seen Working</strong>
                <code>${lastSeen}</code>
            </div>
        </div>

        <p>This usually happens when the Cloudflare tunnel has been refreshed with a new address. Use the Gateway to get the current tunnel URL.</p>

        <div class="actions">
            <a href="./gateway.html" class="btn btn-primary">Go to Gateway</a>
            <button onclick="location.reload()" class="btn btn-secondary">Retry</button>
        </div>

        <p class="hint">Tip: Use the Portal page instead of direct tunnel URLs for automatic reconnection.</p>
    </div>
</body>
</html>`;
}
