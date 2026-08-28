// CONFIG is declared in gateway-shared.js which is loaded first

// ---------------------------------------------------------------------------
// Sign-in loop-breaker (defense-in-depth; mitigates the F4 gateway/portal loop)
// ---------------------------------------------------------------------------
// The portal redirects the WHOLE page to gateway.html whenever the embedded
// platform iframe navigates there (the backend bounced an unauthenticated
// request to sign-in). If the platform session cookie cannot persist in this
// cross-origin iframe (third-party-cookie blocking / SameSite), that bounce can
// repeat forever: gateway -> OAuth -> portal -> iframe signin -> cookie lost ->
// iframe gateway.html -> portal redirects to gateway.html -> ...
//
// This guard caps the bounce RATE. If MAX_GATEWAY_BOUNCES whole-page redirects to
// gateway.html occur within GATEWAY_BOUNCE_WINDOW_MS, we STOP auto-redirecting and
// show a terminal error instead of reloading -- so a cookie failure degrades to a
// visible error, never an infinite reload. The counter lives in SESSIONSTORAGE so
// it is per-tab/session, survives the navigations within one loop, and is cleared
// on a successful auth (authenticated platform content posts a non-gateway URL).
// Happy-path single redirects (bounces under threshold) are unaffected.
const SIGNIN_BOUNCE_KEY = 'bb_portal_gateway_bounce';
const MAX_GATEWAY_BOUNCES = 3;            // trip on the 3rd gateway.html redirect
const GATEWAY_BOUNCE_WINDOW_MS = 20000;   // ...within 20 seconds
let signInLoopBroken = false;             // once tripped, suppress further redirects on this page

function clearGatewayBounceCounter() {
  signInLoopBroken = false;
  try { sessionStorage.removeItem(SIGNIN_BOUNCE_KEY); } catch (e) {}
}

// Redirect the whole page to gateway.html, but stop and show a terminal error if
// we are bouncing too fast. Returns true if it tripped the breaker (no redirect).
function redirectToGatewayWithLoopGuard(gatewaySearch) {
  if (signInLoopBroken) {
    // Already tripped on this page load -- do nothing further.
    return true;
  }

  const now = Date.now();
  let count = 0;
  let windowStart = now;
  try {
    const raw = sessionStorage.getItem(SIGNIN_BOUNCE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.windowStart === 'number' &&
          (now - parsed.windowStart) <= GATEWAY_BOUNCE_WINDOW_MS) {
        count = parsed.count || 0;
        windowStart = parsed.windowStart;
      }
    }
  } catch (e) { /* corrupt/unavailable -> treat as a fresh window */ }

  count += 1;

  if (count >= MAX_GATEWAY_BOUNCES) {
    console.warn('[Portal] Sign-in bounce threshold reached (' + count + ' gateway.html redirects within ' +
      GATEWAY_BOUNCE_WINDOW_MS + 'ms) -- stopping auto-redirect to break the loop.');
    signInLoopBroken = true;
    showSignInLoopError();
    return true;
  }

  try {
    sessionStorage.setItem(SIGNIN_BOUNCE_KEY, JSON.stringify({ count: count, windowStart: windowStart }));
  } catch (e) {}

  console.log('[Portal] Redirecting whole page to gateway.html (bounce ' + count + '/' + MAX_GATEWAY_BOUNCES + ')');
  window.location.href = './gateway.html' + (gatewaySearch || '');
  return false;
}

// Best-effort resolution of the platform tunnel URL for the "open directly" action.
function resolvePortalTunnelUrl() {
  try {
    const fromParam = new URLSearchParams(window.location.search).get('tunnelUrl');
    if (fromParam) return fromParam.replace(/\/$/, '');
  } catch (e) {}
  try {
    if (window.CONFIG && window.CONFIG.cloudflareTunnels) {
      const tunnel = window.CONFIG.cloudflareTunnels.find(function (t) { return t.name === 'cloud'; });
      if (tunnel && tunnel.address) return tunnel.address.replace(/\/$/, '');
    }
  } catch (e) {}
  return null;
}

// Terminal state shown when the bounce breaker trips. Built via DOM APIs (no inline
// handlers) and idempotent.
function showSignInLoopError() {
  if (document.getElementById('signInLoopError')) return;
  const tunnelUrl = resolvePortalTunnelUrl();

  const overlay = document.createElement('div');
  overlay.id = 'signInLoopError';
  overlay.setAttribute('style', 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0f1117;z-index:2147483647;padding:24px;');

  const card = document.createElement('div');
  card.setAttribute('style', 'max-width:520px;text-align:center;color:#e6e6e6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;');

  const h1 = document.createElement('h1');
  h1.textContent = "Sign-in couldn't complete";
  h1.setAttribute('style', 'font-size:22px;margin:0 0 12px;');

  const p1 = document.createElement('p');
  p1.textContent = 'We kept getting sent back to the sign-in page. This usually means your browser is blocking third-party cookies for the embedded platform.';
  p1.setAttribute('style', 'font-size:15px;line-height:1.5;color:rgba(255,255,255,0.75);margin:0 0 8px;');

  const p2 = document.createElement('p');
  p2.textContent = 'Open the platform directly in its own tab, or allow third-party cookies for this site and retry.';
  p2.setAttribute('style', 'font-size:13px;line-height:1.5;color:rgba(255,255,255,0.55);margin:0 0 20px;');

  const actions = document.createElement('div');

  if (tunnelUrl) {
    const openLink = document.createElement('a');
    openLink.textContent = 'Open the platform directly';
    openLink.href = tunnelUrl;
    openLink.setAttribute('style', 'display:inline-block;margin:8px;padding:10px 20px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border-radius:8px;text-decoration:none;font-weight:600;');
    actions.appendChild(openLink);
  }

  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'Retry sign-in';
  retryBtn.setAttribute('style', 'display:inline-block;margin:8px;padding:10px 20px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:8px;font-weight:600;cursor:pointer;');
  retryBtn.addEventListener('click', function () {
    clearGatewayBounceCounter();
    window.location.href = './gateway.html';
  });
  actions.appendChild(retryBtn);

  card.appendChild(h1);
  card.appendChild(p1);
  card.appendChild(p2);
  card.appendChild(actions);
  overlay.appendChild(card);

  try {
    (document.body || document.documentElement).appendChild(overlay);
  } catch (e) {
    console.error('[Portal] Failed to render sign-in loop error overlay:', e);
  }
}

// Get tunnel for environment
function getTunnelForEnvironment(envName) {
  // Map environment names to tunnel names
  const tunnelNameMap = {
    'develop': 'cloud',           // Keep "cloud" for develop to maintain existing naming
    'staging': 'staging-cloud',
    'test': 'test-cloud',
    'production': 'cloud'
  };
  
  const tunnelName = tunnelNameMap[envName] || 'cloud';
  let tunnel = CONFIG.cloudflareTunnels?.find(t => t.name === tunnelName);
  
  // Fallback: if production-cloud not found, try "cloud" for backward compatibility
  if (!tunnel && envName === 'production') {
    tunnel = CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
  }
  
  return tunnel;
}

// Get preferred environment from localStorage, default to production
function getPreferredEnvironment() {
  try {
    const preferred = localStorage.getItem('preferredEnvironment');
    if (preferred && ['develop', 'staging', 'test', 'production'].includes(preferred)) {
      return preferred;
    }
  } catch (e) {
    console.warn('Failed to get preferred environment:', e);
  }
  return 'production';
}

// Get tunnel for preferred environment
function getTunnelForPreferredEnvironment() {
  const preferredEnv = getPreferredEnvironment();
  return getTunnelForEnvironment(preferredEnv);
}

// Load configuration from config.json
async function loadConfig() {
  try {
    const response = await fetch('./config.json?t=' + Date.now());
    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.status} ${response.statusText}`);
    }
    CONFIG = await response.json();
    console.log('Configuration loaded:', CONFIG);
    return true;
  } catch (error) {
    console.error('Error loading configuration:', error);
    showError('Failed to load configuration', error.message);
    return false;
  }
}

// Independent GitHub-Actions-verified health signal. Used ONLY to anchor the offline-detection
// UI's "last confirmed online" timeline -- NOT for the 30-second direct tunnel poll in
// checkTunnelHealth(), which keeps polling the tunnel directly and is unaffected by this.
//
// UPDATED 2026-07-08: this used to read a static health-status.json committed by the (now
// retired) "Health Check (Portal)" workflow. That workflow is gone, so this now reads LIVE
// straight from the standalone battle-buddy-games/Status repo's own health-check.yml run
// history via the public, anonymous GitHub Actions API (the same API and workflow that repo's
// own portal.html renders at https://battle-buddy-games.github.io/Status/portal.html) -- no
// committed intermediate file, no staleness. `lastOnlineAt` is the completion time of the most
// recent run whose conclusion was "success"; `healthy` reflects the most recent completed run
// regardless of conclusion. Anonymous GitHub API requests are rate-limited to 60/hr per source
// IP; a rate-limited or failed fetch simply returns false and leaves HEALTH_STATUS null -- the
// showConnectionFailure() anchor logic below was already designed to tolerate this source being
// briefly unavailable and falls through to its localStorage/current-time fallbacks.
const HEALTH_STATUS_API_URL =
  'https://api.github.com/repos/battle-buddy-games/Status/actions/workflows/health-check.yml/runs?per_page=20';
let HEALTH_STATUS = null;

async function loadHealthStatus() {
  try {
    const response = await fetch(HEALTH_STATUS_API_URL, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) {
      console.warn('[Portal] Status repo Actions API not available:', response.status);
      return false;
    }
    const data = await response.json();
    const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
    const completedRuns = runs.filter((r) => r.status === 'completed');
    const latestCompleted = completedRuns[0] || null;
    const latestSuccess = completedRuns.find((r) => r.conclusion === 'success') || null;

    if (!latestCompleted) {
      console.warn('[Portal] Status repo has no completed health-check runs yet');
      return false;
    }

    HEALTH_STATUS = {
      healthy: latestCompleted.conclusion === 'success',
      lastOnlineAt: latestSuccess ? latestSuccess.updated_at : null,
      lastCheckedAt: latestCompleted.updated_at,
      checkedUrl: 'https://battle-buddy-games.github.io/Status/portal.html'
    };
    return true;
  } catch (error) {
    console.warn('[Portal] Failed to load health status from Status repo Actions API:', error);
    return false;
  }
}

function showError(title, message) {
  const overlay = document.getElementById('loadingOverlay');
  overlay.innerHTML = `
    <div class="error-message">
      <h1>${title}</h1>
      <p>${message}</p>
      <p>Please ensure <code>config.json</code> exists and contains a valid tunnel configuration.</p>
      <button class="retry-button" onclick="location.reload()">Retry</button>
    </div>
  `;
}

let tunnelBaseUrl = '';
let currentIframePath = '/';
let isIframeCrossOrigin = false; // Track if iframe is cross-origin to avoid repeated access attempts
let isUpdatingUrl = false; // Flag to prevent update loops
let lastUrlUpdateTime = 0; // Track last URL update time for debouncing
let lastPostMessagePath = null; // Track last path from postMessage to prioritize it over src-attribute
let lastPostMessageTime = 0; // Track when last postMessage was received
let hasReceivedPostMessage = false; // Track if we've ever received a postMessage (indicates SPA with client-side routing)
const URL_UPDATE_DEBOUNCE_MS = 300; // Minimum time between URL updates
const POSTMESSAGE_PRIORITY_MS = 2000; // PostMessage updates take priority for 2 seconds

// Track iframe load state
let iframeLoadCompleted = false;

// Loading timeout system - auto-retry and error display
let loadingTimeoutHandle = null;
let loadingRetryCount = 0;
const LOADING_TIMEOUT_MS = 10000; // 10 seconds before auto-retry
const LOADING_MAX_RETRIES = 1; // Retry once, then show error

// Periodic health check system (like gateway.js)
let healthCheckInterval = null;
let lastHealthyTunnelAddress = '';
const HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds

// Helper function to update parent URL with iframe path
function updateParentUrl(iframePath, usePushState = false) {
  // Prevent update loops
  if (isUpdatingUrl) {
    return;
  }
  
  // Debounce URL updates to prevent flickering
  const now = Date.now();
  if (usePushState && (now - lastUrlUpdateTime) < URL_UPDATE_DEBOUNCE_MS) {
    return;
  }
  
  const newUrl = new URL(window.location.href);
  const currentSubpage = newUrl.searchParams.get('subpage') || '/';
  
  // Only update if the path actually changed
  if (iframePath === currentSubpage) {
    return;
  }
  
  isUpdatingUrl = true;
  
  // Update subpage query parameter with the iframe path for URL synchronization
  if (iframePath === '/') {
    newUrl.searchParams.delete('subpage');
  } else {
    newUrl.searchParams.set('subpage', iframePath);
  }
  // Remove hash if it exists
  newUrl.hash = '';
  
  // Use pushState to make URL changes visible in address bar, replaceState for initial load
  if (usePushState) {
    window.history.pushState({ iframePath: iframePath }, document.title, newUrl.toString());
    console.log('URL updated (pushState) to:', newUrl.toString());
    lastUrlUpdateTime = now;
  } else {
    window.history.replaceState({ iframePath: iframePath }, document.title, newUrl.toString());
    console.log('URL updated (replaceState) to:', newUrl.toString());
  }
  
  // Reset flag after a short delay
  setTimeout(() => {
    isUpdatingUrl = false;
  }, 100);
}

// Extract path from a full URL (handles both relative and absolute URLs)
function extractPathFromUrl(urlString) {
  try {
    // If it's a full URL, extract path + search + hash
    if (urlString.startsWith('http://') || urlString.startsWith('https://')) {
      const url = new URL(urlString);
      return url.pathname + url.search + url.hash;
    }
    // If it's relative to tunnel base, extract everything after the base
    if (tunnelBaseUrl && urlString.startsWith(tunnelBaseUrl)) {
      const path = urlString.substring(tunnelBaseUrl.length);
      return path || '/';
    }
    // If it's already a path, return it
    if (urlString.startsWith('/')) {
      return urlString;
    }
    return '/';
  } catch (e) {
    console.error('Error extracting path from URL:', e);
    return '/';
  }
}

// Toast notification system
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-title">${title}</div>
    <div class="toast-message">${message}</div>
  `;
  
  container.appendChild(toast);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease-out reverse';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 5000);
}

// Apply page metadata from iframe to the portal document (for bookmarks/tabs)
function applyPageMeta(meta) {
  if (!meta) return;

  // Update document title
  if (meta.title) {
    document.title = meta.title;
  }

  // Update meta description
  if (meta.description) {
    let descEl = document.querySelector('meta[name="description"]');
    if (descEl) {
      descEl.setAttribute('content', meta.description);
    }
  }

  // Update Open Graph tags
  if (meta.ogTitle) {
    let el = document.querySelector('meta[property="og:title"]');
    if (el) el.setAttribute('content', meta.ogTitle);
  }
  if (meta.ogDescription) {
    let el = document.querySelector('meta[property="og:description"]');
    if (el) el.setAttribute('content', meta.ogDescription);
  }
  if (meta.ogImage) {
    let el = document.querySelector('meta[property="og:image"]');
    if (el) el.setAttribute('content', meta.ogImage);
  }

  // Update Twitter card tags
  if (meta.ogTitle) {
    let el = document.querySelector('meta[name="twitter:title"]');
    if (el) el.setAttribute('content', meta.ogTitle);
  }
  if (meta.ogDescription) {
    let el = document.querySelector('meta[name="twitter:description"]');
    if (el) el.setAttribute('content', meta.ogDescription);
  }
  if (meta.ogImage) {
    let el = document.querySelector('meta[name="twitter:image"]');
    if (el) el.setAttribute('content', meta.ogImage);
  }

  // Update favicon
  if (meta.favicon) {
    let iconEl = document.querySelector('link[rel="icon"]');
    if (iconEl) {
      iconEl.setAttribute('href', meta.favicon);
    }
    let appleIconEl = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleIconEl) {
      appleIconEl.setAttribute('href', meta.favicon);
    }
  }
}

// Register all config tunnels with the service worker so it can track them
async function registerTunnelsWithServiceWorker() {
  if (!window.platformSW?.isInstalled()) return;

  try {
    const tunnels = CONFIG?.cloudflareTunnels;
    if (!tunnels || tunnels.length === 0) return;

    for (const tunnel of tunnels) {
      if (tunnel.name && tunnel.address) {
        await window.platformSW.registerTunnel(tunnel.name, tunnel.address);
      }
    }
    console.log(`[Portal] Registered ${tunnels.length} tunnels with service worker`);
  } catch (e) {
    console.warn('[Portal] Failed to register tunnels with service worker:', e);
  }
}

// 404 detection, config polling, and health checking
let pollingInterval = null;
let countdownInterval = null;
let countdownSeconds = 10;
let isCountdownPaused = false;
let currentTunnelAddress = '';

// Connection failure retry system
let retryCountdownInterval = null;
let retryCountdownSeconds = 10;
let isRetryPaused = false;
let connectionFailureDetected = false;

// Platform updating staged countdown system
let updatingTimerInterval = null;
let updatingStartTime = null;       // When the updating flow started
let updatingTotalSeconds = 300;     // Current estimate in seconds (starts at 5 min)
let updatingElapsedSeconds = 0;     // How many seconds have elapsed
const UPDATING_STAGES = [
  { threshold: 0,    label: 'Platform Updating',         state: 'updating', barIndex: 0 },   // Fast: 0-2 min
  { threshold: 120,  label: 'Platform Updating',         state: 'updating', barIndex: 1 },   // Normal: 2-5 min
  { threshold: 300,  label: 'Platform Updating',         state: 'updating', barIndex: 2 },   // Slow: 5-15 min
  { threshold: 900,  label: 'Platform Updating',         state: 'warning',  barIndex: 3 },   // Concerning: 15-20 min
  { threshold: 1200, label: 'Possible Problem Detected', state: 'warning',  barIndex: 4 },   // Problem: 20+ min
  { threshold: 1800, label: 'Platform Offline',          state: 'offline',  barIndex: 4 },   // Offline: 30+ min
];

// Recent release info detected from config.json
let detectedRelease = null;
const RELEASE_RECENCY_MS = 2 * 60 * 60 * 1000; // Consider releases within 2 hours as "current" (deployments can take time)

// localStorage keys for persisting failure state across page refreshes
const LS_FAILURE_DETECTED_AT = 'portal_failureDetectedAt';
const LS_FAILURE_TUNNEL = 'portal_failureTunnel';

// localStorage key for the last time THIS BROWSER directly confirmed the tunnel was reachable
// (via checkTunnelHealth()'s 30s periodic poll -- see LAST-CONFIRMED-ONLINE ANCHOR FIX below).
const LS_LAST_LOCAL_SUCCESS_AT = 'portal_lastLocalSuccessAt';

// Get the latest release from config.json (for timer anchoring when platform is offline)
function getLatestRelease() {
  if (!CONFIG || !CONFIG.releases || CONFIG.releases.length === 0) return null;

  const latest = CONFIG.releases[CONFIG.releases.length - 1];
  if (!latest || !latest.timestamp) return null;

  const releaseTime = new Date(latest.timestamp).getTime();
  if (isNaN(releaseTime)) return null;

  return latest;
}

// Check if the latest release is recent enough to show "deploying" messaging (vs generic offline)
function isReleaseRecent(release) {
  if (!release || !release.timestamp) return false;
  const releaseTime = new Date(release.timestamp).getTime();
  if (isNaN(releaseTime)) return false;
  return (Date.now() - releaseTime) <= RELEASE_RECENCY_MS;
}

// Render the recent updates timeline in the updating modal
function renderUpdatesTimeline() {
  const container = document.getElementById('recentUpdatesTimeline');
  const entriesEl = document.getElementById('timelineEntries');
  if (!container || !entriesEl) return;

  const releases = CONFIG && CONFIG.releases ? CONFIG.releases : [];
  if (releases.length === 0) {
    container.classList.add('hidden');
    return;
  }

  // Show most recent 5 releases, newest first
  const recent = releases.slice(-5).reverse();
  const latestVersion = recent[0] ? recent[0].version : null;

  entriesEl.innerHTML = '';
  recent.forEach((release) => {
    const entry = document.createElement('div');
    entry.className = 'timeline-entry' + (release.version === latestVersion ? ' current' : '');

    const dot = document.createElement('div');
    dot.className = 'timeline-dot';

    const body = document.createElement('div');
    body.className = 'timeline-body';

    const version = document.createElement('div');
    version.className = 'timeline-version';
    version.textContent = release.version || '';

    const title = document.createElement('div');
    title.className = 'timeline-title';
    title.textContent = release.title || '';
    title.title = release.title || '';

    const time = document.createElement('div');
    time.className = 'timeline-time';
    time.textContent = formatReleaseTime(release.timestamp);

    body.appendChild(version);
    body.appendChild(title);
    body.appendChild(time);
    entry.appendChild(dot);
    entry.appendChild(body);
    entriesEl.appendChild(entry);
  });

  container.classList.remove('hidden');
}

// Update the "Last confirmed online" line in the offline-detection overlay.
//
// FIXED 2026-08-28: this previously read ONLY HEALTH_STATUS.lastOnlineAt (the independent
// GitHub-Actions health-check's own timestamp), completely bypassing the anchor-selection logic
// showConnectionFailure() already computes (the MORE RECENT of that external signal and this
// browser's own last successful checkTunnelHealth() poll -- see the "LAST-CONFIRMED-ONLINE ANCHOR
// FIX" comment above persistLastLocalSuccess()). The elapsed-timer countdown was correctly using
// the tighter/more-recent anchor via updatingStartTime, but this text line kept displaying the
// external check's own (potentially hours-stale, see the cron-cadence note in
// battle-buddy-games/Status's health-check.yml) timestamp regardless -- so a user could see an
// accurate elapsed timer right next to a wildly inflated "Last confirmed online: 5h ago" label,
// even when the platform had actually only been down for seconds. This is what produced the
// reported "Platform Offline -- Last confirmed online: 5h ago" while the platform was already back
// up: HEALTH_STATUS.lastOnlineAt was stale because the external check's real cadence lagged its
// declared 15-minute cron by hours, and this function had no fallback to a fresher local signal.
//
// Fix: prefer updatingStartTime (the anchor showConnectionFailure() already resolved to whichever
// signal is more recent) whenever the overlay is actively showing a failure; only fall back to the
// raw HEALTH_STATUS.lastOnlineAt when no anchor has been established yet (e.g. this function is
// called before any failure has ever been detected in this session).
function updateLastConfirmedOnlineDisplay() {
  const el = document.getElementById('lastConfirmedOnline');
  if (!el) return;

  const anchorMs = (connectionFailureDetected && updatingStartTime) ? updatingStartTime : null;
  const displayMs = anchorMs || (HEALTH_STATUS && HEALTH_STATUS.lastOnlineAt
    ? new Date(HEALTH_STATUS.lastOnlineAt).getTime()
    : NaN);

  if (!isNaN(displayMs) && displayMs) {
    el.textContent = 'Last confirmed online: ' + formatReleaseTime(displayMs);
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// Format release timestamp for timeline display
function formatReleaseTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';

  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 172800000) return 'Yesterday';

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Persist failure detection time to localStorage so the timer survives page refreshes
function persistFailureTime(timestamp, tunnelAddress) {
  try {
    localStorage.setItem(LS_FAILURE_DETECTED_AT, String(timestamp));
    if (tunnelAddress) localStorage.setItem(LS_FAILURE_TUNNEL, tunnelAddress);
  } catch (e) {
    // localStorage unavailable (private browsing, etc.)
  }
}

// Read persisted failure time from localStorage
function getPersistedFailureTime() {
  try {
    const raw = localStorage.getItem(LS_FAILURE_DETECTED_AT);
    if (!raw) return null;
    const ts = Number(raw);
    if (isNaN(ts) || ts <= 0) return null;
    // Ignore stale persisted failures older than 2 hours
    if (Date.now() - ts > 2 * 60 * 60 * 1000) {
      clearPersistedFailure();
      return null;
    }
    return ts;
  } catch (e) {
    return null;
  }
}

// Clear persisted failure state (called when platform comes back online)
function clearPersistedFailure() {
  try {
    localStorage.removeItem(LS_FAILURE_DETECTED_AT);
    localStorage.removeItem(LS_FAILURE_TUNNEL);
  } catch (e) {
    // Ignore
  }
}

// LAST-CONFIRMED-ONLINE ANCHOR FIX (2026-07-29): record every time THIS BROWSER's own
// checkTunnelHealth() poll succeeds. showConnectionFailure() previously anchored the
// "offline for X" elapsed timer EXCLUSIVELY to HEALTH_STATUS.lastOnlineAt -- the completion
// time of the most recent SUCCESSFUL run of the external battle-buddy-games/Status repo's
// health-check.yml workflow. That workflow's cron is declared as */15 minutes but GitHub
// Actions does not guarantee schedule-trigger cadence for a low-traffic repo; confirmed
// observed cadence on 2026-07-28/29 was 1-3+ hours between successful runs (root-caused
// alongside a real, still-ongoing platform.core.exe crash-loop -- see
// docs/living-docs/findings/platform-offline-45min-false-report-devops-engineer-2026-07-29.md).
// That gap alone can make lastOnlineAt read 45+ minutes stale even when the platform was only
// actually unreachable for seconds. This browser's own 30s heartbeat (checkTunnelHealth(),
// unaffected by the external check's cadence) is almost always a MUCH tighter, more recent
// "last known good" signal whenever this tab has been open for a while before a failure is
// detected -- showConnectionFailure() below now anchors to whichever of the two signals is
// more recent, not the external one unconditionally.
function persistLastLocalSuccess(timestamp) {
  try {
    localStorage.setItem(LS_LAST_LOCAL_SUCCESS_AT, String(timestamp));
  } catch (e) {
    // localStorage unavailable (private browsing, etc.)
  }
}

function getPersistedLastLocalSuccess() {
  try {
    const raw = localStorage.getItem(LS_LAST_LOCAL_SUCCESS_AT);
    if (!raw) return null;
    const ts = Number(raw);
    if (isNaN(ts) || ts <= 0) return null;
    // Ignore stale entries older than 2 hours (matches getPersistedFailureTime's own ceiling) --
    // a signal that old is no longer meaningfully "more recent" than any real external check.
    if (Date.now() - ts > 2 * 60 * 60 * 1000) return null;
    return ts;
  } catch (e) {
    return null;
  }
}

// Health check for tunnel address using /api/HealthCheck/system (like gateway.js)
async function checkTunnelHealth(address) {
  if (!address) return false;

  const cleanBaseUrl = address.replace(/\/$/, '');
  const healthUrl = `${cleanBaseUrl}/api/HealthCheck/system`;

  // Suppress console errors during health check to avoid noise
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const errorStr = args.join(' ');
    if (errorStr.includes('CORS') ||
        errorStr.includes('Access-Control-Allow-Origin') ||
        errorStr.includes('502') ||
        errorStr.includes('Bad Gateway') ||
        errorStr.includes('ERR_FAILED') ||
        errorStr.includes('ERR_ABORTED') ||
        errorStr.includes('Failed to fetch')) {
      return; // Suppress expected health check errors
    }
    originalConsoleError.apply(console, args);
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json, text/plain, */*' },
      signal: controller.signal,
      mode: 'cors'
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (e) {
    // Network error, timeout, or abort
    return false;
  } finally {
    console.error = originalConsoleError;
  }
}

// Get the current updating stage based on elapsed time
function getUpdatingStage(elapsed) {
  let stage = UPDATING_STAGES[0];
  for (let i = UPDATING_STAGES.length - 1; i >= 0; i--) {
    if (elapsed >= UPDATING_STAGES[i].threshold) {
      stage = UPDATING_STAGES[i];
      break;
    }
  }
  return stage;
}

// Format seconds as M:SS
function formatCountdown(seconds) {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Get the current stage index (0-5) based on elapsed time
function getUpdatingStageIndex(elapsed) {
  for (let i = UPDATING_STAGES.length - 1; i >= 0; i--) {
    if (elapsed >= UPDATING_STAGES[i].threshold) return i;
  }
  return 0;
}

// Update the staged updating UI (called every second by the timer)
function updateUpdatingUI() {
  if (!connectionFailureDetected) return;

  updatingElapsedSeconds++;
  const stageIndex = getUpdatingStageIndex(updatingElapsedSeconds);
  const stage = UPDATING_STAGES[stageIndex];

  const titleEl = document.getElementById('connectionFailureTitle');
  const messageEl = document.getElementById('connectionFailureMessage');
  const timeEl = document.getElementById('updatingTimeRemaining');
  const extraMsg = document.getElementById('updatingExtraMessage');
  const contentEl = document.querySelector('.updating-content');

  if (titleEl) titleEl.textContent = stage.label;

  // Update elapsed time in spinner (count UP)
  if (timeEl) timeEl.textContent = formatCountdown(updatingElapsedSeconds);
  updateLastConfirmedOnlineDisplay();

  // Update bar segments - mark completed and active
  const segments = document.querySelectorAll('.updating-steps-bar .bar-segment');
  const activeBarIndex = stage.barIndex;
  segments.forEach((seg, i) => {
    seg.classList.remove('active', 'completed');
    if (i < activeBarIndex) seg.classList.add('completed');
    else if (i === activeBarIndex) seg.classList.add('active');
  });

  // Update state classes
  if (contentEl) {
    contentEl.classList.remove('state-warning', 'state-offline');
    if (stage.state === 'warning') contentEl.classList.add('state-warning');
    if (stage.state === 'offline') contentEl.classList.add('state-offline');
  }

  // Update subtitle message
  if (messageEl) {
    if (stage.state === 'updating') {
      if (detectedRelease && isReleaseRecent(detectedRelease)) {
        const releaseLabel = detectedRelease.version || '';
        const releaseDesc = detectedRelease.title || '';
        messageEl.innerHTML = 'Deploying update' + (releaseLabel ? ' <strong>' + releaseLabel + '</strong>' : '')
          + (releaseDesc ? ' &mdash; ' + releaseDesc : '') + '. Please wait...';
      } else {
        messageEl.textContent = 'An update may be in progress. Retrying automatically...';
      }
    } else if (stage.state === 'warning') {
      messageEl.textContent = 'This is taking longer than expected.';
    } else if (stage.state === 'offline') {
      messageEl.textContent = 'The platform could not be reached.';
    }
  }

  // Show extra message for warning and offline states
  const platformNotice = 'The platform is hosted on powerful game servers and is not available at all times, '
    + 'however we aim to provide regular coverage most days. If you need better uptime let us know. '
    + 'Please check back soon or <a href="https://discord.gg/vMvjHWcR3k" target="_blank" rel="noopener">share feedback with us</a>.';

  if (extraMsg) {
    if (stage.state === 'warning' || stage.state === 'offline') {
      extraMsg.innerHTML = platformNotice;
      extraMsg.classList.remove('hidden');
      extraMsg.classList.toggle('offline', stage.state === 'offline');
    } else {
      extraMsg.classList.add('hidden');
    }
  }
}

// Poll config.json and check tunnel health for cloud service
// Note: This no longer updates the UI directly - the staged timer handles all UI updates
async function pollConfigAndHealth() {
  try {
    // Reload config
    const response = await fetch('./config.json?t=' + Date.now());
    if (!response.ok) {
      console.log('Failed to reload config');
      return false;
    }

    const newConfig = await response.json();
    CONFIG = newConfig;

    // Re-check for release info (may appear or change after config.json is updated mid-wait).
    // This is cosmetic messaging only ("Deploying update X") -- it does NOT re-anchor the
    // elapsed timer here. The timer only re-anchors when showConnectionFailure() itself runs
    // again (e.g. on a manual retry or a fresh page load) -- see that function's own doc comment
    // for the current anchor-selection logic (whichever of HEALTH_STATUS.lastOnlineAt or this
    // browser's own last local success is more recent).
    if (connectionFailureDetected) {
      const latestRelease = getLatestRelease();
      if (latestRelease && latestRelease.timestamp &&
          (!detectedRelease || latestRelease.version !== detectedRelease.version)) {
        detectedRelease = latestRelease;
        console.log('[Portal] New release detected during polling:', detectedRelease.version);
        renderUpdatesTimeline();
      }

      // Refresh the independent health signal too, so "Last confirmed online" stays current
      // if it was unavailable at the moment the failure was first detected.
      await loadHealthStatus();
      updateLastConfirmedOnlineDisplay();
    }

    const cloudTunnel = getTunnelForPreferredEnvironment() || newConfig.cloudflareTunnels?.find(t => t.name === 'cloud');

    if (!cloudTunnel || !cloudTunnel.address) {
      console.log('No cloud tunnel in config');
      return false;
    }

    const newAddress = cloudTunnel.address.replace(/\/$/, '');

    // If address changed, check health of the new address
    if (newAddress !== currentTunnelAddress && newAddress !== tunnelBaseUrl) {
      console.log(`New cloud tunnel address found: ${newAddress}`);

      const isHealthy = await checkTunnelHealth(newAddress);

      if (isHealthy) {
        console.log(`New cloud tunnel address is healthy: ${newAddress}`);

        if (connectionFailureDetected) {
          console.log('Auto-retrying with new healthy address');
          stopPolling();
          stopUpdatingTimer();
          refreshToNewAddress(newAddress);
          return true;
        } else {
          showToast('New Tunnel Found', 'A new tunnel address has been detected and is ready.', 'success');
          startCountdown(newAddress);
          return true;
        }
      } else {
        console.log(`New cloud tunnel address is not healthy yet: ${newAddress}`);
        return false;
      }
    } else if (newAddress === tunnelBaseUrl) {
      // Same address - check if it's now healthy
      const isHealthy = await checkTunnelHealth(newAddress);
      if (isHealthy && connectionFailureDetected) {
        console.log('Current tunnel address is now healthy - retrying');
        stopPolling();
        stopUpdatingTimer();
        retryConnection();
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error polling config:', error);
    return false;
  }
}

// Start polling when 404 is detected
function startPolling() {
  if (pollingInterval) return; // Already polling
  
  console.log('Starting config polling...');
  showToast('Page Not Found', 'Searching for a new tunnel address...', 'error');
  
  // Poll every 5 seconds
  pollingInterval = setInterval(pollConfigAndHealth, 5000);
  
  // Also poll immediately
  pollConfigAndHealth();
}

// Start polling specifically for cloud address (used when connection fails)
function startPollingForCloudAddress() {
  if (pollingInterval) return; // Already polling

  console.log('Starting cloud address polling...');

  // Poll every 10 seconds - the staged timer handles UI so no flickering
  pollingInterval = setInterval(async () => {
    const foundHealthy = await pollConfigAndHealth();
    if (foundHealthy) {
      stopPolling();
    }
  }, 10000);

  // Also poll immediately
  pollConfigAndHealth();
}

// Stop polling
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// =====================================================================
// PERIODIC HEALTH CHECK SYSTEM (ported from gateway.js)
// Proactively detects outages and config.json tunnel address changes
// =====================================================================

// Perform a periodic health check: reload config.json and check tunnel health
async function performPeriodicHealthCheck() {
  // Don't run health checks if we're already in failure/recovery mode
  if (connectionFailureDetected) return;

  // Don't run if tunnel isn't loaded yet
  if (!tunnelBaseUrl) return;

  try {
    // 1. Reload config.json to detect tunnel address changes
    const response = await fetch('./config.json?t=' + Date.now());
    if (!response.ok) {
      console.log('[Health Check] Failed to reload config.json');
      return;
    }

    const newConfig = await response.json();
    CONFIG = newConfig;

    const cloudTunnel = getTunnelForPreferredEnvironment() || newConfig.cloudflareTunnels?.find(t => t.name === 'cloud');
    if (!cloudTunnel || !cloudTunnel.address) {
      console.log('[Health Check] No cloud tunnel in config');
      return;
    }

    const newAddress = cloudTunnel.address.replace(/\/$/, '');

    // 2. Check if tunnel address changed in config.json
    if (newAddress !== tunnelBaseUrl) {
      console.log(`[Health Check] Tunnel address changed: ${tunnelBaseUrl} -> ${newAddress}`);

      // Verify the new address is healthy before switching
      const isHealthy = await checkTunnelHealth(newAddress);
      if (isHealthy) {
        console.log('[Health Check] New tunnel address is healthy, starting countdown');
        persistLastLocalSuccess(Date.now());
        showToast('Tunnel Address Changed', 'A new tunnel address has been detected. Switching...', 'info');
        startCountdown(newAddress);
      } else {
        console.log('[Health Check] New tunnel address not healthy yet, will retry next cycle');
      }
      return;
    }

    // 3. Address hasn't changed - check health of current tunnel
    const isHealthy = await checkTunnelHealth(tunnelBaseUrl);
    if (!isHealthy) {
      console.log('[Health Check] Current tunnel is unhealthy');
      lastHealthyTunnelAddress = tunnelBaseUrl;
      showConnectionFailure('Platform Offline', 'The platform is currently offline — an update may be in progress. Searching for a new address...');
    } else {
      // Record this browser's own successful reachability check -- see the
      // LAST-CONFIRMED-ONLINE ANCHOR FIX doc comment on persistLastLocalSuccess() above.
      persistLastLocalSuccess(Date.now());
    }

  } catch (error) {
    console.warn('[Health Check] Error during periodic health check:', error);
  }
}

// Start periodic health checks
function startPeriodicHealthChecks() {
  stopPeriodicHealthChecks(); // Clear any existing interval

  console.log(`[Health Check] Starting periodic health checks every ${HEALTH_CHECK_INTERVAL_MS / 1000}s`);

  // Run first periodic health check after 10s (immediate check already happens in iframe.onload)
  setTimeout(() => {
    performPeriodicHealthCheck();
  }, 10000);

  // Then run periodically
  healthCheckInterval = setInterval(() => {
    performPeriodicHealthCheck();
  }, HEALTH_CHECK_INTERVAL_MS);
}

// Stop periodic health checks
function stopPeriodicHealthChecks() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// Stop the staged updating timer
function stopUpdatingTimer() {
  if (updatingTimerInterval) {
    clearInterval(updatingTimerInterval);
    updatingTimerInterval = null;
  }
}

// Show the staged "Platform Updating" overlay and start the countdown
function showConnectionFailure(title, message) {
  if (connectionFailureDetected) return; // Already showing
  if (typeof trackGatewayEvent === 'function') trackGatewayEvent('portal_tunnel_failed', { error: title });

  connectionFailureDetected = true;

  // Kept for the cosmetic "Deploying update X" message text only (see below) -- NOT used to
  // anchor the elapsed timer. Anchoring to the deploy timestamp was the bug: it made the "elapsed"
  // duration wrong whenever the platform had been running fine for a while since the last release
  // before actually going down.
  detectedRelease = getLatestRelease();

  // Determine timer start time -- "last confirmed online", most reliable (= most recent) signal wins:
  // 1. The MORE RECENT of (a) HEALTH_STATUS.lastOnlineAt from the independent GitHub-Actions
  //    health check (health-status.json), and (b) this browser's own last confirmed-successful
  //    checkTunnelHealth() poll (LS_LAST_LOCAL_SUCCESS_AT). The external check's cron is declared
  //    every 15 minutes but its observed real-world cadence can be 1-3+ hours (GitHub Actions does
  //    not guarantee schedule-trigger timing for a low-traffic repo -- see the doc comment on
  //    persistLastLocalSuccess() above), so trusting it unconditionally can report an "offline for
  //    X minutes" figure far larger than the platform was actually unreachable. Picking whichever
  //    signal is more recent never makes the reported duration LONGER than reality -- both are
  //    lower bounds on "last known good", so the tighter (more recent) one is always at least as
  //    accurate.
  // 2. Persisted failure detection time from localStorage (survives refresh, keeps a stable
  //    anchor across reloads even if neither signal above is available).
  // 3. Current time (last resort, only on first detection with no signal available at all).
  const healthStatusOnlineAt = HEALTH_STATUS && HEALTH_STATUS.lastOnlineAt
    ? new Date(HEALTH_STATUS.lastOnlineAt).getTime()
    : NaN;
  const localSuccessAt = getPersistedLastLocalSuccess();

  let lastOnlineAt = NaN;
  let lastOnlineSource = null;
  if (!isNaN(healthStatusOnlineAt) && localSuccessAt) {
    if (localSuccessAt > healthStatusOnlineAt) {
      lastOnlineAt = localSuccessAt;
      lastOnlineSource = 'this browser\'s own last successful check (more recent than health-status.json)';
    } else {
      lastOnlineAt = healthStatusOnlineAt;
      lastOnlineSource = 'health-status.json';
    }
  } else if (!isNaN(healthStatusOnlineAt)) {
    lastOnlineAt = healthStatusOnlineAt;
    lastOnlineSource = 'health-status.json';
  } else if (localSuccessAt) {
    lastOnlineAt = localSuccessAt;
    lastOnlineSource = 'this browser\'s own last successful check';
  }

  if (!isNaN(lastOnlineAt)) {
    updatingStartTime = lastOnlineAt;
    updatingElapsedSeconds = Math.max(0, Math.floor((Date.now() - lastOnlineAt) / 1000));
    persistFailureTime(lastOnlineAt, tunnelBaseUrl);
    console.log('[Portal] Timer anchored to ' + lastOnlineSource + ' (' + updatingElapsedSeconds + 's elapsed)');
  } else {
    // No health status available — check localStorage for persisted failure time
    const persisted = getPersistedFailureTime();
    if (persisted) {
      updatingStartTime = persisted;
      updatingElapsedSeconds = Math.max(0, Math.floor((Date.now() - persisted) / 1000));
      console.log('[Portal] Timer restored from persisted failure time (' + updatingElapsedSeconds + 's elapsed)');
    } else {
      // First detection — start fresh and persist
      updatingStartTime = Date.now();
      updatingElapsedSeconds = 0;
      persistFailureTime(updatingStartTime, tunnelBaseUrl);
      console.log('[Portal] No health status or persisted time — starting timer fresh');
    }
  }

  // Always hide the loading overlay when showing connection failure
  // This prevents "Loading platform..." from covering the updating modal
  // (e.g., when user refreshes during an update and the iframe never loads)
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) loadingOverlay.classList.add('hidden');

  const overlay = document.getElementById('connectionFailureOverlay');
  const titleEl = document.getElementById('connectionFailureTitle');
  const messageEl = document.getElementById('connectionFailureMessage');
  const timeEl = document.getElementById('updatingTimeRemaining');
  const extraMsg = document.getElementById('updatingExtraMessage');
  const contentEl = document.querySelector('.updating-content');
  const retryNowBtn = document.getElementById('retryNowBtn');

  if (!overlay) return;

  // Determine initial stage from elapsed time
  const initialStage = getUpdatingStage(updatingElapsedSeconds);

  // Reset to appropriate state
  overlay.classList.remove('hidden');
  if (contentEl) {
    contentEl.classList.remove('state-warning', 'state-offline');
    if (initialStage.state === 'warning') contentEl.classList.add('state-warning');
    if (initialStage.state === 'offline') contentEl.classList.add('state-offline');
  }
  if (titleEl) titleEl.textContent = initialStage.label;
  if (messageEl) messageEl.textContent = 'An update may be in progress. Retrying automatically...';
  // Show elapsed time (count up)
  if (timeEl) timeEl.textContent = formatCountdown(updatingElapsedSeconds);
  if (extraMsg) { extraMsg.classList.add('hidden'); extraMsg.classList.remove('offline'); }
  updateLastConfirmedOnlineDisplay();

  // Set bar segments to match current elapsed position
  const activeBarIndex = initialStage.barIndex;
  document.querySelectorAll('.updating-steps-bar .bar-segment').forEach((seg, i) => {
    seg.classList.remove('active', 'completed');
    if (i < activeBarIndex) seg.classList.add('completed');
    else if (i === activeBarIndex) seg.classList.add('active');
  });

  // Update subtitle with release info if detected and recent
  if (detectedRelease && isReleaseRecent(detectedRelease)) {
    console.log('[Portal] Recent release detected:', detectedRelease);
    if (messageEl) {
      const releaseLabel = detectedRelease.version || '';
      const releaseDesc = detectedRelease.title || '';
      messageEl.innerHTML = 'Deploying update' + (releaseLabel ? ' <strong>' + releaseLabel + '</strong>' : '')
        + (releaseDesc ? ' &mdash; ' + releaseDesc : '') + '. Please wait...';
    }
  }

  // Populate recent updates timeline
  renderUpdatesTimeline();

  // Setup retry button
  if (retryNowBtn) {
    retryNowBtn.onclick = () => {
      retryConnection();
    };
  }

  // Start the 1-second UI update timer
  stopUpdatingTimer();
  updatingTimerInterval = setInterval(updateUpdatingUI, 1000);

  // Start background polling for healthy tunnel (every 10 seconds - no UI flickering)
  startPollingForCloudAddress();
}

// Retry connection
function retryConnection() {
  // Stop polling and updating timer
  stopPolling();
  stopUpdatingTimer();
  clearLoadingTimeout();

  // Hide failure overlay
  const overlay = document.getElementById('connectionFailureOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }

  // Clear retry countdown
  if (retryCountdownInterval) {
    clearInterval(retryCountdownInterval);
    retryCountdownInterval = null;
  }

  // Reset flags and clear persisted failure state
  connectionFailureDetected = false;
  iframeLoadCompleted = false;
  loadingRetryCount = 0;
  clearPersistedFailure();

  // Show loading overlay
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    loadingOverlay.classList.remove('hidden');
  }

  // Reload the tunnel
  loadTunnel();
}

// Countdown timer for refresh
function startCountdown(newAddress) {
  stopPolling(); // Stop polling once we found a valid address
  currentTunnelAddress = newAddress;
  
  const overlay = document.getElementById('countdownOverlay');
  const secondsElement = document.getElementById('countdownSeconds');
  const pauseBtn = document.getElementById('pauseCountdownBtn');
  const refreshNowBtn = document.getElementById('refreshNowBtn');
  
  if (!overlay || !secondsElement) return;
  
  overlay.classList.remove('hidden');
  countdownSeconds = 10;
  isCountdownPaused = false;
  secondsElement.textContent = countdownSeconds;
  pauseBtn.textContent = 'Pause';
  
  // Clear any existing countdown
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  
  // Setup pause button
  pauseBtn.onclick = () => {
    isCountdownPaused = !isCountdownPaused;
    pauseBtn.textContent = isCountdownPaused ? 'Resume' : 'Pause';
  };
  
  // Setup refresh now button
  refreshNowBtn.onclick = () => {
    refreshToNewAddress(newAddress);
  };
  
  // Start countdown
  countdownInterval = setInterval(() => {
    if (!isCountdownPaused) {
      countdownSeconds--;
      secondsElement.textContent = countdownSeconds;
      
      if (countdownSeconds <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        refreshToNewAddress(newAddress);
      }
    }
  }, 1000);
}

// Refresh iframe to new address while preserving subpage
function refreshToNewAddress(newAddress) {
  // Hide connection failure overlay if showing
  const failureOverlay = document.getElementById('connectionFailureOverlay');
  if (failureOverlay) {
    failureOverlay.classList.add('hidden');
  }

  // Hide countdown overlay if showing
  const countdownOverlay = document.getElementById('countdownOverlay');
  if (countdownOverlay) {
    countdownOverlay.classList.add('hidden');
  }

  // Stop polling and updating timer
  stopPolling();
  stopUpdatingTimer();

  // Reset connection failure flag and clear persisted state
  connectionFailureDetected = false;
  clearPersistedFailure();

  // Get current subpage from URL
  const urlParams = new URLSearchParams(window.location.search);
  const subpagePath = urlParams.get('subpage') || '/';
  const token = urlParams.get('token');
  
  // Update tunnel base URL
  tunnelBaseUrl = newAddress;
  currentTunnelAddress = newAddress;
  
  // Build new URL
  const iframe = document.getElementById('tunnelFrame');
  let targetUrl;
  
  if (token) {
    // Use /auth/signin-token for one-time tokens from OAuth flow
    const authUrl = new URL(`${tunnelBaseUrl}/auth/signin-token`);
    authUrl.searchParams.set('token', token);
    authUrl.searchParams.set('returnUrl', subpagePath);
    targetUrl = authUrl.toString();
  } else {
    targetUrl = `${tunnelBaseUrl}${subpagePath}`;
  }
  
  // Reset load state flags
  iframeLoadCompleted = false;
  loadingRetryCount = 0;
  clearLoadingTimeout();

  // Reload iframe
  iframe.src = targetUrl;
  currentIframePath = subpagePath;

  // Start loading timeout for the new address
  startLoadingTimeout();

  showToast('New Address Found', 'Connecting to new cloud address...', 'success');

  // Show loading overlay
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    loadingOverlay.classList.remove('hidden');
  }
}

function updateUrlFromIframe() {
  // Skip if we're currently updating to prevent loops
  if (isUpdatingUrl) {
    return;
  }
  
  try {
    const iframe = document.getElementById('tunnelFrame');
    if (!iframe || !iframe.contentWindow) {
      console.log('updateUrlFromIframe: iframe not available');
      return;
    }

    // Try to get iframe location (may fail due to cross-origin restrictions)
    let iframePath = '/';
    let pathSource = 'unknown';
    
    // Always try direct location access first (even if previously marked as cross-origin)
    // Sometimes cross-origin restrictions can be inconsistent
    try {
      // This will throw if cross-origin
      const iframeLocation = iframe.contentWindow.location;
      iframePath = iframeLocation.pathname + iframeLocation.search + iframeLocation.hash;
      pathSource = 'direct-access';
      
      // Reset cross-origin flag if we successfully accessed it
      if (isIframeCrossOrigin) {
        console.log('Successfully accessed iframe location (no longer cross-origin)');
        isIframeCrossOrigin = false;
      }
      
      // Check if iframe navigated to gateway.html
      if (iframePath.includes('gateway.html') || iframeLocation.href.includes('gateway.html')) {
        // Preserve URL params (e.g. ?link=google&returnUrl=...) when redirecting
        const gatewaySearch = iframeLocation.search || '';
        console.log('Iframe navigated to gateway.html, redirecting whole page' + (gatewaySearch ? ' with params: ' + gatewaySearch : ''));
        redirectToGatewayWithLoopGuard(gatewaySearch);
        return;
      }
    } catch (e) {
      // Cross-origin restriction - can't access iframe location directly
      // Mark as cross-origin to avoid future attempts
      const wasCrossOrigin = isIframeCrossOrigin;
      isIframeCrossOrigin = true;
      // Only log once to reduce console noise
      if (!wasCrossOrigin) {
        console.log('Cannot access iframe location (cross-origin):', e.message);
        console.log('Note: For SPAs with client-side routing, URL updates require postMessage from iframe content');
      }
    }
    
    // If cross-origin or direct access failed, try fallback methods
    if (isIframeCrossOrigin || pathSource === 'unknown') {
      // For cross-origin SPAs that send postMessages, src-attribute is unreliable
      // Once we've received postMessages, ignore src-attribute entirely for cross-origin iframes
      if (isIframeCrossOrigin && hasReceivedPostMessage) {
        // This is a cross-origin SPA that uses postMessage - src-attribute will always be wrong
        // For SPAs, the src stays at the base URL even when client-side routing changes the route
        console.log('Ignoring src-attribute update (cross-origin SPA uses postMessage)');
        return;
      }
      
      // Check if we recently received a postMessage update - if so, prioritize it over src-attribute
      const timeSincePostMessage = Date.now() - lastPostMessageTime;
      if (lastPostMessagePath !== null && timeSincePostMessage < POSTMESSAGE_PRIORITY_MS) {
        // Recent postMessage update - don't override with src-attribute
        console.log(`Ignoring src-attribute update (postMessage took priority ${timeSincePostMessage}ms ago): ${lastPostMessagePath}`);
        return;
      }
      
      try {
        const iframeSrc = iframe.src;
        if (iframeSrc) {
          const extractedPath = extractPathFromUrl(iframeSrc);
          pathSource = 'src-attribute';
          if (extractedPath && extractedPath !== currentIframePath) {
            // Only use src-attribute if it matches the last postMessage path or if no recent postMessage
            if (lastPostMessagePath === null || extractedPath === lastPostMessagePath || timeSincePostMessage >= POSTMESSAGE_PRIORITY_MS) {
              iframePath = extractedPath;
              // Continue to update URL below
            } else {
              // src-attribute conflicts with recent postMessage - trust postMessage
              console.log(`Ignoring src-attribute update (conflicts with postMessage): ${extractedPath} vs ${lastPostMessagePath}`);
              return;
            }
          } else {
            // For cross-origin SPAs, src doesn't change, so we can't detect URL changes this way
            // Return early - we'll rely on postMessage or other methods
            return;
          }
        } else {
          return;
        }
      } catch (srcError) {
        console.log('Could not extract path from iframe src:', srcError);
        return;
      }
    }

    // Update parent URL if path changed - use query parameter instead of hash
    // Only update if there's an actual meaningful change
    if (iframePath !== currentIframePath) {
      console.log(`URL change detected (source: ${pathSource}): ${currentIframePath} -> ${iframePath}`);
      currentIframePath = iframePath;
      updateParentUrl(iframePath, true);
    }
  } catch (error) {
    console.error('Error updating URL from iframe:', error);
  }
}

// Start the loading timeout - auto-retries after LOADING_TIMEOUT_MS, shows error after max retries
function startLoadingTimeout() {
  clearLoadingTimeout();
  loadingTimeoutHandle = setTimeout(() => {
    if (iframeLoadCompleted || connectionFailureDetected) return;

    if (loadingRetryCount < LOADING_MAX_RETRIES) {
      loadingRetryCount++;
      console.log(`[Portal] Loading timeout (${LOADING_TIMEOUT_MS / 1000}s) - auto-retry #${loadingRetryCount}`);

      // Retry: reload the iframe with the same URL
      const iframe = document.getElementById('tunnelFrame');
      if (iframe && iframe.src) {
        const currentSrc = iframe.src;
        iframe.src = '';
        // Brief delay to force a fresh request
        setTimeout(() => {
          iframe.src = currentSrc;
          // Start timeout again for the retry attempt
          startLoadingTimeout();
        }, 100);
      } else {
        showLoadingError();
      }
    } else {
      // Max retries exhausted - show error with manual retry button
      console.log('[Portal] Loading timeout after retry - showing error');
      showLoadingError();
    }
  }, LOADING_TIMEOUT_MS);
}

// Clear the loading timeout
function clearLoadingTimeout() {
  if (loadingTimeoutHandle) {
    clearTimeout(loadingTimeoutHandle);
    loadingTimeoutHandle = null;
  }
}

// Show loading error with retry button (replaces the spinner)
function showLoadingError() {
  clearLoadingTimeout();
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;

  overlay.innerHTML = `
    <div class="error-message">
      <h1>Platform Unreachable</h1>
      <p>The platform did not respond in time. It may be temporarily unavailable.</p>
      <button class="retry-button" onclick="manualRetryLoading()">Retry</button>
    </div>
  `;
}

// Manual retry from the error button
function manualRetryLoading() {
  // Reset the loading overlay to spinner state
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.innerHTML = `
      <div class="spinner"></div>
      <p>Loading platform...</p>
    `;
    overlay.classList.remove('hidden');
  }

  // Reset retry state
  loadingRetryCount = 0;
  iframeLoadCompleted = false;

  // Reload tunnel from scratch
  loadTunnel();
}

async function loadTunnel() {
  const urlParams = new URLSearchParams(window.location.search);

  // Check for tunnelUrl parameter first (passed from gateway.html when "Prefer Portal" is checked)
  const tunnelUrlParam = urlParams.get('tunnelUrl');

  // Get current tunnel from config as fallback
  const configTunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
  const configTunnelUrl = configTunnel?.address?.replace(/\/$/, '');

  if (tunnelUrlParam) {
    const paramTunnelUrl = tunnelUrlParam.replace(/\/$/, '');

    // Check if tunnelUrl param differs from config - if so, it might be stale
    if (configTunnelUrl && paramTunnelUrl !== configTunnelUrl) {
      console.log('Tunnel URL parameter differs from config, verifying health...');
      console.log('  Parameter:', paramTunnelUrl);
      console.log('  Config:', configTunnelUrl);

      // Quick health check on the parameter URL
      const paramHealthy = await checkTunnelHealth(paramTunnelUrl);

      if (!paramHealthy) {
        console.log('Tunnel URL from parameter is not healthy, checking config URL...');
        showToast('Stale Tunnel URL', 'The bookmarked tunnel URL is outdated. Checking for current address...', 'info');

        // Check if config URL is healthy
        const configHealthy = await checkTunnelHealth(configTunnelUrl);

        if (configHealthy) {
          console.log('Config tunnel URL is healthy, using it instead');
          tunnelBaseUrl = configTunnelUrl;
          showToast('Using Current Tunnel', 'Switched to the current tunnel address from config.', 'success');
        } else {
          // Neither is healthy - use config anyway and let the retry mechanism handle it
          console.log('Neither tunnel URL is healthy, using config URL and relying on retry mechanism');
          tunnelBaseUrl = configTunnelUrl;
        }
      } else {
        // Parameter URL is healthy, use it
        tunnelBaseUrl = paramTunnelUrl;
        console.log('Using tunnel URL from parameter (verified healthy):', tunnelBaseUrl);
      }
    } else {
      // Parameter matches config or no config available - use parameter directly
      tunnelBaseUrl = paramTunnelUrl;
      console.log('Using tunnel URL from parameter:', tunnelBaseUrl);
    }
  } else {
    // Fall back to getting tunnel from config.json
    if (!configTunnel || !configTunnelUrl) {
      showError('Tunnel Not Configured', 'No cloud tunnel found in configuration.');
      return;
    }

    tunnelBaseUrl = configTunnelUrl;
    console.log('Using tunnel URL from config:', tunnelBaseUrl);
  }

  // Register all known tunnels with the service worker (if installed)
  registerTunnelsWithServiceWorker();

  // Proactive health check: if the tunnel is already down, skip iframe load
  // and go straight to the updating modal. This avoids showing "Loading platform..."
  // for 5+ seconds when the user refreshes or opens a new window during an update.
  const preloadHealthy = await checkTunnelHealth(tunnelBaseUrl);
  if (!preloadHealthy) {
    console.log('[Portal] Tunnel unhealthy on initial load, showing updating overlay immediately');
    lastHealthyTunnelAddress = tunnelBaseUrl;
    showConnectionFailure('Platform Offline', 'The platform is currently offline — an update may be in progress. Searching for a new address...');
    return;
  }

  const iframe = document.getElementById('tunnelFrame');

  // Get token from URL (token persistence not yet implemented)
  let token = urlParams.get('token');
  // Check for subpage parameter first, then returnUrl, then default to '/'
  const subpagePath = urlParams.get('subpage');
  const returnUrl = subpagePath || urlParams.get('returnUrl') || '/';
  
  // Token storage removed - not yet implemented
  // Token is only used from URL parameter if present
  
  // Build URL - token is optional
  // If token exists, use authentication endpoint; otherwise load tunnel directly (no auth required)
  let targetUrl;
  if (token) {
    // Build authentication URL with token
    // Use /auth/signin-token for one-time tokens from OAuth flow (OneTimeAuthTokenService)
    // Note: /pr-auth/signin uses PrEnvironmentTokenService which is for a different token type
    const authUrl = new URL(`${tunnelBaseUrl}/auth/signin-token`);
    authUrl.searchParams.set('token', token);
    authUrl.searchParams.set('returnUrl', returnUrl);
    targetUrl = authUrl.toString();
    console.log('Loading tunnel with authentication:', targetUrl);
  } else {
    // No token - load tunnel directly without authentication (token is optional)
    targetUrl = `${tunnelBaseUrl}${returnUrl}`;
    console.log('Loading tunnel without authentication (token not required):', targetUrl);
  }
  
  iframe.src = targetUrl;
  const targetUrlObj = new URL(targetUrl);
  currentIframePath = targetUrlObj.pathname + targetUrlObj.search + targetUrlObj.hash;

  // Start loading timeout - will auto-retry if iframe does not load in time
  startLoadingTimeout();

  // Clean up URL for bookmarking:
  // - Remove token (security: one-time tokens shouldn't stay in address bar)
  // - Remove tunnelUrl (bookmarks should always use current tunnel from config.json)
  // - Remove returnUrl (only used during token exchange)
  // - Set subpage to the current iframe path (so bookmarks restore the correct page)
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('token');
  cleanUrl.searchParams.delete('returnUrl');
  cleanUrl.searchParams.delete('tunnelUrl'); // Always remove - bookmarks should use config.json tunnel

  // Set subpage parameter for bookmarking (includes full path with query params and hash)
  if (returnUrl && returnUrl !== '/') {
    cleanUrl.searchParams.set('subpage', returnUrl);
  } else {
    cleanUrl.searchParams.delete('subpage');
  }
  cleanUrl.hash = ''; // Hash is stored in subpage, not in portal URL

  window.history.replaceState({ iframePath: returnUrl }, document.title, cleanUrl.toString());
  console.log('URL cleaned for bookmarking:', cleanUrl.toString());

  // Update currentIframePath to match
  currentIframePath = returnUrl;

  // Monitor iframe src changes (as fallback for cross-origin detection)
  let lastIframeSrc = targetUrl;
  let lastExtractedPath = extractPathFromUrl(targetUrl);
  
  function checkIframeSrcChange() {
    // Skip if we're currently updating to prevent loops
    if (isUpdatingUrl) {
      return;
    }
    
    // For cross-origin SPAs that send postMessages, ignore src changes
    // The src attribute doesn't change for client-side routing, so this would cause flickering
    if (isIframeCrossOrigin && hasReceivedPostMessage) {
      return;
    }
    
    const currentSrc = iframe.src;
    if (currentSrc && currentSrc !== lastIframeSrc) {
      lastIframeSrc = currentSrc;
      console.log('Iframe src changed to:', currentSrc);
      
      // Check if new src contains gateway.html
      if (currentSrc.includes('gateway.html')) {
        // Preserve URL params (e.g. ?link=google&returnUrl=...) when redirecting
        let gatewaySearch = '';
        try { gatewaySearch = new URL(currentSrc).search || ''; } catch (e) {}
        console.log('Iframe src contains gateway.html, redirecting whole page' + (gatewaySearch ? ' with params: ' + gatewaySearch : ''));
        redirectToGatewayWithLoopGuard(gatewaySearch);
        return;
      }
      
      // Extract path from iframe src and update parent URL
      const extractedPath = extractPathFromUrl(currentSrc);
      if (extractedPath && extractedPath !== lastExtractedPath && extractedPath !== currentIframePath) {
        lastExtractedPath = extractedPath;
        currentIframePath = extractedPath;
        updateParentUrl(extractedPath, true);
        console.log('URL updated from iframe src change:', extractedPath);
      }
    }
  }
  
  const iframeSrcObserver = new MutationObserver(() => {
    checkIframeSrcChange();
  });
  
  // Start observing iframe src attribute changes
  iframeSrcObserver.observe(iframe, {
    attributes: true,
    attributeFilter: ['src']
  });
  
  // Also poll for src changes periodically (in case MutationObserver misses some)
  // Reduced frequency to prevent flickering
  const srcCheckInterval = setInterval(checkIframeSrcChange, 1000);

  // Function to check if iframe navigated to gateway.html and redirect whole page
  function checkForSignInRedirect() {
    try {
      const iframe = document.getElementById('tunnelFrame');
      if (!iframe || !iframe.contentWindow) return false;
      
      // Skip direct location access if we already know it's cross-origin
      if (!isIframeCrossOrigin) {
        try {
          // Try to access iframe location (may fail due to cross-origin)
          const iframeLocation = iframe.contentWindow.location;
          const iframePath = iframeLocation.pathname;
          const iframeUrl = iframeLocation.href;
          
          // Check if iframe navigated to gateway.html
          if (iframePath.includes('gateway.html') || iframeUrl.includes('gateway.html')) {
            // Preserve URL params (e.g. ?link=google&returnUrl=...) when redirecting
            const gatewaySearch = iframeLocation.search || '';
            console.log('Iframe navigated to gateway.html, redirecting whole page' + (gatewaySearch ? ' with params: ' + gatewaySearch : ''));
            redirectToGatewayWithLoopGuard(gatewaySearch);
            return true;
          }
        } catch (e) {
          // Cross-origin restriction - can't access iframe location directly
          // Mark as cross-origin to avoid future attempts
          isIframeCrossOrigin = true;
          // We'll rely on postMessage or other detection methods
        }
      }
      
      // Fallback: check iframe src for gateway.html
      if (isIframeCrossOrigin) {
        const iframeSrc = iframe.src;
        if (iframeSrc && iframeSrc.includes('gateway.html')) {
          // Preserve URL params (e.g. ?link=google&returnUrl=...) when redirecting
          let gatewaySearch = '';
          try { gatewaySearch = new URL(iframeSrc).search || ''; } catch (e) {}
          console.log('Iframe src contains gateway.html, redirecting whole page' + (gatewaySearch ? ' with params: ' + gatewaySearch : ''));
          redirectToGatewayWithLoopGuard(gatewaySearch);
          return true;
        }
      }
    } catch (error) {
      console.error('Error checking for sign-in redirect:', error);
    }
    return false;
  }

  // Hide loading overlay when iframe loads
  iframe.onload = () => {
    console.log('Tunnel loaded successfully');
    if (typeof trackGatewayEvent === 'function') trackGatewayEvent('portal_tunnel_connected', { tunnelUrl: tunnelBaseUrl });

    iframeLoadCompleted = true;
    clearLoadingTimeout();

    // Reset connection failure flag if it was set (successful load clears failure state)
    if (connectionFailureDetected) {
      connectionFailureDetected = false;
      clearPersistedFailure();
      stopUpdatingTimer();
      const failureOverlay = document.getElementById('connectionFailureOverlay');
      if (failureOverlay) {
        failureOverlay.classList.add('hidden');
      }
      if (retryCountdownInterval) {
        clearInterval(retryCountdownInterval);
        retryCountdownInterval = null;
      }
    }

    // Check if iframe navigated to gateway.html
    if (checkForSignInRedirect()) {
      return; // Page is redirecting, don't continue
    }

    // Hide loading overlay
    const overlay = document.getElementById('loadingOverlay');
    setTimeout(() => {
      if (overlay) {
        overlay.classList.add('hidden');
      }
    }, 500);

    // Try to update URL from iframe location immediately
    // Use a small delay to ensure iframe content is fully loaded
    setTimeout(() => {
      updateUrlFromIframe();

      // For cross-origin iframes, request initial URL via postMessage
      if (isIframeCrossOrigin && iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ type: 'get-url' }, '*');
        } catch (e) {
          // Ignore errors - iframe might not accept messages
        }
      }

      // Send portal info to iframe so it can rewrite links for portal-aware right-click behavior
      if (iframe.contentWindow) {
        try {
          const portalBaseUrl = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '');
          iframe.contentWindow.postMessage({
            type: 'portal-info',
            portalBaseUrl: portalBaseUrl,
            portalPageUrl: window.location.origin + window.location.pathname
          }, '*');
        } catch (e) {
          // Ignore errors
        }
      }
    }, 100);

    // Run an immediate health check to catch 502/Bad Gateway responses
    // (Cloudflare 502 pages still trigger iframe.onload as valid HTML)
    checkTunnelHealth(tunnelBaseUrl).then(isHealthy => {
      if (!isHealthy && !connectionFailureDetected) {
        console.log('[Portal] Iframe loaded but tunnel is unhealthy (likely 502) - showing updating overlay');
        lastHealthyTunnelAddress = tunnelBaseUrl;
        showConnectionFailure();
      }
    });

    // Start periodic health checks now that iframe has loaded successfully
    startPeriodicHealthChecks();

    // Set up periodic URL updates and sign-in detection (for cross-origin iframes)
    const urlUpdateInterval = setInterval(() => {
      if (checkForSignInRedirect()) {
        clearInterval(urlUpdateInterval);
        clearInterval(srcCheckInterval);
        return; // Page is redirecting, stop checking
      }

      // Skip URL updates if we're currently updating to prevent loops
      if (isUpdatingUrl) {
        return;
      }

      // For cross-origin SPAs that use postMessage, skip src-attribute based updates
      if (!(isIframeCrossOrigin && hasReceivedPostMessage)) {
        updateUrlFromIframe();
      }

      // For cross-origin iframes, try to request URL update via postMessage
      if (isIframeCrossOrigin && iframe.contentWindow) {
        try {
          const randomDelay = Math.random() * 500;
          setTimeout(() => {
            if (!isUpdatingUrl && iframe.contentWindow) {
              iframe.contentWindow.postMessage({ type: 'get-url' }, '*');
            }
          }, randomDelay);
        } catch (e) {
          // Ignore errors
        }
      }
    }, 1000);
  };

  // Handle iframe load errors (e.g., network failure, DNS resolution failure)
  iframe.onerror = () => {
    console.log('[Portal] Iframe load error detected');
    clearLoadingTimeout();
    if (!connectionFailureDetected) {
      showLoadingError();
    }
  };

  // Reset load state
  iframeLoadCompleted = false;

  // Listen for postMessage from iframe (if the iframe content supports it)
  window.addEventListener('message', (event) => {
    // Verify origin for security (allow messages from tunnel or same origin)
    const isTunnelOrigin = tunnelBaseUrl && (event.origin === tunnelBaseUrl || event.origin.startsWith(tunnelBaseUrl));
    const isSameOrigin = event.origin === window.location.origin;
    
    if (!isTunnelOrigin && !isSameOrigin) {
      // Only warn if we have a tunnel base URL configured (to avoid noise during initialization)
      if (tunnelBaseUrl) {
        console.warn('Ignoring message from unauthorized origin:', event.origin);
      }
      return;
    }

    // Handle localhost proxy requests from iframe (Chrome PNA blocks localhost fetch from cross-origin iframes)
    if (event.data && event.data.type === 'proxy-localhost-fetch') {
      const { requestId, url } = event.data;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      fetch(url, { mode: 'cors', signal: controller.signal })
        .then(r => { clearTimeout(timeout); return r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(text => {
          iframe.contentWindow.postMessage({ type: 'proxy-localhost-response', requestId, success: true, data: text }, '*');
        })
        .catch(err => {
          clearTimeout(timeout);
          iframe.contentWindow.postMessage({ type: 'proxy-localhost-response', requestId, success: false, error: err.message }, '*');
        });
      return;
    }

    // Handle URL update messages from iframe - support multiple message formats
    if (event.data) {
      let newPath = null;
      let messageType = null;
      
      // Format 1: { type: 'url-change', path: '/path' }
      if (event.data.type === 'url-change') {
        newPath = event.data.path || event.data.url || '/';
        messageType = 'url-change';
      }
      // Format 2: { type: 'navigation', path: '/path' }
      else if (event.data.type === 'navigation') {
        newPath = event.data.path || event.data.url || '/';
        messageType = 'navigation';
      }
      // Format 3: { path: '/path' } (simple format)
      else if (event.data.path) {
        newPath = event.data.path;
        messageType = 'simple-path';
      }
      // Format 4: { url: '/path' } (alternative simple format)
      else if (event.data.url && typeof event.data.url === 'string') {
        // Extract path from full URL if needed
        try {
          const urlObj = new URL(event.data.url, tunnelBaseUrl || window.location.origin);
          newPath = urlObj.pathname + urlObj.search + urlObj.hash;
        } catch {
          newPath = event.data.url;
        }
        messageType = 'simple-url';
      }
      
      if (newPath) {
        // Normalize path (ensure it starts with /)
        if (!newPath.startsWith('/')) {
          newPath = '/' + newPath;
        }

        // Check if navigating to gateway.html
        if (newPath.includes('gateway.html') || (event.data.url && event.data.url.includes('gateway.html'))) {
          // Preserve URL params (e.g. ?link=google&returnUrl=...) when redirecting
          let gatewaySearch = '';
          try {
            const sourceUrl = event.data.url || newPath;
            if (sourceUrl.includes('?')) {
              gatewaySearch = sourceUrl.substring(sourceUrl.indexOf('?'));
            }
          } catch (e) {}
          console.log('PostMessage detected gateway.html navigation, redirecting whole page' + (gatewaySearch ? ' with params: ' + gatewaySearch : ''));
          redirectToGatewayWithLoopGuard(gatewaySearch);
          return;
        }

        // Reached here => the platform iframe posted a real (non-gateway) navigation,
        // i.e. authenticated content is running. That is our cross-origin success
        // signal: clear the sign-in bounce counter so a later genuine sign-in gets a
        // fresh budget.
        clearGatewayBounceCounter();

        // Apply page metadata for bookmarks/tabs (always, even if path unchanged)
        if (event.data.meta) {
          applyPageMeta(event.data.meta);
        }

        // Only update URL if path changed and we're not already updating
        if (newPath !== currentIframePath && !isUpdatingUrl) {
          console.log(`URL change detected from postMessage (${messageType}): ${currentIframePath} -> ${newPath}`);
          hasReceivedPostMessage = true; // Mark that we've received postMessages (indicates SPA)
          lastPostMessagePath = newPath;
          lastPostMessageTime = Date.now();
          currentIframePath = newPath;
          updateParentUrl(newPath, true);
        }
      }
    }
  });

  // Handle browser back/forward buttons
  window.addEventListener('popstate', (event) => {
    // Prevent handling popstate during URL updates to avoid loops
    if (isUpdatingUrl) {
      return;
    }
    
    // Read the path from query parameter or history state
    const urlParams = new URLSearchParams(window.location.search);
    const subpagePath = urlParams.get('subpage') || '/';
    const pathToNavigate = (event.state && event.state.iframePath) || subpagePath;
    
    // Only navigate if the path actually changed
    if (pathToNavigate === currentIframePath) {
      return;
    }
    
    // Set flag to prevent other update mechanisms from interfering
    isUpdatingUrl = true;
    
    // Navigate iframe to the path from history
    const iframe = document.getElementById('tunnelFrame');
    if (iframe && iframe.contentWindow) {
      try {
        const targetUrl = new URL(pathToNavigate, tunnelBaseUrl);
        
        // For cross-origin iframes, we can't check location, so just update src
        if (isIframeCrossOrigin) {
          if (iframe.src !== targetUrl.toString()) {
            iframe.src = targetUrl.toString();
            currentIframePath = pathToNavigate;
          }
        } else {
          // For same-origin, we can check and update location directly
          try {
            if (iframe.contentWindow.location.href !== targetUrl.toString()) {
              iframe.contentWindow.location.href = targetUrl.toString();
              currentIframePath = pathToNavigate;
            }
          } catch (e) {
            // If access fails, mark as cross-origin and use src fallback
            isIframeCrossOrigin = true;
            if (iframe.src !== targetUrl.toString()) {
              iframe.src = targetUrl.toString();
              currentIframePath = pathToNavigate;
            }
          }
        }
      } catch (e) {
        console.error('Error navigating iframe from history:', e);
      }
    }
    
    // Reset flag after navigation
    setTimeout(() => {
      isUpdatingUrl = false;
    }, 200);
  });

  // Timeout fallback - if iframe doesn't load within 5 seconds, run an immediate health check
  setTimeout(() => {
    if (!iframeLoadCompleted && !connectionFailureDetected) {
      console.log('[Portal] Initial load timeout (5s) - running immediate health check');
      performPeriodicHealthCheck();
    }
  }, 5000);

  // Monitor for network connectivity issues
  window.addEventListener('online', () => {
    showToast('Connection Restored', 'Network connection restored. Running health check...', 'info');
    // Run an immediate health check when coming back online
    performPeriodicHealthCheck();
  });

  window.addEventListener('offline', () => {
    if (!connectionFailureDetected) {
      showConnectionFailure('Connection Lost', 'Network connection has been lost. Please check your internet connection.');
    }
  });
}

// Space bar detection for showing history panel
function initSpaceBarHoldDetection() {
  document.addEventListener('keydown', function(e) {
    // Only trigger if space is pressed and not in an input field
    if (e.key === ' ' || e.key === 'Spacebar') {
      const target = e.target;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      if (!isInput) {
        e.preventDefault(); // Prevent page scroll
        
        // Show history panel immediately
        showHistoryPanel();
      }
    }
  });
}

// Show history panel
function showHistoryPanel() {
  const historyPanel = document.querySelector('.history-panel');
  if (historyPanel) {
    historyPanel.style.display = 'block';
    // Render history content
    if (typeof renderHistoryPanel === 'function') {
      renderHistoryPanel();
    }
  }
}

// Hide history panel
function hideHistoryPanel() {
  const historyPanel = document.querySelector('.history-panel');
  if (historyPanel) {
    historyPanel.style.display = 'none';
  }
}

// Close history panel with Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const historyPanel = document.querySelector('.history-panel');
    if (historyPanel && historyPanel.style.display === 'block') {
      hideHistoryPanel();
    }
  }
});

// Initialize: Load config first, then load tunnel
window.addEventListener('DOMContentLoaded', async () => {
  initSpaceBarHoldDetection();
  loadHealthStatus(); // fire-and-forget; offline-detection UI tolerates it not being ready yet
  const configLoaded = await loadConfig();
  if (configLoaded) {
    await loadTunnel();
  }
});

