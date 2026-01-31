// gateway-callback-api.js
// API-based OAuth callback handler for provider-specific callback pages
// This replaces the redirect-based flow with an API call + UI display approach

const AUTH_API_ENDPOINTS = {
  exchangeCode: '/api/auth/exchange-code',
  signInToken: '/auth/signin-token',
  debugStep: '/api/auth/debug-step',
  githubToken: '/api/auth/github-token'
};

// State management
let authState = {
  step: 'initializing',
  provider: null,
  code: null,
  state: null,
  result: null,
  error: null,
  countdownPaused: false,
  countdownRemaining: 5,
  countdownInterval: null,
  debugEnabled: false,
  backendUrl: null
};

// Initialize callback page
async function initCallbackPage(provider) {
  authState.provider = provider;
  authState.debugEnabled = isDebugModeEnabled();

  console.log(`[CallbackAPI] Initializing ${provider} callback page, debug: ${authState.debugEnabled}`);

  // Parse URL parameters
  const params = new URLSearchParams(window.location.search);

  // Steam uses OpenID which passes openid.claimed_id, not code
  if (provider === 'steam') {
    const claimedId = params.get('openid.claimed_id');
    if (claimedId) {
      // Extract Steam ID from claimed_id URL (e.g., https://steamcommunity.com/openid/id/76561198XXXXXXXXX)
      const steamIdMatch = claimedId.match(/\/id\/(\d+)$/);
      authState.code = steamIdMatch ? steamIdMatch[1] : claimedId;
      console.log('[CallbackAPI] Extracted Steam ID:', authState.code);
    }
  } else {
    authState.code = params.get('code');
  }

  authState.state = params.get('state');

  if (authState.debugEnabled) {
    await sendDebugStep('page_loaded', {
      hasCode: !!authState.code,
      hasState: !!authState.state,
      provider: provider,
      url: window.location.href
    });
  }

  // Check for OAuth error from provider
  const error = params.get('error');
  if (error) {
    showError(error, params.get('error_description') || 'Authentication was cancelled or failed.');
    return;
  }

  // For Steam, also check openid.mode for error
  if (provider === 'steam') {
    const mode = params.get('openid.mode');
    if (mode === 'cancel' || mode === 'error') {
      showError('steam_cancelled', 'Steam authentication was cancelled or failed.');
      return;
    }
  }

  // Validate required parameters
  if (!authState.code) {
    const missingParam = provider === 'steam' ? 'Steam ID' : 'authorization code';
    showError('missing_code', `No ${missingParam} received from OAuth provider. Please try signing in again.`);
    return;
  }

  // Get backend URL
  try {
    authState.backendUrl = await getBackendUrl();
    if (!authState.backendUrl) {
      showError('config_error', 'Could not determine backend URL. Please check configuration.');
      return;
    }
    console.log('[CallbackAPI] Backend URL:', authState.backendUrl);
  } catch (e) {
    console.error('[CallbackAPI] Error getting backend URL:', e);
    showError('config_error', 'Failed to load configuration: ' + e.message);
    return;
  }

  // Start the exchange process
  await exchangeCodeForToken();
}

// Exchange OAuth code for one-time token via API
async function exchangeCodeForToken() {
  updateUI('exchanging', 'Exchanging authorization code with server...');

  if (authState.debugEnabled) {
    await sendDebugStep('exchange_started', { provider: authState.provider });
  }

  // Check if this is a link mode request (linking OAuth provider to existing account)
  // Link mode is encoded in state as "link:{provider}:{randomState}" or can be in localStorage
  let linkMode = false;
  let linkReturnUrl = null;

  // Check state for link mode encoding
  if (authState.state && authState.state.startsWith('link:')) {
    linkMode = true;
    console.log('[CallbackAPI] Link mode detected from state:', authState.state);
  }

  // Also check localStorage (set by gateway.html when coming from profile linking)
  try {
    if (localStorage.getItem('linkingModeEnabled') === 'true' || localStorage.getItem('oauth_link_mode') === 'true') {
      linkMode = true;
      linkReturnUrl = localStorage.getItem('oauth_return_url');
      console.log('[CallbackAPI] Link mode detected from localStorage, returnUrl:', linkReturnUrl);
    }
  } catch (e) {
    console.warn('[CallbackAPI] Error checking localStorage for link mode:', e);
  }

  // Get stored gateway token for account linking (cross-origin auth)
  // Since cookies don't work cross-origin, we pass the token directly
  let linkToken = null;
  if (linkMode) {
    try {
      linkToken = localStorage.getItem('bb_gateway_token');
      if (linkToken) {
        console.log('[CallbackAPI] Link mode: found stored gateway token for account linking');
      } else {
        console.warn('[CallbackAPI] Link mode: no stored gateway token found, linking may fail');
      }
    } catch (e) {
      console.warn('[CallbackAPI] Error getting gateway token for link mode:', e);
    }
  }

  try {
    const requestBody = {
      code: authState.code,
      provider: authState.provider,
      state: authState.state,
      redirectUri: getRedirectUri(),
      debugEnabled: authState.debugEnabled,
      linkMode: linkMode,
      linkReturnUrl: linkReturnUrl,
      linkToken: linkToken  // Pass stored token for cross-origin account linking
    };

    console.log('[CallbackAPI] Sending exchange request:', {
      ...requestBody,
      code: requestBody.code ? requestBody.code.substring(0, 10) + '...' : null
    });

    const response = await fetch(`${authState.backendUrl}${AUTH_API_ENDPOINTS.exchangeCode}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'include', // Required for cross-origin cookies (session auth for account linking)
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    authState.result = result;

    console.log('[CallbackAPI] Exchange response:', {
      success: result.success,
      error: result.error,
      hasToken: !!result.token,
      username: result.userInfo?.username
    });

    if (result.success) {
      if (authState.debugEnabled) {
        await sendDebugStep('exchange_success', {
          username: result.userInfo?.username,
          isNewUser: result.userInfo?.isNewUser,
          expiresIn: result.expiresIn
        });
      }
      showSuccess(result);
    } else {
      if (authState.debugEnabled) {
        await sendDebugStep('exchange_failed', {
          error: result.error,
          description: result.errorDescription
        });
      }
      showError(result.error || 'unknown_error', result.errorDescription || 'Authentication failed.');
    }
  } catch (error) {
    console.error('[CallbackAPI] Exchange error:', error);
    if (authState.debugEnabled) {
      await sendDebugStep('exchange_exception', { message: error.message });
    }
    showError('network_error', `Failed to communicate with authentication server: ${error.message}`);
  }
}

// Update UI to show current step
function updateUI(step, message) {
  authState.step = step;

  const statusElement = document.getElementById('authStatus');
  const messageElement = document.getElementById('authMessage');
  const spinnerElement = document.querySelector('.spinner');
  const resultContainer = document.getElementById('resultContainer');
  const countdownContainer = document.getElementById('countdownContainer');
  const successSection = document.getElementById('successSection');
  const errorSection = document.getElementById('errorSection');

  // Update main status
  if (spinnerElement) spinnerElement.style.display = step === 'exchanging' ? 'block' : 'none';
  if (statusElement) statusElement.textContent = getStepTitle(step);
  if (messageElement) messageElement.textContent = message;

  // Show/hide sections
  if (resultContainer) resultContainer.style.display = (step === 'success' || step === 'error') ? 'block' : 'none';
  if (successSection) successSection.style.display = step === 'success' ? 'block' : 'none';
  if (errorSection) errorSection.style.display = step === 'error' ? 'block' : 'none';
  if (countdownContainer) countdownContainer.style.display = step === 'success' ? 'block' : 'none';
}

function getStepTitle(step) {
  const providerName = authState.provider ? authState.provider.charAt(0).toUpperCase() + authState.provider.slice(1) : 'Provider';
  switch (step) {
    case 'initializing': return `Initializing ${providerName} Authentication...`;
    case 'exchanging': return `Authenticating with ${providerName}...`;
    case 'success': return 'Authentication Successful!';
    case 'error': return 'Authentication Failed';
    default: return 'Processing...';
  }
}

// Show success result
function showSuccess(result) {
  // Check if this was link mode and update the message accordingly
  let isLinkMode = false;
  try {
    isLinkMode = localStorage.getItem('linkingModeEnabled') === 'true' || localStorage.getItem('oauth_link_mode') === 'true';
  } catch (e) {}

  // Check if this is a long token response (createToken mode)
  const hasLongToken = result.hasLongToken && result.longToken;

  let successMessage;
  if (hasLongToken) {
    successMessage = 'Long-lived token created! Save your token below before continuing.';
  } else if (isLinkMode) {
    successMessage = 'Account successfully linked! You will be redirected shortly.';
  } else {
    successMessage = 'Your account has been authenticated. You will be redirected shortly.';
  }
  updateUI('success', successMessage);

  // Clean up link mode localStorage items after successful authentication
  try {
    localStorage.removeItem('linkingModeEnabled');
    localStorage.removeItem('oauth_link_mode');
    localStorage.removeItem('oauth_link_provider');
    // Keep oauth_return_url until redirect completes
  } catch (e) {
    console.warn('[CallbackAPI] Error cleaning up link mode localStorage:', e);
  }

  // Display user info
  const userInfoElement = document.getElementById('userInfo');
  if (userInfoElement && result.userInfo) {
    const ui = result.userInfo;
    userInfoElement.innerHTML = `
      <div class="user-info-card">
        ${ui.avatarUrl ? `<img src="${escapeHtml(ui.avatarUrl)}" alt="Avatar" class="avatar" />` : '<div class="avatar-placeholder"></div>'}
        <div class="user-details">
          <div class="username">${escapeHtml(ui.username || 'Unknown')}</div>
          ${ui.email ? `<div class="email">${escapeHtml(ui.email)}</div>` : ''}
          <div class="provider">via ${escapeHtml(ui.provider || authState.provider)}</div>
          ${ui.isNewUser ? '<div class="badge new-user">New Account Created</div>' : '<div class="badge returning">Welcome Back</div>'}
        </div>
      </div>
    `;
  }

  // Display token info with copy button
  const tokenInfoElement = document.getElementById('tokenInfo');
  if (tokenInfoElement) {
    // If we have a long token, show the long token UI prominently
    if (hasLongToken) {
      const longTokenExpiry = result.longTokenExpiresAt ? new Date(result.longTokenExpiresAt) : null;
      const expiryDisplay = longTokenExpiry
        ? `${longTokenExpiry.toLocaleDateString()} ${longTokenExpiry.toLocaleTimeString()}`
        : '30 days from now';

      tokenInfoElement.innerHTML = `
        <div class="info-section" style="background: rgba(76, 175, 80, 0.1); border-color: rgba(76, 175, 80, 0.3);">
          <h3 style="color: #81c784;">Long-Lived Remember Token</h3>
          <p style="font-size: 12px; color: rgba(255, 255, 255, 0.7); margin-bottom: 12px;">
            Save this token securely - you can use it for future sign-ins without going through OAuth.
            <strong style="color: #ffb74d;">This is the only time you'll see this token.</strong>
          </p>
          <div class="info-row" style="flex-wrap: wrap;">
            <span class="label">Token:</span>
            <span class="value mono" style="word-break: break-all; font-size: 11px;">${escapeHtml(result.longToken)}</span>
          </div>
          <button class="copy-btn full-width" onclick="copyToClipboard('${escapeHtml(result.longToken)}', this)" style="background: rgba(76, 175, 80, 0.2); border-color: rgba(76, 175, 80, 0.4); color: #81c784; margin-top: 8px;">
            Copy Long Token to Clipboard
          </button>
          <div class="info-row" style="margin-top: 12px;">
            <span class="label">Expires:</span>
            <span class="value">${expiryDisplay}</span>
          </div>
          <div class="info-row">
            <span class="label">Provider:</span>
            <span class="value">${escapeHtml(result.userInfo?.provider || authState.provider)}</span>
          </div>
          <div class="info-row">
            <span class="label">User:</span>
            <span class="value">${escapeHtml(result.userInfo?.username || 'Unknown')}</span>
          </div>
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: rgba(255, 255, 255, 0.8);">
              <input type="checkbox" id="saveLongTokenCheckbox" style="width: 16px; height: 16px;">
              <span>Save token to browser for auto sign-in</span>
            </label>
            <p style="font-size: 11px; color: rgba(255, 255, 255, 0.5); margin-top: 4px; margin-left: 24px;">
              Token will be stored in browser localStorage for convenient sign-in on this device.
            </p>
          </div>
        </div>
        <div class="info-section" style="margin-top: 12px;">
          <h3>Session Token (One-Time)</h3>
          <div class="info-row">
            <span class="label">Token:</span>
            <span class="value mono">${escapeHtml(result.token?.substring(0, 24) + '...')}</span>
            <button class="copy-btn" onclick="copyToClipboard('${escapeHtml(result.token)}', this)">Copy</button>
          </div>
        </div>
      `;

      // Store long token reference for later (will be saved to localStorage if checkbox is checked)
      authState.longToken = result.longToken;
      authState.longTokenExpiresAt = result.longTokenExpiresAt;
    } else if (result.token) {
      const tokenPreview = result.token.substring(0, 24) + '...';
      const expiresIn = result.expiresIn || 900;
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      tokenInfoElement.innerHTML = `
        <div class="info-section">
          <h3>Authentication Details</h3>
          <div class="info-row">
            <span class="label">One-Time Token:</span>
            <span class="value mono">${escapeHtml(tokenPreview)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${escapeHtml(result.token)}', this)">Copy</button>
          </div>
          <div class="info-row">
            <span class="label">Token Expires:</span>
            <span class="value">${expiresAt.toLocaleTimeString()} (${Math.floor(expiresIn / 60)} min)</span>
          </div>
          <div class="info-row">
            <span class="label">Provider:</span>
            <span class="value">${escapeHtml(result.userInfo?.provider || authState.provider)}</span>
          </div>
          <div class="info-row">
            <span class="label">User ID:</span>
            <span class="value mono">${escapeHtml(result.userInfo?.userId || 'N/A')}</span>
            <button class="copy-btn" onclick="copyToClipboard('${escapeHtml(result.userInfo?.userId || '')}', this)">Copy</button>
          </div>
        </div>
      `;
    }
  }

  // Start countdown to redirect (longer countdown for long token to give user time to save)
  const countdownTime = hasLongToken ? 15 : 5;
  startRedirectCountdown(result.token, countdownTime);
}

// Show error result
function showError(error, description) {
  updateUI('error', description || 'An error occurred during authentication.');

  const errorInfoElement = document.getElementById('errorInfo');
  if (errorInfoElement) {
    const errorDetails = JSON.stringify({
      error: error,
      description: description,
      provider: authState.provider,
      timestamp: new Date().toISOString(),
      url: window.location.href
    }, null, 2);

    errorInfoElement.innerHTML = `
      <div class="error-card">
        <div class="error-icon">
          <svg viewBox="0 0 24 24" width="48" height="48">
            <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
        </div>
        <div class="error-code">${escapeHtml(error)}</div>
        <div class="error-description">${escapeHtml(description || 'Unknown error')}</div>
        <div class="error-details">
          <button class="copy-btn full-width" onclick="copyToClipboard(\`${escapeHtml(errorDetails)}\`, this)">Copy Error Details</button>
        </div>
        <div class="error-actions">
          <button onclick="retryAuth()" class="btn-primary">Try Again</button>
          <button onclick="window.location.href='./gateway.html'" class="btn-secondary">Back to Sign In</button>
        </div>
      </div>
    `;
  }
}

// Countdown management
function startRedirectCountdown(token, countdownSeconds = 5) {
  authState.countdownRemaining = countdownSeconds;
  authState.countdownPaused = false;

  updateCountdownDisplay();
  updatePausePlayButton(false);

  authState.countdownInterval = setInterval(() => {
    if (authState.countdownPaused) return;

    authState.countdownRemaining--;
    updateCountdownDisplay();

    if (authState.countdownRemaining <= 0) {
      clearInterval(authState.countdownInterval);
      authState.countdownInterval = null;

      // Before redirecting, check if we should save the long token
      saveLongTokenIfChecked();

      performRedirect(token);
    }
  }, 1000);
}

// Save long token to localStorage if user checked the save checkbox
function saveLongTokenIfChecked() {
  try {
    const checkbox = document.getElementById('saveLongTokenCheckbox');
    if (checkbox && checkbox.checked && authState.longToken) {
      const tokenData = {
        token: authState.longToken,
        expiresAt: authState.longTokenExpiresAt,
        provider: authState.provider,
        username: authState.result?.userInfo?.username,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem('bb_long_remember_token', JSON.stringify(tokenData));
      console.log('[CallbackAPI] Long token saved to localStorage');
    }
  } catch (e) {
    console.warn('[CallbackAPI] Failed to save long token to localStorage:', e);
  }
}

function updateCountdownDisplay() {
  const countdownElement = document.getElementById('countdownSeconds');
  const countdownText = document.getElementById('countdownText');
  if (countdownElement) {
    countdownElement.textContent = authState.countdownRemaining;
  }
  if (countdownText) {
    countdownText.textContent = authState.countdownRemaining;
  }
}

function updatePausePlayButton(isPaused) {
  const pauseIcon = document.getElementById('pauseIcon');
  const playIcon = document.getElementById('playIcon');
  const pauseText = document.getElementById('pausePlayText');

  if (pauseIcon && playIcon && pauseText) {
    if (isPaused) {
      pauseIcon.style.display = 'none';
      playIcon.style.display = 'inline';
      pauseText.textContent = 'Resume';
    } else {
      pauseIcon.style.display = 'inline';
      playIcon.style.display = 'none';
      pauseText.textContent = 'Pause';
    }
  }
}

// Global functions for button handlers
window.toggleCountdown = function() {
  authState.countdownPaused = !authState.countdownPaused;
  updatePausePlayButton(authState.countdownPaused);
  console.log('[CallbackAPI] Countdown', authState.countdownPaused ? 'paused' : 'resumed');
};

window.skipCountdown = function() {
  if (authState.countdownInterval) {
    clearInterval(authState.countdownInterval);
    authState.countdownInterval = null;
  }
  if (authState.result?.token) {
    performRedirect(authState.result.token);
  }
};

window.cancelRedirect = function() {
  if (authState.countdownInterval) {
    clearInterval(authState.countdownInterval);
    authState.countdownInterval = null;
  }

  const countdownContainer = document.getElementById('countdownContainer');
  const messageElement = document.getElementById('authMessage');

  if (countdownContainer) countdownContainer.style.display = 'none';
  if (messageElement) messageElement.textContent = 'Redirect cancelled. You can close this page or use the buttons below.';

  // Show manual redirect option
  const tokenInfoElement = document.getElementById('tokenInfo');
  if (tokenInfoElement && authState.result?.token) {
    const redirectUrl = buildRedirectUrl(authState.result.token);
    tokenInfoElement.innerHTML += `
      <div class="info-row manual-redirect">
        <button onclick="window.location.href='${escapeHtml(redirectUrl)}'" class="btn-primary">
          Continue to Platform Manually
        </button>
      </div>
    `;
  }
};

async function performRedirect(token) {
  if (authState.debugEnabled) {
    await sendDebugStep('redirect_started', { hasToken: !!token });
  }

  const redirectUrl = buildRedirectUrl(token);
  console.log('[CallbackAPI] Redirecting to:', redirectUrl);

  window.location.href = redirectUrl;
}

function buildRedirectUrl(token) {
  // Check if this is link mode - link mode should always go through the backend
  // to set the session cookie and then redirect back to the profile page
  let isLinkMode = false;
  let linkReturnUrl = null;
  try {
    isLinkMode = localStorage.getItem('linkingModeEnabled') === 'true' || localStorage.getItem('oauth_link_mode') === 'true';
    linkReturnUrl = localStorage.getItem('oauth_return_url');
  } catch (e) {}

  if (isLinkMode && linkReturnUrl) {
    // Link mode: go through backend to set cookie, then redirect to profile page
    console.log('[CallbackAPI] Link mode - redirecting to backend with returnUrl:', linkReturnUrl);
    // Clean up the return URL after reading it
    try { localStorage.removeItem('oauth_return_url'); } catch (e) {}
    return `${authState.backendUrl}${AUTH_API_ENDPOINTS.signInToken}?token=${encodeURIComponent(token)}&returnUrl=${encodeURIComponent(linkReturnUrl)}`;
  }

  // Check if preferPortal is enabled - if so, redirect directly to portal with token
  // This ensures the token exchange happens inside the iframe, where the cookie can be set
  // Going through the backend first sets the cookie on the wrong domain for cross-origin iframes
  try {
    const preferPortal = localStorage.getItem('preferPortal') === 'true';
    if (preferPortal) {
      // Get tunnel URL from stored OAuth attempt or config
      let tunnelUrl = null;
      try {
        const oauthAttempt = sessionStorage.getItem('oauthSignInAttempt');
        if (oauthAttempt) {
          const parsed = JSON.parse(oauthAttempt);
          tunnelUrl = parsed.tunnelUrl;
        }
      } catch (e) {}

      // Fallback to config if no stored tunnel
      if (!tunnelUrl && window.CONFIG?.cloudflareTunnels) {
        const tunnel = window.CONFIG.cloudflareTunnels.find(t => t.name === 'cloud');
        if (tunnel) {
          tunnelUrl = tunnel.address?.replace(/\/$/, '');
        }
      }

      if (tunnelUrl) {
        // Build portal URL with token - portal will pass token to iframe for authentication
        const currentUrl = new URL(window.location.href);
        const basePath = currentUrl.pathname.substring(0, currentUrl.pathname.lastIndexOf('/') + 1);
        const portalUrl = new URL(`${currentUrl.origin}${basePath}portal.html`);
        portalUrl.searchParams.set('tunnelUrl', tunnelUrl);
        portalUrl.searchParams.set('token', token);
        console.log('[CallbackAPI] Prefer portal enabled, redirecting to portal with token:', portalUrl.toString());
        return portalUrl.toString();
      }
    }
  } catch (e) {
    console.warn('[CallbackAPI] Error checking preferPortal setting:', e);
  }

  // Default: go through backend signin-token endpoint
  const returnUrl = getReturnUrl();
  return `${authState.backendUrl}${AUTH_API_ENDPOINTS.signInToken}?token=${encodeURIComponent(token)}&returnUrl=${encodeURIComponent(returnUrl)}`;
}

// Debug logging
async function sendDebugStep(step, data = {}) {
  if (!authState.debugEnabled) return;

  try {
    const backendUrl = authState.backendUrl || await getBackendUrl();
    if (!backendUrl) return;

    const requestBody = {
      step,
      provider: authState.provider,
      page: getPageName(),
      data,
      debugEnabled: true
    };

    // Use sendBeacon for reliability (doesn't block navigation)
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(requestBody)], { type: 'application/json' });
      navigator.sendBeacon(`${backendUrl}${AUTH_API_ENDPOINTS.debugStep}`, blob);
    } else {
      await fetch(`${backendUrl}${AUTH_API_ENDPOINTS.debugStep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        keepalive: true
      });
    }

    console.log('[CallbackAPI] Debug step sent:', step, data);
  } catch (e) {
    console.warn('[CallbackAPI] Failed to send debug step:', e);
  }
}

// Utility functions
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

window.copyToClipboard = function(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
    }, 2000);
  }).catch(err => {
    console.error('[CallbackAPI] Copy failed:', err);
    // Fallback
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = 'Copy'; }, 2000);
    } catch (e) {
      alert('Failed to copy. Value: ' + text);
    }
    document.body.removeChild(textArea);
  });
};

function retryAuth() {
  // Clear state and redirect to gateway
  try {
    sessionStorage.removeItem('oauthSignInAttempt');
  } catch (e) {}
  window.location.href = './gateway.html';
}

async function getBackendUrl() {
  // Wait for CONFIG if needed (from gateway-shared.js)
  if (typeof loadConfig === 'function' && (!window.CONFIG || !window.CONFIG.cloudflareTunnels)) {
    await loadConfig();
  }

  const config = window.CONFIG;
  if (!config || !config.cloudflareTunnels) {
    console.error('[CallbackAPI] CONFIG not available');
    return null;
  }

  // Try to get stored tunnel from OAuth attempt
  let tunnelUrl = null;
  try {
    const oauthAttempt = sessionStorage.getItem('oauthSignInAttempt');
    if (oauthAttempt) {
      const parsed = JSON.parse(oauthAttempt);
      if (parsed.tunnelUrl) {
        tunnelUrl = parsed.tunnelUrl;
        console.log('[CallbackAPI] Using stored tunnel URL:', tunnelUrl);
      }
    }
  } catch (e) {
    console.warn('[CallbackAPI] Could not parse stored OAuth attempt:', e);
  }

  // Fallback to config
  if (!tunnelUrl) {
    const tunnel = config.cloudflareTunnels.find(t => t.name === 'cloud');
    if (tunnel) {
      tunnelUrl = tunnel.address;
      console.log('[CallbackAPI] Using tunnel from config:', tunnelUrl);
    }
  }

  return tunnelUrl ? tunnelUrl.replace(/\/$/, '') : null;
}

function getRedirectUri() {
  const currentUrl = new URL(window.location.href);
  return `${currentUrl.origin}${currentUrl.pathname}`;
}

function getReturnUrl() {
  // Check if this is link mode - link mode has its own return URL (back to profile page)
  try {
    const linkReturnUrl = localStorage.getItem('oauth_return_url');
    const isLinkMode = localStorage.getItem('linkingModeEnabled') === 'true' || localStorage.getItem('oauth_link_mode') === 'true';
    if (isLinkMode && linkReturnUrl) {
      console.log('[CallbackAPI] Link mode return URL:', linkReturnUrl);
      return linkReturnUrl;
    }
  } catch (e) {
    console.warn('[CallbackAPI] Error checking link mode return URL:', e);
  }

  // Check URL param first
  const params = new URLSearchParams(window.location.search);
  const urlReturnUrl = params.get('returnUrl');
  if (urlReturnUrl) return urlReturnUrl;

  // Check stored OAuth attempt
  try {
    const oauthAttempt = sessionStorage.getItem('oauthSignInAttempt');
    if (oauthAttempt) {
      const parsed = JSON.parse(oauthAttempt);
      if (parsed.returnUrl) return parsed.returnUrl;
    }
  } catch (e) {}

  // Check if preferPortal is enabled - if so, return portal.html with tunnelUrl
  try {
    const preferPortal = localStorage.getItem('preferPortal') === 'true';
    if (preferPortal) {
      // Get tunnel URL from stored OAuth attempt or config
      let tunnelUrl = null;
      try {
        const oauthAttempt = sessionStorage.getItem('oauthSignInAttempt');
        if (oauthAttempt) {
          const parsed = JSON.parse(oauthAttempt);
          tunnelUrl = parsed.tunnelUrl;
        }
      } catch (e) {}

      // Fallback to config if no stored tunnel
      if (!tunnelUrl && window.CONFIG?.cloudflareTunnels) {
        const tunnel = window.CONFIG.cloudflareTunnels.find(t => t.name === 'cloud');
        if (tunnel) {
          tunnelUrl = tunnel.address?.replace(/\/$/, '');
        }
      }

      if (tunnelUrl) {
        // Build portal URL on the same origin as the callback page
        const currentUrl = new URL(window.location.href);
        const basePath = currentUrl.pathname.substring(0, currentUrl.pathname.lastIndexOf('/') + 1);
        const portalUrl = new URL(`${currentUrl.origin}${basePath}portal.html`);
        portalUrl.searchParams.set('tunnelUrl', tunnelUrl);
        console.log('[CallbackAPI] Prefer portal enabled, returning portal URL:', portalUrl.toString());
        return portalUrl.toString();
      }
    }
  } catch (e) {
    console.warn('[CallbackAPI] Error checking preferPortal setting:', e);
  }

  // Default to home
  return '/';
}

function getPageName() {
  return window.location.pathname.split('/').pop() || 'unknown';
}

function isDebugModeEnabled() {
  try {
    return localStorage.getItem('gateway_debug_mode') === 'true';
  } catch (e) {
    return false;
  }
}

// GitHub Personal Access Token authentication
async function authenticateWithGitHubToken(token) {
  authState.provider = 'github';
  authState.debugEnabled = isDebugModeEnabled();

  console.log('[CallbackAPI] Authenticating with GitHub PAT');

  if (!token) {
    return {
      success: false,
      error: 'missing_token',
      errorDescription: 'GitHub token is required'
    };
  }

  // Get backend URL
  try {
    authState.backendUrl = await getBackendUrl();
    if (!authState.backendUrl) {
      return {
        success: false,
        error: 'config_error',
        errorDescription: 'Could not determine backend URL.'
      };
    }
  } catch (e) {
    return {
      success: false,
      error: 'config_error',
      errorDescription: 'Failed to load configuration: ' + e.message
    };
  }

  if (authState.debugEnabled) {
    await sendDebugStep('github_token_auth_started', { hasToken: true });
  }

  try {
    const response = await fetch(`${authState.backendUrl}${AUTH_API_ENDPOINTS.githubToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        token: token,
        debugEnabled: authState.debugEnabled
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    authState.result = result;

    console.log('[CallbackAPI] GitHub token auth response:', {
      success: result.success,
      error: result.error,
      hasToken: !!result.token,
      username: result.userInfo?.username
    });

    if (result.success && authState.debugEnabled) {
      await sendDebugStep('github_token_auth_success', {
        username: result.userInfo?.username,
        isNewUser: result.userInfo?.isNewUser
      });
    }

    return result;
  } catch (error) {
    console.error('[CallbackAPI] GitHub token auth error:', error);
    if (authState.debugEnabled) {
      await sendDebugStep('github_token_auth_exception', { message: error.message });
    }
    return {
      success: false,
      error: 'network_error',
      errorDescription: `Failed to communicate with authentication server: ${error.message}`
    };
  }
}

// Redirect to sign in with a one-time token
async function redirectToSignIn(token, returnUrl) {
  if (!authState.backendUrl) {
    authState.backendUrl = await getBackendUrl();
  }

  const redirectUrl = `${authState.backendUrl}${AUTH_API_ENDPOINTS.signInToken}?token=${encodeURIComponent(token)}&returnUrl=${encodeURIComponent(returnUrl || '/')}`;
  console.log('[CallbackAPI] Redirecting to sign-in:', redirectUrl);

  window.location.href = redirectUrl;
}

// Export for use in HTML
window.initCallbackPage = initCallbackPage;
window.authState = authState;
window.authenticateWithGitHubToken = authenticateWithGitHubToken;
window.redirectToSignIn = redirectToSignIn;
