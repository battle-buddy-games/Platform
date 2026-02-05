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

// Track iframe load state for error detection
let iframeLoadStarted = false;
let iframeLoadCompleted = false;
let iframeLoadError = false;

// Detect network errors when iframe fails to load
async function detectIframeLoadFailure(targetUrl) {
  // Wait a bit for the iframe to start loading
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // If iframe hasn't loaded and we haven't detected an error yet
  if (!iframeLoadCompleted && !iframeLoadError && iframeLoadStarted) {
    try {
      // Try to fetch the URL to check if it's accessible
      const iframe = document.getElementById('tunnelFrame');
      const testUrl = iframe?.src || targetUrl;
      if (testUrl) {
        const response = await fetch(testUrl, { 
          method: 'HEAD', 
          mode: 'no-cors',
          cache: 'no-cache'
        });
        // If we can't check due to CORS, we'll rely on other detection methods
      }
    } catch (fetchError) {
      console.error('Network error detected:', fetchError);
      if (!iframeLoadError && !connectionFailureDetected) {
        iframeLoadError = true;
        showConnectionFailure('Network Error', `Failed to connect to ${tunnelBaseUrl || 'the tunnel'}. The tunnel may be unavailable.`);
      }
    }
  }
}

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

// Check if iframe content indicates a 404 error
async function checkFor404() {
  const iframe = document.getElementById('tunnelFrame');
  if (!iframe) return false;
  
  try {
    // Try to access iframe content (may fail due to cross-origin)
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (iframeDoc) {
      // Check for common 404 indicators
      const bodyText = iframeDoc.body?.innerText?.toLowerCase() || '';
      const title = iframeDoc.title?.toLowerCase() || '';
      const url = iframe.contentWindow.location.href;
      
      if (title.includes('404') || bodyText.includes('404') || 
          bodyText.includes('not found') || bodyText.includes('page not found') ||
          url.includes('404')) {
        return true;
      }
    }
  } catch (e) {
    // Cross-origin - can't access iframe content directly
    // Try to fetch the URL directly to check for 404
    try {
      const response = await fetch(iframe.src, { method: 'HEAD', mode: 'no-cors' });
      // If we can't check due to CORS, we'll rely on other methods
    } catch (fetchError) {
      // Can't check due to CORS - assume it might be a 404 if polling is needed
    }
  }
  
  return false;
}

// Health check for tunnel address
async function checkTunnelHealth(address) {
  if (!address) return false;
  
  try {
    const healthUrl = `${address.replace(/\/$/, '')}/health`;
    const response = await fetch(healthUrl, { 
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-cache'
    });
    
    // If we get a response (even with no-cors), it's likely working
    // For CORS-restricted responses, we'll try the main URL
    return true;
  } catch (e) {
    // Try the main URL as fallback
    try {
      const response = await fetch(address, { 
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-cache'
      });
      return true;
    } catch (e2) {
      console.log(`Health check failed for ${address}:`, e2);
      return false;
    }
  }
}

// Update connection failure message with polling status
function updateConnectionFailureMessage(status) {
  const messageElement = document.getElementById('connectionFailureMessage');
  if (!messageElement || !connectionFailureDetected) return;
  
  const baseMessage = 'Failed to connect to the tunnel.';
  if (status) {
    messageElement.innerHTML = `${baseMessage}<br><br>${status}`;
  } else {
    messageElement.innerHTML = `${baseMessage}<br><br>Searching for new cloud address and checking health...`;
  }
}

// Poll config.json and check tunnel health for cloud service
async function pollConfigAndHealth() {
  try {
    // Update status message
    updateConnectionFailureMessage('Checking config.json for cloud address...');
    
    // Reload config
    const response = await fetch('./config.json?t=' + Date.now());
    if (!response.ok) {
      console.log('Failed to reload config');
      updateConnectionFailureMessage('Failed to load config.json. Retrying...');
      return false;
    }
    
    const newConfig = await response.json();
    // Update CONFIG to use in getTunnelForPreferredEnvironment
    CONFIG = newConfig;
    const cloudTunnel = getTunnelForPreferredEnvironment() || newConfig.cloudflareTunnels?.find(t => t.name === 'cloud');
    
    if (!cloudTunnel || !cloudTunnel.address) {
      console.log('No cloud tunnel in config');
      updateConnectionFailureMessage('No cloud tunnel found in config.json. Retrying...');
      return false;
    }
    
    const newAddress = cloudTunnel.address.replace(/\/$/, '');
    
    // If address changed or is different from current, check health
    if (newAddress !== currentTunnelAddress && newAddress !== tunnelBaseUrl) {
      console.log(`New cloud tunnel address found: ${newAddress}`);
      updateConnectionFailureMessage(`Found new address: ${newAddress}<br>Checking health...`);
      
      // Check health of the new address
      const isHealthy = await checkTunnelHealth(newAddress);
      
      if (isHealthy) {
        console.log(`New cloud tunnel address is healthy: ${newAddress}`);
        updateConnectionFailureMessage(`New address is healthy! Connecting...`);
        
        // If we're in connection failure mode, automatically retry with new address
        if (connectionFailureDetected) {
          console.log('Connection failure detected - automatically retrying with new healthy address');
          stopPolling();
          refreshToNewAddress(newAddress);
          return true;
        } else {
          // Otherwise show countdown (for 404 case)
          showToast('New Tunnel Found', `A new tunnel address has been detected and is ready.`, 'success');
          startCountdown(newAddress);
          return true;
        }
      } else {
        console.log(`New cloud tunnel address is not healthy yet: ${newAddress}`);
        updateConnectionFailureMessage(`New address found but not healthy yet. Retrying...`);
        return false;
      }
    } else if (newAddress === tunnelBaseUrl) {
      // Same address - check if it's now healthy
      updateConnectionFailureMessage(`Checking current address health...`);
      const isHealthy = await checkTunnelHealth(newAddress);
      if (isHealthy && connectionFailureDetected) {
        console.log('Current tunnel address is now healthy - retrying');
        updateConnectionFailureMessage(`Current address is now healthy! Connecting...`);
        stopPolling();
        retryConnection();
        return true;
      } else {
        updateConnectionFailureMessage(`Current address still not healthy. Checking for new address...`);
      }
    } else {
      updateConnectionFailureMessage(`No address change detected. Checking health...`);
    }
    
    return false;
  } catch (error) {
    console.error('Error polling config:', error);
    updateConnectionFailureMessage(`Error: ${error.message}. Retrying...`);
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
  
  // Poll every 3 seconds for faster recovery
  pollingInterval = setInterval(async () => {
    const foundHealthy = await pollConfigAndHealth();
    if (foundHealthy) {
      // pollConfigAndHealth will handle the retry, so we can stop polling
      stopPolling();
    }
  }, 3000);
  
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

// Show connection failure popup with polling for new address
function showConnectionFailure(title, message) {
  if (connectionFailureDetected) return; // Already showing failure popup

  connectionFailureDetected = true;
  const overlay = document.getElementById('connectionFailureOverlay');
  const titleElement = document.getElementById('connectionFailureTitle');
  const messageElement = document.getElementById('connectionFailureMessage');
  const pauseBtn = document.getElementById('pauseRetryBtn');
  const retryNowBtn = document.getElementById('retryNowBtn');

  if (!overlay || !messageElement) return;

  overlay.classList.remove('hidden');
  isRetryPaused = false;
  pauseBtn.textContent = 'Pause Search';

  // Update the title dynamically
  if (titleElement && title) {
    titleElement.textContent = title;
  }
  
  // Update message to indicate polling for new address
  const baseMessage = message || 'Failed to connect to the tunnel.';
  messageElement.innerHTML = `${baseMessage}<br><br>Searching for new cloud address and checking health...`;
  
  // Clear any existing retry countdown (if any)
  if (retryCountdownInterval) {
    clearInterval(retryCountdownInterval);
    retryCountdownInterval = null;
  }
  
  // Setup pause button to pause/resume polling
  pauseBtn.onclick = () => {
    isRetryPaused = !isRetryPaused;
    pauseBtn.textContent = isRetryPaused ? 'Resume Search' : 'Pause Search';
    if (isRetryPaused) {
      stopPolling();
      messageElement.innerHTML = `${baseMessage}<br><br><em>Search paused. Click "Resume Search" to continue.</em>`;
    } else {
      startPollingForCloudAddress();
      messageElement.innerHTML = `${baseMessage}<br><br>Searching for new cloud address and checking health...`;
    }
  };
  
  // Setup retry now button to retry with current address
  retryNowBtn.onclick = () => {
    retryConnection();
  };
  
  // Start polling for new cloud address immediately
  startPollingForCloudAddress();
  
  // Show toast as well
  showToast(title || 'Connection Failed', message || 'Failed to connect to the tunnel. Searching for new address...', 'error');
}

// Retry connection
function retryConnection() {
  // Stop polling if active
  stopPolling();
  
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
  iframeLoadError = false;
  iframeLoadCompleted = false;
  iframeLoadStarted = false;
  
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
  
  // Stop polling
  stopPolling();
  
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
  iframeLoadStarted = false;
  iframeLoadCompleted = false;
  iframeLoadError = false;
  
  // Reload iframe
  iframe.src = targetUrl;
  currentIframePath = subpagePath;
  
  showToast('New Address Found', 'Connecting to new cloud address...', 'success');
  
  // Show loading overlay
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    loadingOverlay.classList.remove('hidden');
  }
  
  // Restart load detection
  iframeLoadStarted = true;
  detectIframeLoadFailure(targetUrl);
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
  iframe.onload = async () => {
    console.log('Tunnel loaded successfully');
    
    // Wait a moment to check if content actually loaded (handles cases where onload fires but content fails)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if we can access the iframe content (indicates successful load)
    let contentAccessible = false;
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc && iframeDoc.body) {
        contentAccessible = true;
      }
    } catch (e) {
      // Cross-origin - can't check directly, but onload firing usually means it loaded
      // However, we should still check for errors via other means
      contentAccessible = true; // Assume accessible if cross-origin (we can't verify)
    }
    
    // If content is accessible, reset connection failure flag
    if (contentAccessible && connectionFailureDetected) {
      connectionFailureDetected = false;
      const failureOverlay = document.getElementById('connectionFailureOverlay');
      if (failureOverlay) {
        failureOverlay.classList.add('hidden');
      }
      if (retryCountdownInterval) {
        clearInterval(retryCountdownInterval);
        retryCountdownInterval = null;
      }
    }
    
    iframeLoadCompleted = true;
    
    // Check if iframe navigated to gateway.html
    if (checkForSignInRedirect()) {
      return; // Page is redirecting, don't continue
    }
    
    // Check for 404 errors
    const is404 = await checkFor404();
    if (is404) {
      console.warn('404 error detected in iframe');
      showToast('Page Not Found', 'The requested page could not be found. Searching for a new tunnel address...', 'error');
      startPolling();
      return;
    }
    
    // Check for other load failures by examining iframe content
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        // Check for error pages (common patterns)
        const bodyText = iframeDoc.body?.innerText?.toLowerCase() || '';
        const title = iframeDoc.title?.toLowerCase() || '';
        
        // Check for 502 Bad Gateway (platform offline / update in progress)
        if (bodyText.includes('502') && (bodyText.includes('bad gateway') || bodyText.includes('gateway'))) {
          showConnectionFailure('Platform Offline', 'The platform is currently offline — an update is in progress. Please wait, it will be back shortly.');
          return;
        }

        if (title.includes('error') || bodyText.includes('failed to load') ||
            bodyText.includes('connection refused') || bodyText.includes('network error') ||
            bodyText.includes('this site can\'t be reached') || bodyText.includes('dns_probe_finished_nxdomain') ||
            bodyText.includes('530') || bodyText.includes('refused to connect')) {
          showConnectionFailure('Load Error', 'The page failed to load properly. Please check your connection.');
          return;
        }
      }
    } catch (e) {
      // Cross-origin - can't check content directly
      // For cross-origin, we'll rely on console error detection and timeout
      // If onload fired but we can't verify content, wait a bit more to see if errors appear
      setTimeout(() => {
        // If we still have connection failure detected, it means errors were caught
        // Otherwise, assume it loaded successfully
        if (!connectionFailureDetected) {
          const overlay = document.getElementById('loadingOverlay');
          if (overlay) {
            overlay.classList.add('hidden');
          }
        }
      }, 2000);
      return; // Exit early for cross-origin case
    }
    
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
    }, 100);
    
    // Set up periodic URL updates and sign-in detection (for cross-origin iframes)
    // We'll also listen for postMessage events
    // Reduced frequency to prevent flickering - only check when needed
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
      // They cause flickering because src doesn't change for client-side routing
      if (!(isIframeCrossOrigin && hasReceivedPostMessage)) {
        // Only check iframe src occasionally (MutationObserver handles most cases)
        // Try to update from iframe location (less frequently now)
        updateUrlFromIframe();
      }
      
      // For cross-origin iframes, try to request URL update via postMessage
      // This works if the iframe content listens for 'get-url' messages
      // Reduced frequency to prevent excessive messages
      if (isIframeCrossOrigin && iframe.contentWindow) {
        try {
          // Only request URL update occasionally to avoid spam
          const randomDelay = Math.random() * 500; // Random delay between 0-500ms to spread out requests
          setTimeout(() => {
            if (!isUpdatingUrl && iframe.contentWindow) {
              iframe.contentWindow.postMessage({ type: 'get-url' }, '*');
            }
          }, randomDelay);
        } catch (e) {
          // Ignore errors - iframe might not accept messages
        }
      }
    }, 1000); // Reduced to 1 second to prevent flickering
  };

  // Reset load state
  iframeLoadStarted = false;
  iframeLoadCompleted = false;
  iframeLoadError = false;
  
  // Handle iframe load errors
  iframe.onerror = (event) => {
    console.error('Iframe error event:', event);
    if (!iframeLoadError && !connectionFailureDetected) {
      iframeLoadError = true;
      showConnectionFailure('Failed to Load', `Could not load page at ${tunnelBaseUrl || 'the tunnel'}. Please check if the tunnel is running.`);
    }
  };
  
  // Start failure detection
  iframeLoadStarted = true;
  detectIframeLoadFailure(targetUrl);

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

  // Timeout fallback - if iframe doesn't load within 10 seconds, show error
  setTimeout(() => {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay && !overlay.classList.contains('hidden') && !iframeLoadCompleted && !connectionFailureDetected) {
      iframeLoadError = true;
      showConnectionFailure('Loading Timeout', `The tunnel at ${tunnelBaseUrl || 'the tunnel'} is taking too long to respond. Please check if the tunnel is accessible.`);
    }
  }, 10000);
  
  // Listen for resource loading errors (works for same-origin iframes)
  // Note: Cross-origin iframes won't trigger these events, but we handle that case
  iframe.addEventListener('error', (event) => {
    console.error('Iframe resource error:', event);
    if (!iframeLoadError && !connectionFailureDetected) {
      iframeLoadError = true;
      // Check if this is a critical error (530, connection refused, etc.)
      const errorTarget = event.target || event.srcElement;
      if (errorTarget && errorTarget.tagName === 'IFRAME') {
        showConnectionFailure('Connection Error', 'Failed to connect to the tunnel. Searching for a new cloud address...');
      } else {
        showToast('Resource Error', 'Failed to load resources from the tunnel. The connection may be unstable.', 'error');
      }
    }
  }, true); // Use capture phase to catch errors
  
  // Monitor for network connectivity issues
  window.addEventListener('online', () => {
    if (iframeLoadError) {
      showToast('Connection Restored', 'Network connection has been restored. You may need to refresh the page.', 'info');
    }
  });
  
  window.addEventListener('offline', () => {
    if (!connectionFailureDetected) {
      showConnectionFailure('Connection Lost', 'Network connection has been lost. Please check your internet connection.');
    }
  });
  
  // Listen for console errors that might indicate connection failures
  // This helps catch errors like 530, X-Frame-Options, and "refused to connect"
  const originalConsoleError = console.error;
  console.error = function(...args) {
    originalConsoleError.apply(console, args);
    
    // Only intercept errors related to iframe/tunnel loading
    const errorMessage = args.join(' ').toLowerCase();
    const is502Error = errorMessage.includes('502');
    const isRelevantError = (
      is502Error ||
      errorMessage.includes('530') ||
      (errorMessage.includes('x-frame-options') && errorMessage.includes('frame')) ||
      errorMessage.includes('refused to connect') ||
      (errorMessage.includes('failed to load resource') && (errorMessage.includes('tunnel') || errorMessage.includes('cloudflare') || errorMessage.includes('trycloudflare'))) ||
      (errorMessage.includes('network error') && iframeLoadStarted)
    );

    if (isRelevantError && !connectionFailureDetected && !iframeLoadCompleted && iframeLoadStarted) {
      // Debounce to avoid multiple triggers
      setTimeout(() => {
        if (!iframeLoadCompleted && !connectionFailureDetected) {
          let failureTitle = 'Connection Error';
          let failureMessage = 'Failed to connect to the tunnel.';
          if (is502Error) {
            failureTitle = 'Platform Offline';
            failureMessage = 'The platform is currently offline — an update is in progress. Please wait, it will be back shortly.';
          } else if (errorMessage.includes('530')) {
            failureMessage = 'The tunnel server returned error 530. Searching for a new cloud address...';
          } else if (errorMessage.includes('x-frame-options')) {
            failureMessage = 'The tunnel server is blocking iframe embedding. Searching for a new cloud address...';
          } else if (errorMessage.includes('refused to connect')) {
            failureMessage = 'Connection was refused. Searching for a new cloud address...';
          } else {
            failureMessage = 'Connection failed. Searching for a new cloud address...';
          }
          showConnectionFailure(failureTitle, failureMessage);
        }
      }, 1500); // Delay to avoid false positives and allow for successful load
    }
  };
  
  // Also listen for unhandled errors related to iframe
  window.addEventListener('error', (event) => {
    // Only handle errors if they're related to our iframe
    const errorMessage = (event.message || '').toLowerCase();
    const errorSource = (event.filename || '').toLowerCase();
    const is502 = errorMessage.includes('502');
    const isIframeRelated = (
      errorSource.includes('tunnel') ||
      errorSource.includes('cloudflare') ||
      errorSource.includes('trycloudflare') ||
      (is502 && iframeLoadStarted) ||
      (errorMessage.includes('530') && iframeLoadStarted) ||
      (errorMessage.includes('refused') && iframeLoadStarted) ||
      (errorMessage.includes('failed to load') && iframeLoadStarted)
    );

    if (isIframeRelated && !connectionFailureDetected && !iframeLoadCompleted && iframeLoadStarted) {
      setTimeout(() => {
        if (!iframeLoadCompleted && !connectionFailureDetected) {
          if (is502) {
            showConnectionFailure('Platform Offline', 'The platform is currently offline — an update is in progress. Please wait, it will be back shortly.');
          } else {
            showConnectionFailure('Connection Error', 'Failed to connect to the tunnel. Please check if the tunnel is running.');
          }
        }
      }, 1500);
    }
  }, true);
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

