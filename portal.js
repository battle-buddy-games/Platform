// CONFIG is declared in gateway-shared.js which is loaded first

// Get tunnel for environment
function getTunnelForEnvironment(envName) {
  // Map environment names to tunnel names
  const tunnelNameMap = {
    'develop': 'cloud',           // Keep "cloud" for develop to maintain existing naming
    'staging': 'staging-cloud',
    'test': 'test-cloud',
    'production': 'production-cloud'  // Use production-cloud, fallback to cloud for backward compatibility
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
    const response = await fetch('./config.json');
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
  { threshold: 0,    estimate: 300,  label: 'Platform Updating',         state: 'updating' },
  { threshold: 300,  estimate: 600,  label: 'Platform Updating',         state: 'updating' },   // 5 min -> extend to 10
  { threshold: 600,  estimate: 900,  label: 'Platform Updating',         state: 'updating' },   // 10 min -> extend to 15
  { threshold: 900,  estimate: 1200, label: 'Platform Updating',         state: 'updating' },   // 15 min -> extend to 20
  { threshold: 1200, estimate: 1800, label: 'Possible Problem Detected', state: 'warning' },    // 20 min -> warning
  { threshold: 1800, estimate: null, label: 'Platform Offline',          state: 'offline' },     // 30 min -> offline
];

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

// Update the staged updating UI (called every second by the timer)
function updateUpdatingUI() {
  if (!connectionFailureDetected) return;

  updatingElapsedSeconds++;
  const stage = getUpdatingStage(updatingElapsedSeconds);

  const titleEl = document.getElementById('connectionFailureTitle');
  const messageEl = document.getElementById('connectionFailureMessage');
  const timeEl = document.getElementById('updatingTimeRemaining');
  const progressBar = document.getElementById('updatingProgressBar');
  const extraMsg = document.getElementById('updatingExtraMessage');
  const contentEl = document.querySelector('.updating-content');
  const iconEl = document.getElementById('updatingIcon');
  const countdownArea = document.getElementById('updatingCountdown');

  if (titleEl) titleEl.textContent = stage.label;

  // Compute remaining time
  if (stage.estimate !== null) {
    const remaining = Math.max(0, stage.estimate - updatingElapsedSeconds);
    if (timeEl) timeEl.textContent = formatCountdown(remaining);
    if (countdownArea) countdownArea.style.display = '';

    // Progress bar: percentage within current stage
    const stageStart = stage.threshold;
    const stageEnd = stage.estimate;
    const stageElapsed = updatingElapsedSeconds - stageStart;
    const stageDuration = stageEnd - stageStart;
    const pct = Math.min(100, (stageElapsed / stageDuration) * 100);
    if (progressBar) progressBar.style.width = pct + '%';
  } else {
    // Offline stage - no countdown
    if (timeEl) timeEl.textContent = '--:--';
    if (progressBar) progressBar.style.width = '100%';
  }

  // Update state classes
  if (contentEl) {
    contentEl.classList.remove('state-warning', 'state-offline');
    if (stage.state === 'warning') contentEl.classList.add('state-warning');
    if (stage.state === 'offline') contentEl.classList.add('state-offline');
  }

  // Update icon
  if (iconEl) {
    iconEl.textContent = stage.state === 'offline' ? '✕' : '⟳';
  }

  // Update subtitle message
  if (messageEl) {
    if (stage.state === 'updating') {
      messageEl.textContent = 'An update may be in progress. Checking for availability...';
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
    }

  } catch (error) {
    console.warn('[Health Check] Error during periodic health check:', error);
  }
}

// Start periodic health checks
function startPeriodicHealthChecks() {
  stopPeriodicHealthChecks(); // Clear any existing interval

  console.log(`[Health Check] Starting periodic health checks every ${HEALTH_CHECK_INTERVAL_MS / 1000}s`);

  // Run first health check after a delay (let iframe load first)
  setTimeout(() => {
    performPeriodicHealthCheck();
  }, HEALTH_CHECK_INTERVAL_MS);

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
  updatingElapsedSeconds = 0;
  updatingStartTime = Date.now();

  const overlay = document.getElementById('connectionFailureOverlay');
  const titleEl = document.getElementById('connectionFailureTitle');
  const messageEl = document.getElementById('connectionFailureMessage');
  const timeEl = document.getElementById('updatingTimeRemaining');
  const progressBar = document.getElementById('updatingProgressBar');
  const extraMsg = document.getElementById('updatingExtraMessage');
  const contentEl = document.querySelector('.updating-content');
  const iconEl = document.getElementById('updatingIcon');
  const retryNowBtn = document.getElementById('retryNowBtn');

  if (!overlay) return;

  // Reset to initial state
  overlay.classList.remove('hidden');
  if (contentEl) contentEl.classList.remove('state-warning', 'state-offline');
  if (titleEl) titleEl.textContent = 'Platform Updating';
  if (messageEl) messageEl.textContent = 'An update may be in progress. Checking for availability...';
  if (timeEl) timeEl.textContent = formatCountdown(300);
  if (progressBar) progressBar.style.width = '0%';
  if (extraMsg) { extraMsg.classList.add('hidden'); extraMsg.classList.remove('offline'); }
  if (iconEl) iconEl.textContent = '⟳';

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

  // Reset flags
  connectionFailureDetected = false;
  iframeLoadCompleted = false;

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

  // Reset connection failure flag
  connectionFailureDetected = false;
  
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

  // Reload iframe
  iframe.src = targetUrl;
  currentIframePath = subpagePath;

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
        console.log('Iframe navigated to gateway.html, redirecting whole page');
        window.location.href = './gateway.html';
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
        console.log('Iframe src contains gateway.html, redirecting whole page');
        window.location.href = './gateway.html';
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
            console.log('Iframe navigated to gateway.html, redirecting whole page');
            // Redirect whole page to gateway.html
            window.location.href = './gateway.html';
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
          console.log('Iframe src contains gateway.html, redirecting whole page');
          window.location.href = './gateway.html';
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

    // Reset connection failure flag if it was set (successful load clears failure state)
    if (connectionFailureDetected) {
      connectionFailureDetected = false;
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
          console.log('PostMessage detected gateway.html navigation, redirecting whole page');
          window.location.href = './gateway.html';
          return;
        }
        
        // Only update if path changed and we're not already updating
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

  // Timeout fallback - if iframe doesn't load within 15 seconds, run an immediate health check
  setTimeout(() => {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay && !overlay.classList.contains('hidden') && !iframeLoadCompleted && !connectionFailureDetected) {
      console.log('[Portal] Initial load timeout - running immediate health check');
      performPeriodicHealthCheck();
    }
  }, 15000);

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
  const configLoaded = await loadConfig();
  if (configLoaded) {
    await loadTunnel();
  }
});

