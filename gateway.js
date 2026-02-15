// Gateway-specific JavaScript
// Note: CONFIG is declared in gateway-shared.js, do not redeclare it here

// Store original sign-in HTML for restoration
let originalSignInHTML = null;

// Track cloud service health status for button enabling/disabling
let isCloudServiceHealthy = false;

// Update sign-in button states based on cloud service health
function updateSignInButtonStates() {
  // Select all auth buttons in the main sign-in container
  const noSignInContainer = document.getElementById('noSignInContainer');
  if (!noSignInContainer) return;

  const authButtons = noSignInContainer.querySelectorAll('.auth-button');
  const storedTokenButton = document.querySelector('#storedTokenSignInContainer .auth-button');

  // Also select SDK sign-in buttons in the More Sign In dropdown
  const sdkSignInButtons = document.querySelectorAll('.more-sign-in-menu-dropdown .auth-button[data-provider]');

  // Helper function to enable/disable a button
  function setButtonState(button, enabled) {
    if (enabled) {
      button.style.opacity = '1';
      button.style.pointerEvents = 'auto';
      button.style.cursor = 'pointer';
      button.classList.remove('disabled-health');
      button.removeAttribute('title');
    } else {
      button.style.opacity = '0.5';
      button.style.pointerEvents = 'none';
      button.style.cursor = 'not-allowed';
      button.classList.add('disabled-health');
      button.setAttribute('title', 'Cloud service unavailable - please wait for health check to pass');
    }
  }

  authButtons.forEach(button => {
    const provider = button.getAttribute('data-provider');
    // Skip external links and non-sign-in buttons
    if (!provider) return;
    setButtonState(button, isCloudServiceHealthy);
  });

  // Also handle SDK sign-in buttons in More Sign In dropdown
  sdkSignInButtons.forEach(button => {
    setButtonState(button, isCloudServiceHealthy);
  });

  // Also handle the stored token button if visible
  if (storedTokenButton) {
    setButtonState(storedTokenButton, isCloudServiceHealthy);
  }

  // Also handle remembered tokens sign-in buttons
  const rememberedTokenSignInButtons = document.querySelectorAll('.remembered-token-signin-btn');
  rememberedTokenSignInButtons.forEach(button => {
    setButtonState(button, isCloudServiceHealthy);
  });

  // Also handle the clickable left section of remembered tokens (which triggers sign-in)
  const rememberedTokenClickables = document.querySelectorAll('.remembered-token-clickable');
  rememberedTokenClickables.forEach(clickable => {
    if (isCloudServiceHealthy) {
      clickable.style.opacity = '1';
      clickable.style.pointerEvents = 'auto';
      clickable.style.cursor = 'pointer';
    } else {
      clickable.style.opacity = '0.5';
      clickable.style.pointerEvents = 'none';
      clickable.style.cursor = 'not-allowed';
    }
  });

  // Update a visual indicator for user feedback
  const tokenStatusContainer = document.getElementById('tokenStatusContainer');
  const statusText = document.getElementById('tokenStatusText');
  if (tokenStatusContainer && statusText) {
    const currentText = statusText.textContent;
    if (!isCloudServiceHealthy) {
      // Only update if showing initial message or already showing cloud service message
      if (currentText === 'Checking for saved sign-in...' || currentText.includes('Cloud service')) {
        statusText.textContent = 'Cloud service unavailable - sign-in disabled';
        statusText.style.color = 'rgba(255, 150, 100, 0.8)';
      }
    } else {
      // Service is healthy - restore normal status if showing cloud service message
      if (currentText.includes('Cloud service unavailable')) {
        statusText.textContent = 'Cloud service available - sign-in enabled';
        statusText.style.color = 'rgba(100, 255, 100, 0.8)';
        // Clear the message after a short delay
        setTimeout(() => {
          const currentStatus = document.getElementById('tokenStatusText');
          if (currentStatus && currentStatus.textContent === 'Cloud service available - sign-in enabled') {
            currentStatus.textContent = 'No saved sign-in found';
            currentStatus.style.color = 'rgba(255, 255, 255, 0.6)';
          }
        }, 2000);
      }
    }
  }
}

// Switch between Releases and Health tabs in the status panel
window.switchStatusTab = function switchStatusTab(tabName) {
  const releasesContent = document.getElementById('statusTabReleases');
  const healthContent = document.getElementById('statusTabHealth');
  const tabs = document.querySelectorAll('.status-panel-tab');

  tabs.forEach(function(tab) {
    if (tab.getAttribute('data-tab') === tabName) {
      tab.classList.add('active');
      tab.style.borderBottomColor = 'rgba(102, 126, 234, 0.9)';
      tab.style.color = 'rgba(255, 255, 255, 0.9)';
    } else {
      tab.classList.remove('active');
      tab.style.borderBottomColor = 'transparent';
      tab.style.color = 'rgba(255, 255, 255, 0.45)';
    }
  });

  if (tabName === 'releases') {
    if (releasesContent) releasesContent.style.display = '';
    if (healthContent) healthContent.style.display = 'none';
  } else {
    if (releasesContent) releasesContent.style.display = 'none';
    if (healthContent) healthContent.style.display = '';
  }
};

// Get combined health status text and class for the health badge
function getHealthBadgeState() {
  // Check all three service status indicators
  const cloudStatus = document.getElementById('cloudServiceStatus');
  const agentStatus = document.getElementById('agentStatusStatus');
  const signalrStatus = document.getElementById('signalrStatus');

  const cloudHealthy = cloudStatus && cloudStatus.style.background && cloudStatus.style.background.indexOf('100, 255, 100') !== -1;
  const agentHealthy = agentStatus && agentStatus.style.background && agentStatus.style.background.indexOf('100, 255, 100') !== -1;
  const signalrHealthy = signalrStatus && signalrStatus.style.background && signalrStatus.style.background.indexOf('100, 255, 100') !== -1;

  // If none have been checked yet (all still default background)
  const cloudChecked = cloudStatus && cloudStatus.style.background && cloudStatus.style.background !== 'rgba(255, 255, 255, 0.2)';
  const agentChecked = agentStatus && agentStatus.style.background && agentStatus.style.background !== 'rgba(255, 255, 255, 0.2)';

  if (!cloudChecked && !agentChecked) {
    return { cssClass: 'checking', label: 'Checking' };
  }

  const allHealthy = cloudHealthy && agentHealthy && signalrHealthy;
  if (allHealthy) {
    return { cssClass: 'healthy', label: 'All Healthy' };
  }
  return { cssClass: 'unhealthy', label: 'Degraded' };
}

// Update the health badge on the active release card (called after health checks complete)
function updateActiveReleaseHealthBadge() {
  const badge = document.getElementById('activeReleaseHealthBadge');
  if (!badge) return;

  const state = getHealthBadgeState();
  badge.className = 'release-health-badge ' + state.cssClass;
  badge.innerHTML = '<span class="release-health-dot"></span>' + state.label;
}

// Render recent releases feed in the status panel
function renderReleasesFeed() {
  const container = document.getElementById('releasesFeedContainer');
  if (!container) return;

  const releases = CONFIG && CONFIG.releases;
  if (!releases || releases.length === 0) {
    container.innerHTML = '<div style="font-size: 11px; color: rgba(255, 255, 255, 0.4);">No releases found</div>';
    return;
  }

  // Show last 5 releases, newest first
  const recent = releases.slice(-5).reverse();
  const now = Date.now();

  container.innerHTML = recent.map(function(rel, index) {
    const version = rel.version || 'unknown';
    const title = rel.title || '';
    const ts = rel.timestamp ? new Date(rel.timestamp) : null;
    const isActive = index === 0;

    // Format relative time
    let timeStr = '';
    if (ts && !isNaN(ts.getTime())) {
      const diffMs = now - ts.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      const diffHr = Math.floor(diffMs / 3600000);
      const diffDay = Math.floor(diffMs / 86400000);
      if (diffMin < 1) timeStr = 'just now';
      else if (diffMin < 60) timeStr = diffMin + 'm ago';
      else if (diffHr < 24) timeStr = diffHr + 'h ago';
      else timeStr = diffDay + 'd ago';
    }

    // Truncate long titles
    const displayTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;

    if (isActive) {
      // Active release - prominent card with health badge
      var state = getHealthBadgeState();
      return '<div class="release-card-active">'
        + '<div class="release-active-label">Active Release</div>'
        + '<div class="release-version">' + version + '</div>'
        + (displayTitle ? '<div class="release-title" title="' + title.replace(/"/g, '&quot;') + '">' + displayTitle + '</div>' : '')
        + '<div class="release-meta">'
        + (timeStr ? '<span class="release-time">' + timeStr + '</span>' : '<span></span>')
        + '<span id="activeReleaseHealthBadge" class="release-health-badge ' + state.cssClass + '"><span class="release-health-dot"></span>' + state.label + '</span>'
        + '</div>'
        + '</div>';
    }

    // Older releases - compact style
    return '<div style="padding: 6px 8px; background: rgba(255, 255, 255, 0.03); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.06);">'
      + '<div style="display: flex; justify-content: space-between; align-items: center; gap: 4px;">'
      + '<span style="font-size: 10px; font-family: monospace; color: rgba(102, 126, 234, 0.9); font-weight: 600; white-space: nowrap;">' + version + '</span>'
      + (timeStr ? '<span style="font-size: 9px; color: rgba(255, 255, 255, 0.35); white-space: nowrap;">' + timeStr + '</span>' : '')
      + '</div>'
      + (displayTitle ? '<div style="font-size: 10px; color: rgba(255, 255, 255, 0.55); margin-top: 2px; line-height: 1.3; word-break: break-word;" title="' + title.replace(/"/g, '&quot;') + '">' + displayTitle + '</div>' : '')
      + '</div>';
  }).join('');
}

// Save original sign-in HTML on page load
function saveOriginalSignInHTML() {
  const container = document.querySelector('.sign-in-container');
  if (container && !originalSignInHTML) {
    originalSignInHTML = container.innerHTML;
  }
}

// Restore sign-in form - make globally accessible for inline handlers
window.restoreSignInForm = function restoreSignInForm() {
  const container = document.querySelector('.sign-in-container');
  if (container && originalSignInHTML) {
    container.innerHTML = originalSignInHTML;
    // Re-attach event listeners if needed
    attachSignInListeners();
  } else {
    // Fallback: reload the page, preserving URL params (link mode, provider, returnUrl etc)
    window.location.href = window.location.pathname + window.location.search;
  }
};

// Re-attach sign-in button listeners
function attachSignInListeners() {
  const buttons = document.querySelectorAll('.auth-button');
  buttons.forEach(button => {
    const provider = button.getAttribute('data-provider');
    if (provider) {
      // Skip button uses handleSkipSignIn, not handleSignIn
      if (provider === 'skip') {
        button.setAttribute('onclick', `handleSkipSignIn(); return false;`);
      } else if (provider === 'token') {
        // Token button uses handleTokenSignIn
        button.setAttribute('onclick', `handleTokenSignIn(); return false;`);
      } else if (provider === 'stored-token') {
        // Stored token button uses handleSignInWithStoredToken
        button.setAttribute('onclick', `handleSignInWithStoredToken(); return false;`);
      } else {
        // Use onclick attribute to ensure it works even if function is redefined
        button.setAttribute('onclick', `handleSignIn('${provider}'); return false;`);
      }
    }
  });
}

// NOTE: All OAuth flows (GitHub, Steam, Discord, Google) and token sign-in use FULL REDIRECTS
// with all OAuth/OpenID parameters in the URL, NOT AJAX/fetch requests.
// This ensures the backend .NET app can process the OAuth state and all URL parameters.
// 
// Flow:
// 1. User clicks sign-in button -> redirects to OAuth provider (GitHub/Google/Discord/Steam)
// 2. OAuth provider redirects back to callback page (gateway-callback-*.html) with code/state/OpenID params
// 3. Callback page redirects FULLY to backend tunnel/portal with ALL parameters in URL
// 4. Backend processes authentication and redirects back with token
//
// Token sign-in:
// 1. User clicks token sign-in -> form submission redirects FULLY to backend with token in URL
// 2. Backend processes token and redirects to portal/tunnel

// Make handleSignIn globally accessible for onclick handlers
// Define function and immediately attach to window for inline handlers
window.handleSignIn = function handleSignIn(provider) {
  console.log('handleSignIn called with provider:', provider);
  if (typeof trackGatewayEvent === 'function') trackGatewayEvent('sign_in_click', { provider: provider });

  // Check if we're in link mode (from URL parameter, localStorage, or linkingModeEnabled)
  const urlParams = new URLSearchParams(window.location.search);
  const linkProvider = urlParams.get('link');
  const linkingModeEnabled = urlParams.get('linkingModeEnabled') === 'true' ||
                             localStorage.getItem('linkingModeEnabled') === 'true';
  const linkModeProvider = localStorage.getItem('oauth_link_provider');

  // Link mode is active if:
  // 1. URL has ?link=provider or ?link=true
  // 2. OR linkingModeEnabled is set (from profile page account linking)
  const isLinkMode = linkProvider === provider || linkProvider === 'true' || linkingModeEnabled;
  const returnUrl = urlParams.get('returnUrl') || localStorage.getItem('oauth_return_url');

  if (isLinkMode) {
    console.log('Link mode detected for provider:', provider);
    console.log('Link mode provider from localStorage:', linkModeProvider);
    console.log('Return URL:', returnUrl);
  }
  
  // Clear any cached state before starting sign-in
  // This ensures we get a fresh OAuth flow each time
  try {
    // Don't clear everything, just OAuth-related items
    localStorage.removeItem('oauth_state');
    localStorage.removeItem('oauth_provider');
    
    // Store link mode and return URL if in link mode
    if (isLinkMode) {
      localStorage.setItem('oauth_link_mode', 'true');
      localStorage.setItem('oauth_link_provider', provider);
      if (returnUrl) {
        localStorage.setItem('oauth_return_url', returnUrl);
      }
      console.log('Stored link mode in localStorage');
    } else {
      localStorage.removeItem('oauth_link_mode');
      localStorage.removeItem('oauth_link_provider');
      localStorage.removeItem('oauth_return_url');
    }
    
    console.log('Cleared OAuth state before sign-in');
  } catch (e) {
    console.warn('Failed to clear OAuth state:', e);
  }
  
  // Show loading state for all providers
  const container = document.querySelector('.sign-in-container');
  if (container) {
    const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
    const linkHeading = isLinkMode ? `Linking ${providerName} Account...` : 'Redirecting...';
    const linkSubtitle = isLinkMode
      ? `Please wait while we redirect you to ${providerName} to link your account.`
      : `Please wait while we redirect you to ${providerName} to sign in.`;
    container.innerHTML = `
      <div class="spinner"></div>
      <h1>${linkHeading}</h1>
      <p class="subtitle">${linkSubtitle}</p>
      <div style="margin-top: 24px;">
        <button class="modal-button secondary" onclick="restoreSignInForm()" style="width: 100%;">
          Cancel
        </button>
      </div>
    `;
  }
  
  if (provider === 'github') {
    // Handle GitHub OAuth redirect - FULL REDIRECT with state and OAuth parameters in URL
    // Flow: gateway.html -> GitHub OAuth -> gateway-callback-github.html -> backend (with code/state in URL)
    if (!CONFIG.github.clientId || CONFIG.github.clientId === 'YOUR_GITHUB_CLIENT_ID') {
      showErrorModal('Configuration Error', 'GitHub Client ID not configured in config.json');
      restoreSignInForm();
      return;
    }

    // Generate state for CSRF protection
    // Include link mode in state if we're linking an account
    // Include createToken mode if preferToken is enabled
    const isLinkMode = localStorage.getItem('oauth_link_mode') === 'true';
    const preferToken = localStorage.getItem('preferToken') === 'true';
    let state = generateState();
    if (isLinkMode) {
      // Encode link mode in state: "link:{provider}:{randomState}"
      const linkProvider = localStorage.getItem('oauth_link_provider') || 'github';
      state = `link:${linkProvider}:${state}`;
      console.log('Link mode enabled - state includes link indicator:', state);
    }
    if (preferToken) {
      // Encode createToken mode in state
      state = `createToken:${state}`;
      console.log('CreateToken mode enabled - state includes createToken indicator:', state);
    }
    // State storage removed - not yet implemented for verification

    // Build GitHub OAuth URL - redirect to provider-specific callback
    // ALWAYS use the exact redirectUri from config.json to ensure it matches GitHub OAuth app settings
    let callbackUrl = CONFIG.github.redirectUri;
    
    // Validate that redirectUri is set and contains the correct callback file
    if (!callbackUrl || typeof callbackUrl !== 'string') {
      console.error('redirectUri not configured in config.json');
      showErrorModal('Configuration Error', 'GitHub redirectUri not configured in config.json. Please set it to: https://battle-buddy-games.github.io/Platform/gateway-callback-github.html');
      restoreSignInForm();
      return;
    }
    
    // Ensure it's the provider-specific callback (gateway-callback-github.html)
    if (!callbackUrl.includes('gateway-callback-github.html')) {
      console.warn('redirectUri in config.json does not use gateway-callback-github.html, updating it');
      // Update to use provider-specific callback
      const url = new URL(callbackUrl);
      const basePath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
      callbackUrl = `${url.origin}${basePath}gateway-callback-github.html`;
      console.log('Updated callback URL to:', callbackUrl);
    }
    
    // Trim any whitespace and ensure it's a valid URL
    callbackUrl = callbackUrl.trim();
    
    try {
      // Validate it's a valid URL
      new URL(callbackUrl);
    } catch (e) {
      console.error('Invalid redirectUri in config.json:', callbackUrl);
      showErrorModal('Configuration Error', `Invalid redirectUri in config.json: ${callbackUrl}. Please set it to: https://battle-buddy-games.github.io/Platform/gateway-callback-github.html`);
      restoreSignInForm();
      return;
    }
    
    console.log('Using callback URL from config.json:', callbackUrl);
    
    // Ensure callbackUrl is exactly what's in config.json (no modifications)
    // This MUST match what's registered in GitHub OAuth App settings
    const expectedUrl = "https://battle-buddy-games.github.io/Platform/gateway-callback-github.html";
    if (callbackUrl !== expectedUrl) {
      console.warn('Callback URL does not match expected URL!');
      console.warn('Expected:', expectedUrl);
      console.warn('Got:', callbackUrl);
      // Use the expected URL to ensure it matches GitHub OAuth app settings
      callbackUrl = expectedUrl;
      console.warn('Using expected URL instead:', callbackUrl);
    }
    
    // CRITICAL: Use the exact URL - no encoding, no modifications
    // GitHub is very strict about redirect_uri matching exactly
    // Use prompt=login to force GitHub to show login page and generate a completely new code
    // This ensures we get a fresh code even if user was previously authorized
    // prompt=login forces re-authentication, which generates a new authorization code
    const params = new URLSearchParams({
      client_id: CONFIG.github.clientId,
      redirect_uri: callbackUrl, // MUST be: https://battle-buddy-games.github.io/Platform/gateway-callback-github.html
      scope: CONFIG.github.scope || 'user:email', // Default scope if not configured
      state: state,
      prompt: 'login' // Force GitHub to show login page and generate completely new code
    });

    const githubAuthUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    
    // Log the exact redirect_uri that will be sent to GitHub
    const loggedRedirectUri = params.get('redirect_uri');
    console.log('=== GitHub OAuth Flow ===');
    console.log('Current page:', window.location.href);
    console.log('Callback URL variable:', callbackUrl);
    console.log('Expected URL:', expectedUrl);
    console.log('URLs match:', callbackUrl === expectedUrl);
    console.log('redirect_uri in URLSearchParams:', loggedRedirectUri);
    console.log('redirect_uri matches expected:', loggedRedirectUri === expectedUrl);
    console.log('State:', state);
    console.log('Full GitHub OAuth URL:', githubAuthUrl);
    console.log('Decoded redirect_uri from URL:', decodeURIComponent(loggedRedirectUri || ''));
    console.log('========================');
    
    // Store OAuth sign-in attempt for error detection and parameter preservation
    // CRITICAL: Store returnUrl, state, and tunnelUrl so callbacks can preserve them
    try {
      const tunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
      const tunnelUrl = tunnel?.address?.replace(/\/$/, '') || null;
      sessionStorage.setItem('oauthSignInAttempt', JSON.stringify({
        provider: 'github',
        timestamp: Date.now(),
        returnUrl: callbackUrl,
        targetUrl: callbackUrl,
        state: state,
        tunnelUrl: tunnelUrl,
        environment: typeof getPreferredEnvironment === 'function' ? getPreferredEnvironment() : null
      }));
    } catch (e) {
      console.warn('Failed to store OAuth attempt:', e);
    }
    
    // Show countdown before redirecting
    console.log('=== GitHub OAuth Flow ===');
    console.log('Preparing to redirect to GitHub OAuth authorization page:', githubAuthUrl);
    console.log('This will take you to github.com to sign in and authorize the application.');
    console.log('State:', state);
    console.log('ReturnUrl:', callbackUrl);
    console.log('========================');
    
    showOAuthSignInCountdown('github', githubAuthUrl, callbackUrl, {
      scope: CONFIG.github.scope || 'user:email'
    });
    return; // Explicitly return to prevent fallthrough
  } else if (provider === 'steam') {
    // Handle Steam OpenID redirect - DIRECT FRONTEND FLOW (no backend initiation)
    // Flow: gateway.html -> Steam OpenID -> gateway-callback-steam.html -> backend /api/auth/exchange-code
    // Steam uses OpenID 2.0, not OAuth - we redirect directly to Steam and handle the response in the callback

    // Build callback URL - must be within the realm for Steam OpenID
    const currentOrigin = window.location.origin;
    const currentPath = window.location.pathname;
    const basePath = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
    const realm = `${currentOrigin}${basePath}`;
    const callbackUrl = `${realm}gateway-callback-steam.html`;

    // Build Steam OpenID authentication URL
    // Steam's OpenID 2.0 endpoint
    const steamOpenIdUrl = new URL('https://steamcommunity.com/openid/login');

    // OpenID 2.0 required parameters
    steamOpenIdUrl.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0');
    steamOpenIdUrl.searchParams.set('openid.mode', 'checkid_setup');
    steamOpenIdUrl.searchParams.set('openid.return_to', callbackUrl);
    steamOpenIdUrl.searchParams.set('openid.realm', realm);
    steamOpenIdUrl.searchParams.set('openid.identity', 'http://specs.openid.net/auth/2.0/identifier_select');
    steamOpenIdUrl.searchParams.set('openid.claimed_id', 'http://specs.openid.net/auth/2.0/identifier_select');

    // Check if link mode is requested
    const isLinkMode = localStorage.getItem('oauth_link_mode') === 'true';
    if (isLinkMode) {
      // Add link indicator to return_to URL so callback knows this is account linking
      const callbackWithLink = new URL(callbackUrl);
      callbackWithLink.searchParams.set('link', 'true');
      steamOpenIdUrl.searchParams.set('openid.return_to', callbackWithLink.toString());
      console.log('Link mode enabled for Steam');
    }

    // Get tunnel URL for storing (callback will need it)
    const productionTunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
    const tunnelUrl = productionTunnel?.address?.replace(/\/$/, '') || '';

    console.log('=== Steam OpenID Flow (Direct Frontend) ===');
    console.log('Current page:', window.location.href);
    console.log('Realm:', realm);
    console.log('Callback URL:', callbackUrl);
    console.log('Link mode:', isLinkMode);
    console.log('Steam OpenID URL:', steamOpenIdUrl.toString());
    console.log('Steam will redirect back to gateway-callback-steam.html with OpenID params');
    console.log('Callback page will extract Steam ID and send to backend /api/auth/exchange-code');
    console.log('============================================');

    // Store OAuth sign-in attempt for error detection and callback use
    sessionStorage.setItem('oauthSignInAttempt', JSON.stringify({
      provider: 'steam',
      timestamp: Date.now(),
      targetUrl: callbackUrl,
      returnUrl: callbackUrl,
      tunnelUrl: tunnelUrl,
      environment: getPreferredEnvironment()
    }));

    // Show countdown before redirecting to Steam
    showOAuthSignInCountdown('steam', steamOpenIdUrl.toString(), callbackUrl, {
      realm: realm,
      backendInitiated: false
    });
    return; // Explicitly return to prevent fallthrough
  } else if (provider === 'google') {
    // Handle Google OAuth redirect - FULL REDIRECT with state and OAuth parameters in URL
    // Flow: gateway.html -> Google OAuth -> gateway-callback-google.html -> backend (with code/state in URL)
    if (!CONFIG.google || !CONFIG.google.clientId || CONFIG.google.clientId === 'YOUR_GOOGLE_CLIENT_ID') {
      showErrorModal('Configuration Error', 'Google Client ID not configured in config.json');
      restoreSignInForm();
      return;
    }

    // Generate state for CSRF protection
    // Include link mode in state if we're linking an account
    // Include createToken mode if preferToken is enabled
    const isLinkMode = localStorage.getItem('oauth_link_mode') === 'true';
    const preferToken = localStorage.getItem('preferToken') === 'true';
    let state = generateState();
    if (isLinkMode) {
      // Encode link mode in state: "link:{provider}:{randomState}"
      const linkProvider = localStorage.getItem('oauth_link_provider') || 'google';
      state = `link:${linkProvider}:${state}`;
      console.log('Link mode enabled for Google - state includes link indicator:', state);
    }
    if (preferToken) {
      // Encode createToken mode in state
      state = `createToken:${state}`;
      console.log('CreateToken mode enabled for Google - state includes createToken indicator:', state);
    }

    // Build callback URL - use the exact redirectUri from config.json
    let callbackUrl = CONFIG.google.redirectUri;
    
    // Validate that redirectUri is set
    if (!callbackUrl || typeof callbackUrl !== 'string') {
      console.error('redirectUri not configured in config.json');
      showErrorModal('Configuration Error', 'Google redirectUri not configured in config.json. Please set it to: https://battle-buddy-games.github.io/Platform/gateway-callback-google.html');
      restoreSignInForm();
      return;
    }
    
    // Ensure it's the provider-specific callback
    if (!callbackUrl.includes('gateway-callback-google.html')) {
      console.warn('redirectUri in config.json does not use gateway-callback-google.html, updating it');
      const url = new URL(callbackUrl);
      const basePath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
      callbackUrl = `${url.origin}${basePath}gateway-callback-google.html`;
      console.log('Updated callback URL to:', callbackUrl);
    }
    
    // Trim any whitespace and ensure it's a valid URL
    callbackUrl = callbackUrl.trim();
    
    try {
      // Validate it's a valid URL
      new URL(callbackUrl);
    } catch (e) {
      console.error('Invalid redirectUri in config.json:', callbackUrl);
      showErrorModal('Configuration Error', `Invalid redirectUri in config.json: ${callbackUrl}. Please set it to: https://battle-buddy-games.github.io/Platform/gateway-callback-google.html`);
      restoreSignInForm();
      return;
    }
    
    console.log('Using callback URL from config.json:', callbackUrl);
    
    // CRITICAL: Ensure callbackUrl is exactly what's in config.json (no modifications)
    // This MUST match what's registered in Google OAuth App settings
    const expectedUrl = "https://battle-buddy-games.github.io/Platform/gateway-callback-google.html";
    if (callbackUrl !== expectedUrl) {
      console.warn('Callback URL does not match expected URL!');
      console.warn('Expected:', expectedUrl);
      console.warn('Got:', callbackUrl);
      // Use the expected URL to ensure it matches Google OAuth app settings
      callbackUrl = expectedUrl;
      console.warn('Using expected URL instead:', callbackUrl);
    }
    
    // Build Google OAuth URL
    const scope = CONFIG.google.scope || 'profile email';
    const params = new URLSearchParams({
      client_id: CONFIG.google.clientId,
      redirect_uri: callbackUrl, // MUST be: https://battle-buddy-games.github.io/Platform/gateway-callback-google.html
      response_type: 'code',
      scope: scope,
      state: state,
      access_type: 'offline',
      prompt: 'consent'
    });

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    
    // Log the exact redirect_uri that will be sent to Google
    const loggedRedirectUri = params.get('redirect_uri');
    console.log('=== Google OAuth Flow ===');
    console.log('Current page:', window.location.href);
    console.log('Callback URL variable:', callbackUrl);
    console.log('Expected URL:', expectedUrl);
    console.log('URLs match:', callbackUrl === expectedUrl);
    console.log('redirect_uri in URLSearchParams:', loggedRedirectUri);
    console.log('redirect_uri matches expected:', loggedRedirectUri === expectedUrl);
    console.log('State:', state);
    console.log('Link mode:', isLinkMode);
    console.log('Full Google OAuth URL:', googleAuthUrl);
    console.log('Decoded redirect_uri from URL:', decodeURIComponent(loggedRedirectUri || ''));
    console.log('========================');
    
    // Store OAuth sign-in attempt for error detection and parameter preservation
    // CRITICAL: Store returnUrl, state, and tunnelUrl so callbacks can preserve them
    try {
      const tunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
      const tunnelUrl = tunnel?.address?.replace(/\/$/, '') || null;
      sessionStorage.setItem('oauthSignInAttempt', JSON.stringify({
        provider: 'google',
        timestamp: Date.now(),
        returnUrl: callbackUrl,
        targetUrl: callbackUrl,
        state: state,
        tunnelUrl: tunnelUrl,
        environment: typeof getPreferredEnvironment === 'function' ? getPreferredEnvironment() : null
      }));
    } catch (e) {
      console.warn('Failed to store OAuth attempt:', e);
    }
    
    // Show countdown before redirecting
    console.log('=== Google OAuth Flow ===');
    console.log('Preparing to redirect to Google OAuth authorization page:', googleAuthUrl);
    console.log('This will take you to accounts.google.com to sign in and authorize the application.');
    console.log('State:', state);
    console.log('ReturnUrl:', callbackUrl);
    console.log('========================');
    
    showOAuthSignInCountdown('google', googleAuthUrl, callbackUrl, {
      scope: scope
    });
    return; // Explicitly return to prevent fallthrough
  } else if (provider === 'discord') {
    // Handle Discord OAuth redirect - FULL REDIRECT with state and OAuth parameters in URL
    // Flow: gateway.html -> Discord OAuth -> gateway-callback-discord.html -> backend (with code/state in URL)
    if (!CONFIG.discord || !CONFIG.discord.clientId || CONFIG.discord.clientId === 'YOUR_DISCORD_CLIENT_ID') {
      showErrorModal('Configuration Error', 'Discord Client ID not configured in config.json');
      restoreSignInForm();
      return;
    }

    // Generate state for CSRF protection
    // Include link mode in state if we're linking an account
    // Include createToken mode if preferToken is enabled
    const isLinkMode = localStorage.getItem('oauth_link_mode') === 'true';
    const preferToken = localStorage.getItem('preferToken') === 'true';
    let state = generateState();
    if (isLinkMode) {
      // Encode link mode in state: "link:{provider}:{randomState}"
      const linkProvider = localStorage.getItem('oauth_link_provider') || 'discord';
      state = `link:${linkProvider}:${state}`;
      console.log('Link mode enabled for Discord - state includes link indicator:', state);
    }
    if (preferToken) {
      // Encode createToken mode in state
      state = `createToken:${state}`;
      console.log('CreateToken mode enabled for Discord - state includes createToken indicator:', state);
    }

    // Build callback URL - use the exact redirectUri from config.json
    let callbackUrl = CONFIG.discord.redirectUri;
    
    // Validate that redirectUri is set
    if (!callbackUrl || typeof callbackUrl !== 'string') {
      console.error('redirectUri not configured in config.json');
      showErrorModal('Configuration Error', 'Discord redirectUri not configured in config.json. Please set it to: https://battle-buddy-games.github.io/Platform/gateway-callback-discord.html');
      restoreSignInForm();
      return;
    }
    
    // Ensure it's the provider-specific callback
    if (!callbackUrl.includes('gateway-callback-discord.html')) {
      console.warn('redirectUri in config.json does not use gateway-callback-discord.html, updating it');
      const url = new URL(callbackUrl);
      const basePath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
      callbackUrl = `${url.origin}${basePath}gateway-callback-discord.html`;
      console.log('Updated callback URL to:', callbackUrl);
    }
    
    // Trim any whitespace and ensure it's a valid URL
    callbackUrl = callbackUrl.trim();
    
    try {
      // Validate it's a valid URL
      new URL(callbackUrl);
    } catch (e) {
      console.error('Invalid redirectUri in config.json:', callbackUrl);
      showErrorModal('Configuration Error', `Invalid redirectUri in config.json: ${callbackUrl}. Please set it to: https://battle-buddy-games.github.io/Platform/gateway-callback-discord.html`);
      restoreSignInForm();
      return;
    }
    
    console.log('Using callback URL from config.json:', callbackUrl);
    
    // Build Discord OAuth URL
    const scope = CONFIG.discord.scope || 'identify email';
    const params = new URLSearchParams({
      client_id: CONFIG.discord.clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: scope,
      state: state
    });

    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    
    console.log('=== Discord OAuth Flow ===');
    console.log('Current page:', window.location.href);
    console.log('Callback URL:', callbackUrl);
    console.log('State:', state);
    console.log('Link mode:', isLinkMode);
    console.log('Full Discord OAuth URL:', discordAuthUrl);
    console.log('========================');
    
    // Store OAuth sign-in attempt for error detection and parameter preservation
    // CRITICAL: Store returnUrl, state, and tunnelUrl so callbacks can preserve them
    try {
      const tunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
      const tunnelUrl = tunnel?.address?.replace(/\/$/, '') || null;
      sessionStorage.setItem('oauthSignInAttempt', JSON.stringify({
        provider: 'discord',
        timestamp: Date.now(),
        returnUrl: callbackUrl,
        targetUrl: callbackUrl,
        state: state,
        tunnelUrl: tunnelUrl,
        environment: typeof getPreferredEnvironment === 'function' ? getPreferredEnvironment() : null
      }));
    } catch (e) {
      console.warn('Failed to store OAuth attempt:', e);
    }
    
    // Show countdown before redirecting
    console.log('=== Discord OAuth Flow ===');
    console.log('Preparing to redirect to Discord OAuth authorization page:', discordAuthUrl);
    console.log('This will take you to discord.com to sign in and authorize the application.');
    console.log('State:', state);
    console.log('ReturnUrl:', callbackUrl);
    console.log('========================');
    
    showOAuthSignInCountdown('discord', discordAuthUrl, callbackUrl, {
      scope: scope
    });
    return; // Explicitly return to prevent fallthrough
  } else if (provider === 'skip') {
    // Skip sign-in - handled by handleSkipSignIn function
    handleSkipSignIn();
  } else {
    console.error('Unknown provider:', provider);
    showErrorModal('Configuration Error', `Unknown authentication provider: "${provider}"`);
    restoreSignInForm();
  }
};

// Handle skip sign-in - go directly to platform
// Define function and immediately attach to window for inline handlers
window.handleSkipSignIn = function handleSkipSignIn() {
  console.log('Skipping sign-in, redirecting to platform');

  // Check prefer portal setting
  const preferPortal = localStorage.getItem('preferPortal') !== 'false';

  // Get the tunnel URL for the preferred environment
  const productionTunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');

  if (!productionTunnel || !productionTunnel.address) {
    console.error('No cloud tunnel configured, falling back to portal.html without tunnel parameter');
    window.location.href = './portal.html';
    return;
  }

  const cleanTunnelUrl = productionTunnel.address.replace(/\/$/, '');

  if (preferPortal) {
    // If prefer portal is checked, go to portal.html with tunnel URL as parameter
    // Portal will load this URL in an iframe
    const portalUrl = new URL('./portal.html', window.location.href);
    portalUrl.searchParams.set('tunnelUrl', cleanTunnelUrl);
    console.log('Prefer portal is checked, redirecting to portal.html with tunnelUrl:', cleanTunnelUrl);
    window.location.href = portalUrl.toString();
  } else {
    // If prefer portal is not checked, go directly to tunnel
    console.log('Prefer portal is not checked, redirecting skip sign-in to tunnel directly:', cleanTunnelUrl);
    window.location.href = cleanTunnelUrl;
  }
};

// Token Sign-In Functions
window.handleTokenSignIn = function handleTokenSignIn() {
  console.log('Opening token sign-in modal');
  const modal = document.getElementById('tokenModal');
  if (modal) {
    modal.classList.add('show');
    // Focus the input field
    setTimeout(() => {
      const tokenInput = document.getElementById('tokenInput');
      if (tokenInput) {
        tokenInput.focus();
      }
    }, 100);
  }
};

function closeTokenModal() {
  const modal = document.getElementById('tokenModal');
  if (modal) {
    modal.classList.remove('show');
    // Clear the input and reset checkbox
    const tokenInput = document.getElementById('tokenInput');
    if (tokenInput) {
      tokenInput.value = '';
    }
    const rememberMeCheckbox = document.getElementById('rememberTokenCheckbox');
    if (rememberMeCheckbox) {
      rememberMeCheckbox.checked = false;
    }
  }
}

// Handle Enter key in token input
document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('tokenInput');
  if (tokenInput) {
    tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitToken();
      }
    });
  }

  // Close token modal when clicking outside
  const tokenModal = document.getElementById('tokenModal');
  if (tokenModal) {
    tokenModal.addEventListener('click', function(e) {
      if (e.target === this) {
        closeTokenModal();
      }
    });
  }

  // Close token modal with Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const tokenModal = document.getElementById('tokenModal');
      if (tokenModal && tokenModal.classList.contains('show')) {
        closeTokenModal();
      }
      // Close environment selector if open
      const envPanel = document.querySelector('.environment-selector-panel');
      if (envPanel && envPanel.style.display === 'block') {
        hideEnvironmentSelector();
      }
    }
  });

  // Initialize environment selector (will update when CONFIG loads)
  initEnvironmentSelector();
  
  // Update environment selector after CONFIG loads
  loadConfig().then(() => {
    updateEnvironmentUrl();
  });
  
  // Initialize space bar hold detection for environment selector
  initSpaceBarHoldDetection();
});

// Environment Selector Functions

// Space bar detection for toggling environment selector and developer options
let developerModeActive = false;

// OAuth sign-in countdown state (shared for all providers)
let oauthSignInCountdownInterval = null;
let oauthSignInCountdownPaused = false;
let oauthSignInCountdownValue = 5;
let oauthSignInRedirectUrl = null;
let oauthSignInProvider = null;

function initSpaceBarHoldDetection() {
  document.addEventListener('keydown', function(e) {
    // Only trigger if space is pressed and not in an input field
    if (e.key === ' ' || e.key === 'Spacebar') {
      const target = e.target;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (!isInput) {
        e.preventDefault(); // Prevent page scroll

        // Toggle developer options on spacebar press
        developerModeActive = !developerModeActive;

        if (developerModeActive) {
          showDeveloperOptions();
          showEnvironmentSelector();
        } else {
          hideDeveloperOptions();
        }
      }
    }
  });

  // Remove keyup handler - we now toggle on keydown instead of show/hide on hold
}

// Show developer options (e.g., token previews)
function showDeveloperOptions() {
  // Show token previews in remembered tokens list
  const tokenPreviews = document.querySelectorAll('.token-preview-dev');
  tokenPreviews.forEach(preview => {
    preview.style.display = 'block';
  });

  const developerOptions = document.querySelectorAll('.developer-option');
  developerOptions.forEach(option => {
    option.style.display = 'flex';
  });
}

// Hide developer options
function hideDeveloperOptions() {
  // Hide token previews in remembered tokens list
  const tokenPreviews = document.querySelectorAll('.token-preview-dev');
  tokenPreviews.forEach(preview => {
    preview.style.display = 'none';
  });

  // Check if debug mode is enabled - if so, keep the debug checkbox visible
  const debugModeEnabled = typeof isDebugModeEnabled === 'function' && isDebugModeEnabled();

  const developerOptions = document.querySelectorAll('.developer-option');
  developerOptions.forEach(option => {
    // Keep debug mode checkbox visible if debug mode is enabled
    const debugCheckbox = option.querySelector('#debugModeCheckbox');
    if (debugCheckbox && debugModeEnabled) {
      // Keep this option visible
      return;
    }
    option.style.display = 'none';
  });
}

// Show environment selector panel
function showEnvironmentSelector() {
  const panel = document.querySelector('.environment-selector-panel');
  const statusPanel = document.querySelector('.status-panel');

  if (panel) {
    // Calculate position below status panel
    if (statusPanel && statusPanel.offsetHeight > 0) {
      const healthChecksBottom = statusPanel.offsetTop + statusPanel.offsetHeight;
      const gap = 12; // Gap between panels
      panel.style.top = `${healthChecksBottom + gap}px`;
    }
    panel.style.display = 'block';
  }
}

// Hide environment selector panel
function hideEnvironmentSelector() {
  const panel = document.querySelector('.environment-selector-panel');
  if (panel) {
    panel.style.display = 'none';
  }
}

// Get tunnel for environment
function getTunnelForEnvironment(envName) {
  // Map environment names to tunnel names
  // Note: SignalR is now unified with Cloud service, so all environments use the same Cloud tunnel
  const tunnelNameMap = {
    'develop': 'develop-cloud',
    'staging': 'staging-cloud',
    'test': 'test-cloud',
    'production': 'production-cloud'
  };
  
  const tunnelName = tunnelNameMap[envName] || 'cloud';
  let tunnel = CONFIG.cloudflareTunnels?.find(t => t.name === tunnelName);
  
  // Fallback: if environment-specific tunnel not found, try "cloud" for backward compatibility
  // This ensures health checks work even if only the generic "cloud" tunnel is configured
  if (!tunnel) {
    console.log(`Tunnel "${tunnelName}" not found for environment "${envName}", falling back to "cloud"`);
    tunnel = CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
  }
  
  if (!tunnel) {
    console.warn(`No tunnel found for environment "${envName}". Available tunnels:`, CONFIG.cloudflareTunnels?.map(t => t.name) || []);
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

// Set preferred environment in localStorage
function setPreferredEnvironment(envName) {
  try {
    if (['develop', 'staging', 'test', 'production'].includes(envName)) {
      localStorage.setItem('preferredEnvironment', envName);
      return true;
    }
  } catch (e) {
    console.error('Failed to set preferred environment:', e);
  }
  return false;
}

// Get tunnel for preferred environment
function getTunnelForPreferredEnvironment() {
  const preferredEnv = getPreferredEnvironment();
  return getTunnelForEnvironment(preferredEnv);
}

// SignalR is now unified with Cloud service - no separate tunnel needed

// Initialize environment selector
function initEnvironmentSelector() {
  const envSelector = document.getElementById('environmentSelector');
  const envUrl = document.getElementById('environmentUrl');
  
  if (!envSelector || !envUrl) return;

  // Load preferred environment from localStorage, default to production
  const preferredEnv = getPreferredEnvironment();
  envSelector.value = preferredEnv;
  
  // Update URL display
  updateEnvironmentUrl();

  // Add change handler - save preference and update all tunnel references
  envSelector.addEventListener('change', (e) => {
    const selectedEnv = e.target.value;
    setPreferredEnvironment(selectedEnv);
    updateEnvironmentUrl();
    
    // Update all tunnel references to use the new environment
    updateTunnelLinks();
    performHealthChecks();
    
    console.log('Environment changed to:', selectedEnv);
    if (typeof trackGatewayEvent === 'function') trackGatewayEvent('environment_changed', { environment: selectedEnv });
  });
}

// Update environment URL display
function updateEnvironmentUrl() {
  const envSelector = document.getElementById('environmentSelector');
  const envUrl = document.getElementById('environmentUrl');
  
  if (!envSelector || !envUrl) return;

  const selectedEnv = envSelector.value;
  const tunnel = getTunnelForEnvironment(selectedEnv);
  
  if (tunnel && tunnel.address) {
    envUrl.textContent = tunnel.address;
  } else {
    envUrl.textContent = '-';
  }
}

window.submitToken = function submitToken() {
  const tokenInput = document.getElementById('tokenInput');
  if (!tokenInput) {
    showErrorModal('Error', 'Token input field not found');
    return;
  }

  const token = tokenInput.value.trim();
  if (!token) {
    showErrorModal('Validation Error', 'Please enter a token');
    return;
  }

  // Check if "remember me" is checked
  const rememberMeCheckbox = document.getElementById('rememberTokenCheckbox');
  const shouldRemember = rememberMeCheckbox && rememberMeCheckbox.checked;

  // Store token if remember me is checked
  if (shouldRemember) {
    if (addRememberedToken(token)) {
      console.log('Token remembered successfully');
      // Update the remembered tokens list
      updateRememberedTokensList();
    } else {
      console.warn('Failed to remember token, but continuing with sign-in');
    }
  }

  // Close the token modal
  closeTokenModal();

  // Get cloud tunnel address from config (use preferred environment)
  const productionTunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
  
  if (!productionTunnel || !productionTunnel.address) {
    showErrorModal('Configuration Error', 'No cloud tunnel configured in config.json. Token authentication requires a tunnel.');
    restoreSignInForm();
    return;
  }
  
  // Remove trailing slash from base URL if present, then add endpoint
  const cleanBaseUrl = productionTunnel.address.replace(/\/$/, '');
  // Use the token authentication endpoint that supports both platform tokens and GitHub PATs
  // The endpoint handles:
  // 1. Platform auth tokens (PR environment tokens) - validates and signs in the user
  // 2. GitHub Personal Access Tokens (PATs) - validates with GitHub API and signs in the linked user

  // Build return URL based on preferPortal setting
  const preferPortal = localStorage.getItem('preferPortal') !== 'false';
  const currentUrl = new URL(window.location.href);
  let targetUrl;
  let targetDisplay;

  if (preferPortal) {
    // Return to portal.html with tunnelUrl parameter
    const portalUrl = new URL(`${currentUrl.origin}${currentUrl.pathname.replace('gateway.html', 'portal.html')}`);
    portalUrl.searchParams.set('tunnelUrl', cleanBaseUrl);
    targetUrl = portalUrl.toString();
    targetDisplay = 'Portal';
  } else {
    // Return directly to tunnel
    targetUrl = cleanBaseUrl;
    targetDisplay = 'Platform (Tunnel)';
  }

  const returnUrl = encodeURIComponent(targetUrl);
  tokenAuthUrl = `${cleanBaseUrl}/pr-auth/signin?token=${encodeURIComponent(token)}&returnUrl=${returnUrl}`;

  console.log('=== Token Sign-In Details ===');
  console.log('Token preview:', token.substring(0, 20) + '...');
  console.log('Backend auth URL:', tokenAuthUrl.replace(token, '***'));
  console.log('Target redirect URL:', targetUrl);
  console.log('Prefer Portal:', preferPortal);
  console.log('Remember token:', shouldRemember);
  console.log('============================');
  
  // Store attempt marker to detect unexpected redirects
  try {
    sessionStorage.setItem('tokenSignInAttempt', JSON.stringify({
      timestamp: Date.now(),
      targetUrl: targetUrl,
      backendUrl: tokenAuthUrl.replace(token, '***'),
      type: 'new_token',
      rememberToken: shouldRemember,
      preferPortal: preferPortal
    }));
  } catch (e) {
    console.warn('Failed to store token sign-in attempt marker:', e);
  }

  // Create form for submission (will be submitted after countdown)
  tokenSignInForm = document.createElement('form');
  tokenSignInForm.method = 'GET';
  tokenSignInForm.action = tokenAuthUrl;
  tokenSignInForm.style.display = 'none';
  document.body.appendChild(tokenSignInForm);

  // Check if skip countdown is enabled
  const skipCountdown = localStorage.getItem('skipCountdown') === 'true';
  if (skipCountdown) {
    console.log('Skip countdown enabled, submitting token immediately...');
    window.location.href = tokenAuthUrl;
    return;
  }

  // Show countdown UI with detailed information
  const container = document.querySelector('.sign-in-container');
  if (container) {
    let countdown = 5;
    container.innerHTML = `
      <div class="spinner"></div>
      <h1>Authenticating with token...</h1>
      <p class="message">Verifying your authentication token with the backend.</p>
      <div style="margin-top: 16px; padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1);">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: rgba(255, 255, 255, 0.8);">
          <strong style="color: rgba(255, 255, 255, 0.9);">Target:</strong> ${targetDisplay}
        </p>
        <p style="margin: 0 0 8px 0; font-size: 13px; color: rgba(255, 255, 255, 0.8);">
          <strong style="color: rgba(255, 255, 255, 0.9);">Backend:</strong> ${cleanBaseUrl}
        </p>
        <p style="margin: 0; font-size: 12px; color: rgba(255, 255, 255, 0.6); word-break: break-all;">
          ${targetUrl}
        </p>
      </div>
      <p class="subtitle" style="margin-top: 16px; color: rgba(255, 255, 255, 0.7);">Redirecting in <span id="tokenSignInCountdownText" style="font-weight: 600; color: rgba(255, 255, 255, 0.9);">${countdown}</span> seconds<span id="countdownPausedIndicator" style="display: none; color: rgba(255, 255, 255, 0.5);"> (paused)</span>...</p>
      <p style="margin-top: 8px; font-size: 12px; color: rgba(255, 255, 255, 0.5);">Check the console for detailed authentication information.</p>
      <div style="margin-top: 24px; display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="modal-button secondary" onclick="cancelTokenSignInCountdown()" style="flex: 1; min-width: 100px;">
          Cancel
        </button>
        <button class="modal-button" id="pauseResumeCountdownButton" onclick="pauseTokenSignInCountdown()" style="flex: 1; min-width: 100px; background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.3);">
          Pause
        </button>
        <button class="modal-button primary" onclick="skipTokenSignInCountdown()" style="flex: 1; min-width: 100px;">
          Skip
        </button>
      </div>
    `;
    
    const countdownText = document.getElementById('tokenSignInCountdownText');
    const pausedIndicator = document.getElementById('countdownPausedIndicator');
    tokenSignInCountdownValue = countdown;
    tokenSignInCountdownPaused = false;
    
    // Update countdown every second
    tokenSignInCountdownInterval = setInterval(() => {
      if (!tokenSignInCountdownPaused) {
        tokenSignInCountdownValue--;
        if (countdownText) {
          countdownText.textContent = tokenSignInCountdownValue.toString();
        }
        if (pausedIndicator) {
          pausedIndicator.style.display = 'none';
        }
        
        if (tokenSignInCountdownValue <= 0) {
          clearInterval(tokenSignInCountdownInterval);
          tokenSignInCountdownInterval = null;
          console.log('Countdown complete, submitting authentication form...');
          console.log('Form action:', tokenSignInForm ? tokenSignInForm.action.replace(token, '***') : 'null');
          if (tokenSignInForm) {
            // Update UI to show we're redirecting
            if (container) {
              container.innerHTML = `
                <div class="spinner"></div>
                <h1>Redirecting...</h1>
                <p class="message">Submitting authentication request...</p>
                <p style="margin-top: 16px; font-size: 12px; color: rgba(255, 255, 255, 0.6);">If you are redirected back here, check for error messages above.</p>
              `;
            }
            
            // Clean up form
            if (tokenSignInForm && tokenSignInForm.parentNode) {
              tokenSignInForm.parentNode.removeChild(tokenSignInForm);
            }
            tokenSignInForm = null;
            
            // Redirect directly to ensure token parameter is preserved
            if (tokenAuthUrl) {
              window.location.href = tokenAuthUrl;
            } else {
              console.error('Token auth URL is missing');
              showErrorModal('Error', 'Authentication URL is missing. Please try again.');
            }
          }
        }
      } else {
        // Countdown is paused
        if (pausedIndicator) {
          pausedIndicator.style.display = 'inline';
        }
      }
    }, 1000);
  }
};

// Token storage key for multiple tokens
const REMEMBERED_TOKENS_KEY = 'remembered_tokens';
const LONG_REMEMBER_TOKEN_KEY = 'bb_long_remember_token';

// Get all remembered tokens (includes both regular and long-lived tokens)
function getRememberedTokens() {
  const result = [];

  // Get regular remembered tokens
  try {
    const stored = localStorage.getItem(REMEMBERED_TOKENS_KEY);
    if (stored) {
      const tokens = JSON.parse(stored);
      if (Array.isArray(tokens)) {
        tokens.forEach(t => {
          t.tokenType = 'one-time'; // Mark as one-time token
          result.push(t);
        });
      }
    }
  } catch (e) {
    console.warn('Failed to get remembered tokens:', e);
  }

  // Get long-lived remember token (from "Prefer Long Remember Token" feature)
  try {
    const longTokenData = localStorage.getItem(LONG_REMEMBER_TOKEN_KEY);
    if (longTokenData) {
      const parsed = JSON.parse(longTokenData);
      if (parsed && parsed.token) {
        // Check if token is expired
        const expiresAt = parsed.expiresAt ? new Date(parsed.expiresAt) : null;
        const isExpired = expiresAt && expiresAt < new Date();

        if (!isExpired) {
          result.push({
            id: 'long-token-' + (parsed.savedAt || Date.now()),
            token: parsed.token,
            rememberedAt: parsed.savedAt || new Date().toISOString(),
            provider: parsed.provider,
            username: parsed.username,
            tokenType: 'long-lived', // Mark as long-lived token
            expiresAt: parsed.expiresAt,
            label: `Long-lived token (${parsed.provider || 'OAuth'})`
          });
          console.log('[getRememberedTokens] Found long-lived token, expires:', parsed.expiresAt);
        } else {
          console.log('[getRememberedTokens] Long-lived token is expired, removing');
          localStorage.removeItem(LONG_REMEMBER_TOKEN_KEY);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to get long remember token:', e);
  }

  return result;
}

// Save remembered tokens
function saveRememberedTokens(tokens) {
  try {
    localStorage.setItem(REMEMBERED_TOKENS_KEY, JSON.stringify(tokens));
    console.log('Remembered tokens saved successfully');
    return true;
  } catch (e) {
    console.error('Failed to save remembered tokens:', e);
    return false;
  }
}

// Add a new remembered token
function addRememberedToken(token) {
  try {
    const tokens = getRememberedTokens();
    // Check if token already exists
    const existingIndex = tokens.findIndex(t => t.token === token);
    if (existingIndex >= 0) {
      // Update existing token's date
      tokens[existingIndex].rememberedAt = new Date().toISOString();
    } else {
      // Add new token
      tokens.push({
        token: token,
        rememberedAt: new Date().toISOString(),
        id: Date.now().toString() + Math.random().toString(36).substring(2, 9)
      });
    }
    return saveRememberedTokens(tokens);
  } catch (e) {
    console.error('Failed to add remembered token:', e);
    return false;
  }
}

// Remove a remembered token by ID
function removeRememberedToken(tokenId) {
  try {
    // Check if this is a long-lived token
    if (tokenId && tokenId.startsWith('long-token-')) {
      localStorage.removeItem(LONG_REMEMBER_TOKEN_KEY);
      console.log('Long-lived token removed');
      return true;
    }

    // Regular remembered tokens
    const stored = localStorage.getItem(REMEMBERED_TOKENS_KEY);
    if (!stored) return true;
    const tokens = JSON.parse(stored);
    if (!Array.isArray(tokens)) return true;
    const filtered = tokens.filter(t => t.id !== tokenId);
    return saveRememberedTokens(filtered);
  } catch (e) {
    console.error('Failed to remove remembered token:', e);
    return false;
  }
}

// Check for stored authentication token (backward compatibility)
function checkPreviousSignIn() {
  try {
    const tokens = getRememberedTokens();
    return tokens.length > 0;
  } catch (e) {
    console.warn('Failed to check for stored token:', e);
    return false;
  }
}

// Get stored authentication token (backward compatibility - returns first token)
function getStoredToken() {
  try {
    const tokens = getRememberedTokens();
    return tokens.length > 0 ? tokens[0].token : null;
  } catch (e) {
    console.warn('Failed to get stored token:', e);
    return null;
  }
}

// Store authentication token (backward compatibility)
function storeToken(token) {
  return addRememberedToken(token);
}

// Remove stored authentication token (backward compatibility - removes all)
function removeStoredToken() {
  try {
    localStorage.removeItem(REMEMBERED_TOKENS_KEY);
    console.log('All tokens removed successfully');
    return true;
  } catch (e) {
    console.warn('Failed to remove stored tokens:', e);
    return false;
  }
}

// Calculate days old
function getDaysOld(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Format date for display
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Sign in with a specific remembered token
// Countdown state for token sign-in
let tokenSignInCountdownInterval = null;
let tokenSignInCountdownTimeout = null;
let tokenSignInForm = null;
let tokenSignInCountdownPaused = false;
let tokenSignInCountdownValue = 5;
let tokenAuthUrl = null; // Store the backend auth URL for skip function

// Cancel token sign-in countdown
window.cancelTokenSignInCountdown = function cancelTokenSignInCountdown() {
  if (tokenSignInCountdownInterval) {
    clearInterval(tokenSignInCountdownInterval);
    tokenSignInCountdownInterval = null;
  }
  if (tokenSignInCountdownTimeout) {
    clearTimeout(tokenSignInCountdownTimeout);
    tokenSignInCountdownTimeout = null;
  }
  if (tokenSignInForm && tokenSignInForm.parentNode) {
    tokenSignInForm.parentNode.removeChild(tokenSignInForm);
  }
  tokenSignInForm = null;
  tokenAuthUrl = null;
  tokenSignInCountdownPaused = false;
  // Clear attempt marker since user canceled
  try {
    sessionStorage.removeItem('tokenSignInAttempt');
  } catch (e) {
    console.warn('Failed to clear token sign-in attempt marker:', e);
  }
  restoreSignInForm();
};

// Skip token sign-in countdown and redirect immediately
window.skipTokenSignInCountdown = function skipTokenSignInCountdown() {
  if (tokenSignInCountdownInterval) {
    clearInterval(tokenSignInCountdownInterval);
    tokenSignInCountdownInterval = null;
  }
  if (tokenSignInCountdownTimeout) {
    clearTimeout(tokenSignInCountdownTimeout);
    tokenSignInCountdownTimeout = null;
  }
  tokenSignInCountdownPaused = false;
  
  // Clean up form if it exists
  if (tokenSignInForm && tokenSignInForm.parentNode) {
    tokenSignInForm.parentNode.removeChild(tokenSignInForm);
  }
  tokenSignInForm = null;
  
  // Redirect directly to ensure token parameter is preserved
  if (tokenAuthUrl) {
    console.log('Skipping countdown, redirecting to backend with token in URL');
    window.location.href = tokenAuthUrl;
  } else {
    console.error('Token auth URL is missing, cannot redirect');
    showErrorModal('Error', 'Authentication URL is missing. Please try again.');
  }
};

// Pause token sign-in countdown
window.pauseTokenSignInCountdown = function pauseTokenSignInCountdown() {
  tokenSignInCountdownPaused = true;
  console.log('Countdown paused at', tokenSignInCountdownValue, 'seconds');
  updateCountdownButton();
};

// Resume token sign-in countdown
window.resumeTokenSignInCountdown = function resumeTokenSignInCountdown() {
  tokenSignInCountdownPaused = false;
  console.log('Countdown resumed at', tokenSignInCountdownValue, 'seconds');
  updateCountdownButton();
};

// Update countdown button text based on pause state
function updateCountdownButton() {
  const pauseButton = document.getElementById('pauseResumeCountdownButton');
  if (pauseButton) {
    if (tokenSignInCountdownPaused) {
      pauseButton.textContent = 'Resume';
      pauseButton.onclick = resumeTokenSignInCountdown;
    } else {
      pauseButton.textContent = 'Pause';
      pauseButton.onclick = pauseTokenSignInCountdown;
    }
  }
}

// Cancel OAuth sign-in countdown
window.cancelOAuthSignInCountdown = function cancelOAuthSignInCountdown() {
  if (oauthSignInCountdownInterval) {
    clearInterval(oauthSignInCountdownInterval);
    oauthSignInCountdownInterval = null;
  }
  oauthSignInCountdownPaused = false;
  oauthSignInRedirectUrl = null;
  oauthSignInProvider = null;
  // Clear attempt marker since user canceled
  try {
    sessionStorage.removeItem('oauthSignInAttempt');
  } catch (e) {
    console.warn('Failed to clear OAuth sign-in attempt marker:', e);
  }
  restoreSignInForm();
};

// Skip OAuth sign-in countdown and redirect immediately
window.skipOAuthSignInCountdown = function skipOAuthSignInCountdown() {
  if (oauthSignInCountdownInterval) {
    clearInterval(oauthSignInCountdownInterval);
    oauthSignInCountdownInterval = null;
  }
  oauthSignInCountdownPaused = false;
  if (oauthSignInRedirectUrl) {
    const providerName = oauthSignInProvider ? oauthSignInProvider.charAt(0).toUpperCase() + oauthSignInProvider.slice(1) : 'OAuth';
    console.log(`Skipping countdown, redirecting to ${providerName} immediately...`);
    window.location.href = oauthSignInRedirectUrl;
    oauthSignInRedirectUrl = null;
    oauthSignInProvider = null;
  }
};

// Pause OAuth sign-in countdown
window.pauseOAuthSignInCountdown = function pauseOAuthSignInCountdown() {
  oauthSignInCountdownPaused = true;
  console.log('OAuth sign-in countdown paused at', oauthSignInCountdownValue, 'seconds');
  updateOAuthCountdownButton();
};

// Resume OAuth sign-in countdown
window.resumeOAuthSignInCountdown = function resumeOAuthSignInCountdown() {
  oauthSignInCountdownPaused = false;
  console.log('OAuth sign-in countdown resumed at', oauthSignInCountdownValue, 'seconds');
  updateOAuthCountdownButton();
};

// Update OAuth countdown button text based on pause state
function updateOAuthCountdownButton() {
  const pauseButton = document.getElementById('oauthPauseResumeCountdownButton');
  if (pauseButton) {
    if (oauthSignInCountdownPaused) {
      pauseButton.textContent = 'Resume';
      pauseButton.onclick = resumeOAuthSignInCountdown;
    } else {
      pauseButton.textContent = 'Pause';
      pauseButton.onclick = pauseOAuthSignInCountdown;
    }
  }
}

// Show OAuth sign-in countdown with pause/skip functionality
function showOAuthSignInCountdown(provider, authUrl, callbackUrl, additionalInfo = {}) {
  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
  oauthSignInRedirectUrl = authUrl;
  oauthSignInProvider = provider;

  // Store OAuth sign-in attempt marker to detect unexpected redirects
  try {
    sessionStorage.setItem('oauthSignInAttempt', JSON.stringify({
      timestamp: Date.now(),
      provider: provider,
      type: 'oauth'
    }));
  } catch (e) {
    console.warn('Failed to store OAuth sign-in attempt marker:', e);
  }

  // Check if skip countdown is enabled, or if we're in link mode (link mode always skips countdown)
  const skipCountdown = localStorage.getItem('skipCountdown') === 'true';
  const isInLinkMode = localStorage.getItem('oauth_link_mode') === 'true';
  if (skipCountdown || isInLinkMode) {
    console.log(`${isInLinkMode ? 'Link mode' : 'Skip countdown'} enabled, redirecting to ${providerName} immediately...`);
    // Send debug analytics before redirect (sendBeacon survives page navigation)
    if (typeof sendDebugEventNow === 'function') {
      sendDebugEventNow('OAUTH_REDIRECT_IMMEDIATE', {
        provider: provider,
        isLinkMode: isInLinkMode,
        skipCountdown: skipCountdown,
        authUrl: authUrl.substring(0, 100) + '...'
      });
    }
    window.location.href = authUrl;
    return;
  }

  // Show countdown UI
  const container = document.querySelector('.sign-in-container');
  if (container) {
    let countdown = 5;
    oauthSignInCountdownValue = countdown;
    oauthSignInCountdownPaused = false;
    
    // Build info display
    let infoHtml = `
      <p style="margin: 0 0 8px 0; font-size: 13px; color: rgba(255, 255, 255, 0.8);">
        <strong style="color: rgba(255, 255, 255, 0.9);">Provider:</strong> ${providerName}
      </p>
      <p style="margin: 0 0 8px 0; font-size: 13px; color: rgba(255, 255, 255, 0.8);">
        <strong style="color: rgba(255, 255, 255, 0.9);">Callback:</strong> ${callbackUrl}
      </p>
    `;
    
    // Add any additional info
    if (additionalInfo.realm) {
      infoHtml += `<p style="margin: 0 0 8px 0; font-size: 13px; color: rgba(255, 255, 255, 0.8);"><strong style="color: rgba(255, 255, 255, 0.9);">Realm:</strong> ${additionalInfo.realm}</p>`;
    }
    if (additionalInfo.scope) {
      infoHtml += `<p style="margin: 0 0 8px 0; font-size: 13px; color: rgba(255, 255, 255, 0.8);"><strong style="color: rgba(255, 255, 255, 0.9);">Scope:</strong> ${additionalInfo.scope}</p>`;
    }
    
    infoHtml += `<p style="margin: 0; font-size: 12px; color: rgba(255, 255, 255, 0.6); word-break: break-all;">${authUrl}</p>`;
    
    const isCountdownLinkMode = localStorage.getItem('oauth_link_mode') === 'true';
    const countdownHeading = isCountdownLinkMode
      ? `Linking ${providerName} Account...`
      : `Redirecting to ${providerName}...`;
    const countdownMessage = isCountdownLinkMode
      ? `Preparing to redirect to ${providerName} to link your account. After authorizing, you'll be redirected back and your ${providerName} account will be linked.`
      : `Preparing to redirect to ${providerName} to sign in. After authentication, you'll be redirected back through our callback handlers.`;
    container.innerHTML = `
      <div class="spinner"></div>
      <h1>${countdownHeading}</h1>
      <p class="message">${countdownMessage}</p>
      <div style="margin-top: 16px; padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1);">
        ${infoHtml}
      </div>
      <p class="subtitle" style="margin-top: 16px; color: rgba(255, 255, 255, 0.7);">Redirecting in <span id="oauthSignInCountdownText" style="font-weight: 600; color: rgba(255, 255, 255, 0.9);">${countdown}</span> seconds<span id="oauthCountdownPausedIndicator" style="display: none; color: rgba(255, 255, 255, 0.5);"> (paused)</span>...</p>
      <p style="margin-top: 8px; font-size: 12px; color: rgba(255, 255, 255, 0.5);">Flow: gateway.html → ${providerName} → gateway-callback-${provider}.html → gateway-callback.html → backend</p>
      <div style="margin-top: 24px; display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="modal-button secondary" onclick="cancelOAuthSignInCountdown()" style="flex: 1; min-width: 100px;">
          Cancel
        </button>
        <button class="modal-button" id="oauthPauseResumeCountdownButton" onclick="pauseOAuthSignInCountdown()" style="flex: 1; min-width: 100px; background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.3);">
          Pause
        </button>
        <button class="modal-button primary" onclick="skipOAuthSignInCountdown()" style="flex: 1; min-width: 100px;">
          Skip
        </button>
      </div>
    `;
    
    const countdownText = document.getElementById('oauthSignInCountdownText');
    const pausedIndicator = document.getElementById('oauthCountdownPausedIndicator');
    
    // Update countdown every second
    oauthSignInCountdownInterval = setInterval(() => {
      if (!oauthSignInCountdownPaused) {
        oauthSignInCountdownValue--;
        if (countdownText) {
          countdownText.textContent = oauthSignInCountdownValue.toString();
        }
        if (pausedIndicator) {
          pausedIndicator.style.display = 'none';
        }
        
        if (oauthSignInCountdownValue <= 0) {
          clearInterval(oauthSignInCountdownInterval);
          oauthSignInCountdownInterval = null;
          console.log(`Countdown complete, redirecting to ${providerName}...`);
          if (oauthSignInRedirectUrl) {
            window.location.href = oauthSignInRedirectUrl;
            oauthSignInRedirectUrl = null;
            oauthSignInProvider = null;
          }
        }
      } else {
        // Countdown is paused
        if (pausedIndicator) {
          pausedIndicator.style.display = 'inline';
        }
      }
    }, 1000);
  } else {
    // Fallback: redirect immediately if container not found
    console.log(`Redirecting to ${providerName} OAuth authorization page:`, authUrl);
    window.location.href = authUrl;
  }
}

window.signInWithRememberedToken = function signInWithRememberedToken(tokenId, options = {}) {
  const { fromAutoSignIn = false } = options;
  console.log('=== Sign-In with Remembered Token ===');
  console.log('Token ID:', tokenId);
  console.log('From auto sign-in:', fromAutoSignIn);

  const tokens = getRememberedTokens();
  console.log('Available tokens:', tokens.length);

  const tokenData = tokens.find(t => t.id === tokenId);

  if (!tokenData) {
    console.error('Token not found with ID:', tokenId);
    console.error('Available token IDs:', tokens.map(t => t.id));
    showErrorModal('Error', 'Token not found. It may have been removed.');
    updateRememberedTokensList();
    return;
  }

  if (!tokenData.token) {
    console.error('Token data found but token value is missing:', tokenData);
    showErrorModal('Error', 'The saved token is invalid. Please sign in again using one of the providers above.');
    updateRememberedTokensList();
    return;
  }

  const token = tokenData.token;
  const isLongLivedToken = tokenData.tokenType === 'long-lived';
  console.log('Token found:', {
    id: tokenData.id,
    rememberedAt: tokenData.rememberedAt,
    tokenPreview: token.substring(0, 20) + '...',
    tokenLength: token.length,
    tokenType: tokenData.tokenType || 'one-time',
    expiresAt: tokenData.expiresAt
  });
  console.log('Signing in with remembered token (long-lived:', isLongLivedToken, ')');

  // Get cloud tunnel address from config
  const productionTunnel = CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');

  if (!productionTunnel || !productionTunnel.address) {
    showErrorModal('Configuration Error', 'No cloud tunnel configured in config.json. Token authentication requires a tunnel.');
    restoreSignInForm();
    return;
  }

  // Build return URL based on preferPortal setting for the final redirect
  // IMPORTANT: Always return to gateway.html so error parameters are preserved
  // Gateway.html will then redirect to tunnel/portal based on preferPortal setting
  const preferPortal = localStorage.getItem('preferPortal') !== 'false';
  const currentUrl = new URL(window.location.href);
  const basePath = currentUrl.pathname.substring(0, currentUrl.pathname.lastIndexOf('/') + 1);

  // Always return to gateway.html, but include target URL as parameter
  // This ensures error parameters are preserved if authentication fails
  const gatewayReturnUrl = new URL(`${currentUrl.origin}${basePath}gateway.html`);

  const cleanTunnelUrl = productionTunnel.address.replace(/\/$/, '');
  if (preferPortal) {
    // Target is portal.html - include tunnel URL so portal can load it in iframe
    gatewayReturnUrl.searchParams.set('tokenSignInTarget', 'portal');
    gatewayReturnUrl.searchParams.set('tunnelUrl', cleanTunnelUrl);
  } else {
    // Target is tunnel directly
    gatewayReturnUrl.searchParams.set('tokenSignInTarget', 'tunnel');
    gatewayReturnUrl.searchParams.set('tunnelUrl', cleanTunnelUrl);
  }

  const finalReturnUrl = gatewayReturnUrl.toString();

  // FULL REDIRECT to backend with token in URL
  // The backend will authenticate and redirect to the final returnUrl
  // Long-lived tokens use a different endpoint than one-time tokens
  if (isLongLivedToken) {
    // Long-lived tokens use /auth/signin-long-token endpoint
    tokenAuthUrl = `${productionTunnel.address.replace(/\/$/, '')}/auth/signin-long-token?token=${encodeURIComponent(token)}&returnUrl=${encodeURIComponent(finalReturnUrl)}`;
  } else {
    // One-time tokens use /pr-auth/signin endpoint
    tokenAuthUrl = `${productionTunnel.address.replace(/\/$/, '')}/pr-auth/signin?token=${encodeURIComponent(token)}&returnUrl=${encodeURIComponent(finalReturnUrl)}`;
  }
  
  console.log('=== Token Sign-In Details ===');
  console.log('Token ID:', tokenId);
  console.log('Token preview:', token.substring(0, 20) + '...');
  console.log('Backend auth URL:', tokenAuthUrl.replace(token, '***'));
  console.log('Target redirect URL:', finalReturnUrl);
  console.log('Prefer Portal:', preferPortal);
  console.log('============================');
  
  // Store attempt marker to detect unexpected redirects
  try {
    sessionStorage.setItem('tokenSignInAttempt', JSON.stringify({
      timestamp: Date.now(),
      tokenId: tokenId,
      targetUrl: finalReturnUrl,
      backendUrl: tokenAuthUrl.replace(token, '***'),
      type: 'remembered_token'
    }));
  } catch (e) {
    console.warn('Failed to store token sign-in attempt marker:', e);
  }
  
  // Create form for submission (will be submitted after countdown)
  tokenSignInForm = document.createElement('form');
  tokenSignInForm.method = 'GET';
  tokenSignInForm.action = tokenAuthUrl;
  tokenSignInForm.style.display = 'none';
  document.body.appendChild(tokenSignInForm);

  // Check if skip countdown is enabled OR coming from auto sign-in
  // (auto sign-in already showed its own countdown with cancel/pause/skip buttons)
  const skipCountdown = localStorage.getItem('skipCountdown') === 'true';
  if (skipCountdown || fromAutoSignIn) {
    console.log(fromAutoSignIn
      ? 'Coming from auto sign-in countdown, proceeding directly...'
      : 'Skip countdown enabled, submitting remembered token immediately...');
    window.location.href = tokenAuthUrl;
    return;
  }

  // Show countdown UI with detailed information
  const container = document.querySelector('.sign-in-container');
  if (container) {
    let countdown = 5;
    const targetDisplay = preferPortal ? 'Portal' : 'Platform (Tunnel)';
    container.innerHTML = `
      <div class="spinner"></div>
      <h1>Signing in with saved token...</h1>
      <p class="message">Authenticating with your remembered token.</p>
      <div style="margin-top: 16px; padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1);">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: rgba(255, 255, 255, 0.8);">
          <strong style="color: rgba(255, 255, 255, 0.9);">Target:</strong> ${targetDisplay}
        </p>
        <p style="margin: 0 0 8px 0; font-size: 13px; color: rgba(255, 255, 255, 0.8);">
          <strong style="color: rgba(255, 255, 255, 0.9);">Backend:</strong> ${productionTunnel.address.replace(/\/$/, '')}
        </p>
        <p style="margin: 0; font-size: 12px; color: rgba(255, 255, 255, 0.6); word-break: break-all;">
          ${finalReturnUrl}
        </p>
      </div>
      <p class="subtitle" style="margin-top: 16px; color: rgba(255, 255, 255, 0.7);">Redirecting in <span id="tokenSignInCountdownText" style="font-weight: 600; color: rgba(255, 255, 255, 0.9);">${countdown}</span> seconds<span id="countdownPausedIndicator" style="display: none; color: rgba(255, 255, 255, 0.5);"> (paused)</span>...</p>
      <p style="margin-top: 8px; font-size: 12px; color: rgba(255, 255, 255, 0.5);">Check the console for detailed authentication information.</p>
      <div style="margin-top: 24px; display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="modal-button secondary" onclick="cancelTokenSignInCountdown()" style="flex: 1; min-width: 100px;">
          Cancel
        </button>
        <button class="modal-button" id="pauseResumeCountdownButton" onclick="pauseTokenSignInCountdown()" style="flex: 1; min-width: 100px; background: rgba(255, 255, 255, 0.15); border: 1px solid rgba(255, 255, 255, 0.3);">
          Pause
        </button>
        <button class="modal-button primary" onclick="skipTokenSignInCountdown()" style="flex: 1; min-width: 100px;">
          Skip
        </button>
      </div>
    `;
    
    const countdownText = document.getElementById('tokenSignInCountdownText');
    const pausedIndicator = document.getElementById('countdownPausedIndicator');
    tokenSignInCountdownValue = countdown;
    tokenSignInCountdownPaused = false;
    
    // Update countdown every second
    tokenSignInCountdownInterval = setInterval(() => {
      if (!tokenSignInCountdownPaused) {
        tokenSignInCountdownValue--;
        if (countdownText) {
          countdownText.textContent = tokenSignInCountdownValue.toString();
        }
        if (pausedIndicator) {
          pausedIndicator.style.display = 'none';
        }
        
        if (tokenSignInCountdownValue <= 0) {
          clearInterval(tokenSignInCountdownInterval);
          tokenSignInCountdownInterval = null;
          console.log('Countdown complete, submitting authentication form...');
          
          // Verify token is still present before submitting
          if (!token || token.trim() === '') {
            console.error('Token is missing or empty, cannot submit form');
            showErrorModal('Error', 'The authentication token is missing. Please try signing in again.');
            restoreSignInForm();
            return;
          }
          
          if (!tokenSignInForm) {
            console.error('Token sign-in form is missing');
            showErrorModal('Error', 'Authentication form is missing. Please try again.');
            restoreSignInForm();
            return;
          }
          
          // Verify form action contains the token
          const formAction = tokenSignInForm.action;
          if (!formAction || !formAction.includes('token=')) {
            console.error('Form action is invalid or missing token parameter:', formAction);
            showErrorModal('Error', 'Authentication form is invalid. Please try again.');
            restoreSignInForm();
            return;
          }
          
          console.log('Form action (token masked):', formAction.replace(token, '***'));
          console.log('Token length:', token.length);
          console.log('Token preview:', token.substring(0, 20) + '...');
          console.log('Redirecting to backend with token in URL...');
          
          if (container) {
            // Update UI to show we're redirecting
            container.innerHTML = `
              <div class="spinner"></div>
              <h1>Redirecting...</h1>
              <p class="message">Submitting authentication request...</p>
              <p style="margin-top: 16px; font-size: 12px; color: rgba(255, 255, 255, 0.6);">If you are redirected back here, check for error messages above.</p>
            `;
          }
          
          // Use direct redirect to ensure token is in URL
          // Clean up form first
          if (tokenSignInForm && tokenSignInForm.parentNode) {
            tokenSignInForm.parentNode.removeChild(tokenSignInForm);
          }
          tokenSignInForm = null;
          
          // Redirect directly to ensure token parameter is preserved
          window.location.href = tokenAuthUrl;
        }
      } else {
        // Countdown is paused
        if (pausedIndicator) {
          pausedIndicator.style.display = 'inline';
        }
      }
    }, 1000);
  }
};

// Forget a remembered token
window.forgetRememberedToken = function forgetRememberedToken(tokenId) {
  if (removeRememberedToken(tokenId)) {
    console.log('Token forgotten successfully');
    updateRememberedTokensList();
    updateTokenStatus();
  } else {
    showErrorModal('Error', 'Failed to remove token. Please try again.');
  }
};

// Update the remembered tokens list UI
function updateRememberedTokensList() {
  const panel = document.querySelector('.remembered-tokens-panel');
  const container = document.getElementById('rememberedTokensContainer');
  const list = document.getElementById('rememberedTokensList');
  
  if (!container || !list) return;
  
  const tokens = getRememberedTokens();
  
  if (tokens.length === 0) {
    container.style.display = 'none';
    // Hide panel if no tokens
    if (panel) {
      panel.style.display = 'none';
    }
    return;
  }
  
  container.style.display = 'block';
  
  // Show panel when tokens exist and position it below Quick Links
  if (panel) {
    positionRememberedTokensPanel();
    panel.style.display = 'block';
  }
  
  // Clear existing list
  list.innerHTML = '';
  
  // Sort tokens by date (newest first)
  const sortedTokens = [...tokens].sort((a, b) => 
    new Date(b.rememberedAt) - new Date(a.rememberedAt)
  );
  
  // Create list items for each token
  sortedTokens.forEach(tokenData => {
    const daysOld = getDaysOld(tokenData.rememberedAt);
    const formattedDate = formatDate(tokenData.rememberedAt);
    const daysText = daysOld === 0 ? 'today' : daysOld === 1 ? '1 day ago' : `${daysOld} days ago`;
    
    const item = document.createElement('div');
    item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; gap: 12px;';
    
    const leftSection = document.createElement('div');
    leftSection.className = 'remembered-token-clickable';
    leftSection.style.cssText = 'flex: 1; min-width: 0; cursor: pointer;';
    leftSection.onclick = () => signInWithRememberedToken(tokenData.id);
    
    const tokenPreview = document.createElement('div');
    tokenPreview.className = 'token-preview-dev';
    tokenPreview.style.cssText = 'font-family: monospace; font-size: 12px; color: rgba(255, 255, 255, 0.9); word-break: break-all; margin-bottom: 4px; display: none;';
    tokenPreview.textContent = tokenData.token.substring(0, 20) + '...';
    
    const dateInfo = document.createElement('div');
    dateInfo.style.cssText = 'font-size: 11px; color: rgba(255, 255, 255, 0.6);';
    dateInfo.textContent = `${formattedDate} • ${daysText}`;
    
    leftSection.appendChild(tokenPreview);
    leftSection.appendChild(dateInfo);
    
    const rightSection = document.createElement('div');
    rightSection.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-shrink: 0;';
    
    const signInButton = document.createElement('button');
    signInButton.className = 'remembered-token-signin-btn';
    signInButton.title = 'Sign In';
    signInButton.innerHTML = '<svg viewBox="0 0 24 24" style="width: 16px; height: 16px; fill: currentColor;"><path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h6v-2H4V8h6V4zm8 0h-6v2h6v10h-6v2h6c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm-1 9l-4-4v3H7v2h6v3l4-4z"/></svg>';
    signInButton.style.cssText = 'background: rgba(76, 175, 80, 0.3); border: 1px solid rgba(76, 175, 80, 0.5); border-radius: 4px; padding: 6px; color: rgba(255, 255, 255, 0.9); cursor: pointer; display: flex; align-items: center; justify-content: center; min-width: 28px; height: 28px;';
    signInButton.onclick = (e) => {
      e.stopPropagation();
      signInWithRememberedToken(tokenData.id);
    };
    
    const forgetButton = document.createElement('button');
    forgetButton.title = 'Forget';
    forgetButton.innerHTML = '<svg viewBox="0 0 24 24" style="width: 16px; height: 16px; fill: currentColor;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    forgetButton.style.cssText = 'background: rgba(255, 100, 100, 0.3); border: 1px solid rgba(255, 100, 100, 0.5); border-radius: 4px; padding: 6px; color: rgba(255, 255, 255, 0.9); cursor: pointer; display: flex; align-items: center; justify-content: center; min-width: 28px; height: 28px;';
    forgetButton.onclick = (e) => {
      e.stopPropagation();
      forgetRememberedToken(tokenData.id);
    };
    
    rightSection.appendChild(signInButton);
    rightSection.appendChild(forgetButton);

    item.appendChild(leftSection);
    item.appendChild(rightSection);

    list.appendChild(item);
  });

  // Apply health check state to newly created buttons
  updateSignInButtonStates();
}

// Sign in with stored token (uses most recent remembered token)
window.handleSignInWithStoredToken = function handleSignInWithStoredToken() {
  console.log('=== Saved Token Sign-In ===');
  const tokens = getRememberedTokens();
  console.log('Total remembered tokens:', tokens.length);
  
  if (tokens.length === 0) {
    console.warn('No saved tokens found');
    showErrorModal('No Saved Token', 'No saved authentication token found. Please sign in using one of the providers above.');
    updateTokenStatus(); // Update UI to reflect no token
    return;
  }
  
  // Sort tokens by date (newest first) and use the most recent one
  const sortedTokens = [...tokens].sort((a, b) => {
    const dateA = new Date(a.rememberedAt || 0);
    const dateB = new Date(b.rememberedAt || 0);
    return dateB - dateA; // Newest first
  });
  
  console.log('Sorted tokens (newest first):', sortedTokens.map(t => ({
    id: t.id,
    rememberedAt: t.rememberedAt,
    tokenPreview: t.token ? t.token.substring(0, 20) + '...' : 'missing'
  })));
  
  const mostRecentToken = sortedTokens[0];
  if (!mostRecentToken || !mostRecentToken.id) {
    console.error('Most recent token is invalid:', mostRecentToken);
    showErrorModal('Error', 'The saved token is invalid. Please sign in again using one of the providers above.');
    updateTokenStatus();
    return;
  }
  
  console.log('Using most recent token:', {
    id: mostRecentToken.id,
    rememberedAt: mostRecentToken.rememberedAt,
    tokenPreview: mostRecentToken.token ? mostRecentToken.token.substring(0, 20) + '...' : 'missing'
  });
  console.log('========================');
  
  // Use the most recent token
  signInWithRememberedToken(mostRecentToken.id);
};

// Auto sign-in with countdown
let countdownInterval = null;
let countdownTimeout = null;

function startAutoSignIn() {
  // Check if skip countdown is enabled
  const skipCountdown = localStorage.getItem('skipCountdown') === 'true';
  if (skipCountdown) {
    console.log('Skip countdown enabled, redirecting immediately...');
    // Redirect based on preferPortal setting
    const preferPortal = localStorage.getItem('preferPortal') !== 'false';
    const productionTunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
    if (preferPortal) {
      if (productionTunnel && productionTunnel.address) {
        const cleanTunnelUrl = productionTunnel.address.replace(/\/$/, '');
        const portalUrl = new URL('./portal.html', window.location.href);
        portalUrl.searchParams.set('tunnelUrl', cleanTunnelUrl);
        window.location.href = portalUrl.toString();
      } else {
        window.location.href = './portal.html';
      }
    } else {
      if (productionTunnel && productionTunnel.address) {
        const cleanTunnelUrl = productionTunnel.address.replace(/\/$/, '');
        window.location.href = cleanTunnelUrl;
      } else {
        window.location.href = './portal.html';
      }
    }
    return;
  }

  const previousSignInContainer = document.getElementById('previousSignInContainer');
  const noSignInContainer = document.getElementById('noSignInContainer');
  const countdownText = document.getElementById('countdownText');

  if (!previousSignInContainer || !noSignInContainer || !countdownText) {
    return;
  }

  // Show countdown container, hide sign-in options
  previousSignInContainer.style.display = 'block';
  noSignInContainer.style.display = 'none';

  let countdown = 5;
  countdownText.textContent = countdown.toString();
  
  // Update countdown every second
  countdownInterval = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      countdownText.textContent = countdown.toString();
    } else {
      countdownText.textContent = '0';
      clearInterval(countdownInterval);
      // Redirect based on preferPortal setting
      const preferPortal = localStorage.getItem('preferPortal') !== 'false';
      const productionTunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
      if (preferPortal) {
        // If prefer portal is checked, go to portal.html with tunnel URL parameter
        if (productionTunnel && productionTunnel.address) {
          const cleanTunnelUrl = productionTunnel.address.replace(/\/$/, '');
          const portalUrl = new URL('./portal.html', window.location.href);
          portalUrl.searchParams.set('tunnelUrl', cleanTunnelUrl);
          window.location.href = portalUrl.toString();
        } else {
          window.location.href = './portal.html';
        }
      } else {
        // If prefer portal is not checked, go to tunnel directly (use preferred environment)
        if (productionTunnel && productionTunnel.address) {
          const cleanTunnelUrl = productionTunnel.address.replace(/\/$/, '');
          window.location.href = cleanTunnelUrl;
        } else {
          window.location.href = './portal.html';
        }
      }
    }
  }, 1000);
}

// Cancel auto sign-in
window.cancelAutoSignIn = function cancelAutoSignIn() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (countdownTimeout) {
    clearTimeout(countdownTimeout);
    countdownTimeout = null;
  }
  
  const previousSignInContainer = document.getElementById('previousSignInContainer');
  const noSignInContainer = document.getElementById('noSignInContainer');
  
  if (previousSignInContainer && noSignInContainer) {
    previousSignInContainer.style.display = 'none';
    noSignInContainer.style.display = 'block';
  }
};

// Auto sign-in countdown state
let autoSignInCountdownInterval = null;
let autoSignInCountdownPaused = false;
let autoSignInCountdownValue = 5;
let autoSignInTokenId = null;

// Start auto sign-in countdown
function startAutoSignInCountdown(tokenId) {
  console.log('Starting auto sign-in countdown with token:', tokenId);
  autoSignInTokenId = tokenId;

  // NOTE: We intentionally do NOT skip the countdown for auto sign-in,
  // even if skipCountdown is enabled. The user must be able to cancel
  // auto sign-in to access the gateway page and change their settings.
  // The skipCountdown setting only applies to OAuth sign-in flows.

  const autoSignInContainer = document.getElementById('autoSignInContainer');
  const noSignInContainer = document.getElementById('noSignInContainer');
  const countdownText = document.getElementById('autoSignInCountdownText');
  const pausedIndicator = document.getElementById('autoSignInPausedIndicator');
  const message = document.getElementById('autoSignInMessage');

  if (!autoSignInContainer || !noSignInContainer || !countdownText) {
    console.error('Auto sign-in UI elements not found');
    return;
  }

  // Show auto sign-in container, hide sign-in options
  autoSignInContainer.style.display = 'block';
  noSignInContainer.style.display = 'none';
  
  if (message) {
    message.textContent = 'Auto sign in starting...';
  }
  
  autoSignInCountdownValue = 5;
  autoSignInCountdownPaused = false;
  countdownText.textContent = autoSignInCountdownValue.toString();
  
  if (pausedIndicator) {
    pausedIndicator.style.display = 'none';
  }
  
  updateAutoSignInCountdownButton();
  
  // Update countdown every second
  autoSignInCountdownInterval = setInterval(() => {
    if (!autoSignInCountdownPaused) {
      autoSignInCountdownValue--;
      if (countdownText) {
        countdownText.textContent = autoSignInCountdownValue.toString();
      }
      
      if (autoSignInCountdownValue <= 0) {
        clearInterval(autoSignInCountdownInterval);
        autoSignInCountdownInterval = null;
        console.log('Auto sign-in countdown complete, signing in...');
        if (autoSignInTokenId) {
          signInWithRememberedToken(autoSignInTokenId, { fromAutoSignIn: true });
        }
      }
    } else {
      // Countdown is paused
      if (pausedIndicator) {
        pausedIndicator.style.display = 'inline';
      }
    }
  }, 1000);
}

// Cancel auto sign-in countdown
window.cancelAutoSignInCountdown = function cancelAutoSignInCountdown() {
  if (autoSignInCountdownInterval) {
    clearInterval(autoSignInCountdownInterval);
    autoSignInCountdownInterval = null;
  }
  
  autoSignInCountdownPaused = false;
  autoSignInTokenId = null;
  
  const autoSignInContainer = document.getElementById('autoSignInContainer');
  const noSignInContainer = document.getElementById('noSignInContainer');
  
  if (autoSignInContainer && noSignInContainer) {
    autoSignInContainer.style.display = 'none';
    noSignInContainer.style.display = 'block';
  }
  
  console.log('Auto sign-in countdown canceled');
};

// Skip auto sign-in countdown and sign in immediately
window.skipAutoSignInCountdown = function skipAutoSignInCountdown() {
  if (autoSignInCountdownInterval) {
    clearInterval(autoSignInCountdownInterval);
    autoSignInCountdownInterval = null;
  }

  autoSignInCountdownPaused = false;

  console.log('Skipping auto sign-in countdown, signing in immediately...');

  if (autoSignInTokenId) {
    signInWithRememberedToken(autoSignInTokenId, { fromAutoSignIn: true });
  } else {
    // Fallback to most recent token
    handleSignInWithStoredToken();
  }
};

// Pause auto sign-in countdown
window.pauseAutoSignInCountdown = function pauseAutoSignInCountdown() {
  autoSignInCountdownPaused = true;
  console.log('Auto sign-in countdown paused at', autoSignInCountdownValue, 'seconds');
  updateAutoSignInCountdownButton();
  
  const pausedIndicator = document.getElementById('autoSignInPausedIndicator');
  if (pausedIndicator) {
    pausedIndicator.style.display = 'inline';
  }
};

// Resume auto sign-in countdown
window.resumeAutoSignInCountdown = function resumeAutoSignInCountdown() {
  autoSignInCountdownPaused = false;
  console.log('Auto sign-in countdown resumed at', autoSignInCountdownValue, 'seconds');
  updateAutoSignInCountdownButton();
  
  const pausedIndicator = document.getElementById('autoSignInPausedIndicator');
  if (pausedIndicator) {
    pausedIndicator.style.display = 'none';
  }
};

// Update auto sign-in countdown button text based on pause state
function updateAutoSignInCountdownButton() {
  const pauseButton = document.getElementById('autoSignInPauseResumeButton');
  if (pauseButton) {
    if (autoSignInCountdownPaused) {
      pauseButton.textContent = 'Resume';
      pauseButton.onclick = window.resumeAutoSignInCountdown;
    } else {
      pauseButton.textContent = 'Pause';
      pauseButton.onclick = window.pauseAutoSignInCountdown;
    }
  }
}

// Toggle token visibility

// Copy token to clipboard
window.copyTokenToClipboard = function copyTokenToClipboard(buttonElement) {
  const token = getStoredToken();
  if (!token) {
    showErrorModal('Error', 'No token found to copy');
    return;
  }
  
  // Get button element if not provided
  const button = buttonElement || (typeof event !== 'undefined' ? event.target : null);
  if (!button) {
    console.error('Button element not found');
    showErrorModal('Error', 'Failed to copy token to clipboard');
    return;
  }
  
  const originalText = button.textContent;
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(token).then(() => {
      button.textContent = 'Copied!';
      button.style.background = 'rgba(76, 175, 80, 0.5)';
      setTimeout(() => {
        button.textContent = originalText;
        button.style.background = 'rgba(76, 175, 80, 0.3)';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy token:', err);
      showErrorModal('Error', 'Failed to copy token to clipboard');
    });
  } else {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = token;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      const success = document.execCommand('copy');
      if (success) {
        button.textContent = 'Copied!';
        button.style.background = 'rgba(76, 175, 80, 0.5)';
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = 'rgba(76, 175, 80, 0.3)';
        }, 2000);
      } else {
        throw new Error('execCommand copy failed');
      }
    } catch (err) {
      console.error('Failed to copy token:', err);
      showErrorModal('Error', 'Failed to copy token to clipboard');
    } finally {
      if (document.body.contains(textArea)) {
        document.body.removeChild(textArea);
      }
    }
  }
};

// Update token status indicator
function updateTokenStatus() {
  const tokenStatusContainer = document.getElementById('tokenStatusContainer');
  const tokenStatusText = document.getElementById('tokenStatusText');
  const storedTokenSignInContainer = document.getElementById('storedTokenSignInContainer');
  const hasToken = checkPreviousSignIn();
  
  if (tokenStatusText && tokenStatusContainer) {
    if (hasToken) {
      // Show the default info icon when token exists
      const defaultInfoIcon = tokenStatusContainer.querySelector('svg');
      if (defaultInfoIcon && !defaultInfoIcon.classList.contains('cross-icon')) {
        defaultInfoIcon.style.display = 'block';
      }
      
      // Reset span styles for token display
      tokenStatusText.style.display = '';
      tokenStatusText.style.width = '';
      
      tokenStatusText.innerHTML = `
        <span style="color: rgba(76, 175, 80, 0.9);">Sign-in token saved</span>
        <br/>You can sign in quickly with your most recent saved token.
      `;
      
    } else {
      // Remove any existing cross icon that might be a separate element
      const existingCrossIcon = tokenStatusContainer.querySelector('.cross-icon');
      if (existingCrossIcon) {
        existingCrossIcon.remove();
      }
      
      // Hide the default info icon in the container since we're using an inline one
      const defaultInfoIcon = tokenStatusContainer.querySelector('svg');
      if (defaultInfoIcon && !defaultInfoIcon.classList.contains('cross-icon')) {
        defaultInfoIcon.style.display = 'none';
      }
      
      // Make the span take full width for the info box
      tokenStatusText.style.display = 'block';
      tokenStatusText.style.width = '100%';
      
      // Create info box with inline info icon and text
      tokenStatusText.innerHTML = `
        <p style="margin: 0; padding: 8px 12px; background: rgba(255, 255, 255, 0.05); border-left: 3px solid rgba(255, 255, 255, 0.3); border-radius: 4px; font-size: 12px; color: rgba(255, 255, 255, 0.7); line-height: 1.4;">
          <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: rgba(255, 255, 255, 0.7); display: inline-block; vertical-align: middle; margin-right: 6px;">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
          </svg>
          No identity remembered.
        </p>
      `;
      
    }
  }
  
  // Show/hide stored token sign in button based on whether there are remembered tokens
  if (storedTokenSignInContainer) {
    const tokens = getRememberedTokens();
    storedTokenSignInContainer.style.display = tokens.length > 0 ? 'block' : 'none';
  }
  
  // Show/hide remembered tokens panel based on whether there are tokens
  const rememberedTokensPanel = document.querySelector('.remembered-tokens-panel');
  if (rememberedTokensPanel) {
    const tokens = getRememberedTokens();
    const hasTokens = tokens.length > 0;
    
    if (hasTokens) {
      // Position panel below Quick Links panel
      positionRememberedTokensPanel();
      rememberedTokensPanel.style.display = 'block';
    } else {
      rememberedTokensPanel.style.display = 'none';
    }
  }
}

// Position remembered tokens panel below Quick Links panel
function positionRightSidePanels() {
  const quickLinksPanel = document.querySelector('.quick-links-panel');
  const rememberedTokensPanel = document.querySelector('.remembered-tokens-panel');

  // On mobile, panels use relative positioning and stack naturally
  const isMobile = window.matchMedia('(max-width: 1200px)').matches;
  if (isMobile) return;

  requestAnimationFrame(() => {
    const gap = 12;

    // Position remembered-tokens below quick-links
    if (rememberedTokensPanel && quickLinksPanel && quickLinksPanel.offsetHeight > 0) {
      const quickLinksBottom = quickLinksPanel.offsetTop + quickLinksPanel.offsetHeight;
      rememberedTokensPanel.style.top = `${quickLinksBottom + gap}px`;
      rememberedTokensPanel.style.left = quickLinksPanel.style.left;
      rememberedTokensPanel.style.marginLeft = quickLinksPanel.style.marginLeft;
    }
  });
}

// Backward-compatible alias
function positionRememberedTokensPanel() {
  positionRightSidePanels();
}

// Smoothly update right-side panel positions during menu animation
function smoothUpdateRememberedTokensPosition() {
  // On mobile, panels use relative positioning and stack naturally, so skip smooth updates
  const isMobile = window.matchMedia('(max-width: 1200px)').matches;
  if (isMobile) return;

  // Update position multiple times during the 300ms animation for smooth movement
  const startTime = Date.now();
  const duration = 300; // Match the menu dropdown transition duration
  const updateInterval = 16; // ~60fps

  const updatePosition = () => {
    const elapsed = Date.now() - startTime;
    positionRightSidePanels();

    if (elapsed < duration) {
      setTimeout(updatePosition, updateInterval);
    } else {
      positionRightSidePanels();
    }
  };

  updatePosition();
}

// Close all foldout menus except the specified one
function closeAllMenusExcept(exceptContainer) {
  const allMenuContainers = [
    '.options-menu-container',
    '.more-sign-in-menu-container',
    '.external-links-menu-container'
  ];

  allMenuContainers.forEach(selector => {
    const menu = document.querySelector(selector);
    if (menu && menu !== exceptContainer) {
      menu.classList.remove('menu-open');
    }
  });
}

// Initialize foldout menus with click handlers
function initializeFoldoutMenus() {
  // Generic helper to wire up a foldout menu
  function setupFoldoutMenu(containerSelector, itemSelector) {
    const trigger = document.querySelector(containerSelector + ' > :first-child');
    const container = document.querySelector(containerSelector);
    if (!trigger || !container) return;

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpening = !container.classList.contains('menu-open');
      closeAllMenusExcept(isOpening ? container : null);
      container.classList.toggle('menu-open');
      smoothUpdateRememberedTokensPosition();
    });

    if (itemSelector) {
      container.querySelectorAll(itemSelector).forEach(item => {
        item.addEventListener('click', (e) => { e.stopPropagation(); });
      });
    }
  }

  setupFoldoutMenu('.options-menu-container', '.quick-links-option');
  setupFoldoutMenu('.more-sign-in-menu-container', '.more-sign-in-menu-item');
  setupFoldoutMenu('.external-links-menu-container', '.external-links-menu-item');

  // Close menus when clicking outside
  document.addEventListener('click', (e) => {
    const isOutsideAllMenus = !e.target.closest('.options-menu-container') &&
                              !e.target.closest('.more-sign-in-menu-container') &&
                              !e.target.closest('.external-links-menu-container');

    if (isOutsideAllMenus) {
      closeAllMenusExcept(null);
      smoothUpdateRememberedTokensPosition();
    }
  });
}

function initQuickLinksTabs() {
  const tabButtons = document.querySelectorAll('.quick-links-tab-button');
  const tabPanels = document.querySelectorAll('.quick-links-tab-panel');

  if (!tabButtons.length || !tabPanels.length) {
    return;
  }

  const activateTab = (tabName) => {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.quickLinksTab === tabName;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    tabPanels.forEach((panel) => {
      const isActive = panel.dataset.quickLinksPanel === tabName;
      panel.classList.toggle('active', isActive);
    });
  };

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activateTab(button.dataset.quickLinksTab);
    });
  });

  const initiallyActive = document.querySelector('.quick-links-tab-button.active');
  activateTab(initiallyActive ? initiallyActive.dataset.quickLinksTab : tabButtons[0].dataset.quickLinksTab);
}

/**
 * Resolve a quick link ID to a target URL.
 * Supports steam launches, portal subpages, and external links.
 * IDs are case-insensitive.
 */
function resolveQuickLink(id) {
  const key = (id || '').toLowerCase().replace(/[\s_-]/g, '');

  // Steam launch links
  const steamLinks = {
    'aoosdk':     'steam://launch/2153520/',
    'aoo':        'steam://launch/2153520/',
    'tow':        'steam://launch/3687660/',
    'blender':    'steam://launch/365670/',
  };
  if (steamLinks[key]) return steamLinks[key];

  // Portal subpage links (dashboard tools and pages)
  const portalSubpages = {
    'dashboard':      '/Dashboard',
    'dashboardhome':  '/Dashboard?activeToolName=DashboardHome',
    'servers':        '/Home/Servers',
    'campaigns':      '/Home/CampaignServers',
    'forum':          '/Home/Forum',
    'news':           '/Home/News',
    'status':         '/Home/Status',
    'about':          '/Home/About',
  };
  if (portalSubpages[key]) {
    return './portal.html?subpage=' + encodeURIComponent(portalSubpages[key]);
  }

  // External links
  const externalLinks = {
    'localplatform':  'http://192.168.0.243:8081/',
    'grafana':        'http://192.168.0.243:3000/',
    'meshy':          'https://www.meshy.ai/@fisher_m_uksf',
    'suno':           'https://suno.com/@frostebite',
    'invokeai':       'http://192.168.0.251:9090',
    'comfyui':        'http://192.168.0.251:8000',
    'webplatformactions': 'https://github.com/frostebite/WebPlatform/actions',
    'gameclientactions':  'https://github.com/frostebite/GameClient/actions',
  };
  if (externalLinks[key]) return externalLinks[key];

  // Cloud tunnel link
  if (key === 'cloudtunnel' || key === 'cloud' || key === 'tunnel') {
    const tunnel = getTunnelForPreferredEnvironment();
    if (tunnel && tunnel.address) return tunnel.address;
  }

  // Portal link (just open portal.html)
  if (key === 'portal') return './portal.html';

  return null;
}

// Initialize: Load config and check for previous sign-in
window.addEventListener('DOMContentLoaded', async () => {
  // CRITICAL: Check for link mode FIRST, before loadConfig or any other initialization.
  // This prevents any other code path from stripping URL params or triggering auto sign-in.
  const earlyParams = new URLSearchParams(window.location.search);
  const earlyLinkParam = earlyParams.get('link');
  const earlyLinkingMode = earlyParams.get('linkingModeEnabled');
  const earlyProvider = earlyParams.get('provider');
  const earlyLinkProvider = earlyLinkParam || (earlyLinkingMode === 'true' ? earlyProvider : null);

  if (earlyLinkProvider) {
    console.log('[EARLY LINK] Link mode detected before loadConfig, provider:', earlyLinkProvider);

    // Store link mode in localStorage immediately
    try {
      localStorage.setItem('linkingModeEnabled', 'true');
      localStorage.setItem('oauth_link_mode', 'true');
      localStorage.setItem('oauth_link_provider', earlyLinkProvider);
      const earlyReturnUrl = earlyParams.get('returnUrl');
      if (earlyReturnUrl) {
        localStorage.setItem('oauth_return_url', earlyReturnUrl);
      }
      // Store linkToken as bb_gateway_token for cross-origin account linking auth.
      // The callback-api.js reads this and sends it to the backend exchange-code endpoint
      // so the backend can identify which existing user to link the new provider to.
      const earlyLinkToken = earlyParams.get('linkToken');
      if (earlyLinkToken) {
        localStorage.setItem('bb_gateway_token', earlyLinkToken);
        console.log('[EARLY LINK] Stored linkToken as bb_gateway_token for cross-origin auth');
      }
    } catch (e) {
      console.error('[EARLY LINK] Failed to store linking mode:', e);
    }

    // Send debug analytics before anything else
    if (typeof sendDebugEventNow === 'function') {
      sendDebugEventNow('EARLY_LINK_MODE_DETECTED', {
        provider: earlyLinkProvider,
        returnUrl: earlyParams.get('returnUrl'),
        url: window.location.href
      });
    }

    // Load config, then immediately start OAuth for the link provider
    await loadConfig();
    saveOriginalSignInHTML();
    console.log('[EARLY LINK] Config loaded, starting OAuth flow for', earlyLinkProvider);
    handleSignIn(earlyLinkProvider);
    console.log('[EARLY LINK] handleSignIn returned, exiting DOMContentLoaded');
    return; // Skip ALL other initialization
  }

  // Send debug analytics at the very start of initialization (before loadConfig)
  if (typeof sendDebugEventNow === 'function') {
    sendDebugEventNow('GATEWAY_INIT_START', {
      url: window.location.href,
      search: window.location.search,
      hasLinkParam: new URLSearchParams(window.location.search).has('link'),
      hasProviderParam: new URLSearchParams(window.location.search).has('provider'),
      preferAutoSignIn: localStorage.getItem('preferAutoSignIn'),
      oauthLinkMode: localStorage.getItem('oauth_link_mode'),
      linkingModeEnabled: localStorage.getItem('linkingModeEnabled')
    });
  }

  await loadConfig();
  saveOriginalSignInHTML();

  // Check for open-link parameter — immediately navigate to the matching quick link
  const openLinkParam = earlyParams.get('open-link');
  if (openLinkParam) {
    const resolved = resolveQuickLink(openLinkParam);
    if (resolved) {
      console.log('[OPEN-LINK] Resolved quick link:', openLinkParam, '->', resolved);
      window.location.href = resolved;
      return;
    }
    console.warn('[OPEN-LINK] Unknown quick link:', openLinkParam);
  }

  // Check for service worker install mode (#install-sw hash)
  if (window.location.hash === '#install-sw') {
    showServiceWorkerInstallUI();
    return; // Don't proceed with normal initialization
  }

  // Initially disable sign-in buttons until health check passes
  // isCloudServiceHealthy starts as false, so this will disable buttons
  updateSignInButtonStates();

  // Initialize foldout menus
  initializeFoldoutMenus();

  // Initialize quick links tabs
  initQuickLinksTabs();
  
  // Update tunnel links from config
  updateTunnelLinks();

  // Render recent releases feed
  renderReleasesFeed();

  // Position right-side panels (remembered-tokens below quick-links)
  positionRightSidePanels();

  // Update environment selector after CONFIG loads
  updateEnvironmentUrl();
  
  // Initialize prefer portal checkbox
  const preferPortalCheckbox = document.getElementById('preferPortalCheckbox');
  if (preferPortalCheckbox) {
    // Load saved preference (default to true)
    const savedPreference = localStorage.getItem('preferPortal');
    preferPortalCheckbox.checked = savedPreference !== 'false';
    
    // Save preference when changed
    preferPortalCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('preferPortal', e.target.checked ? 'true' : 'false');
      console.log('Prefer portal setting saved:', e.target.checked);
      if (typeof trackGatewayEvent === 'function') trackGatewayEvent('setting_changed', { setting: 'preferPortal', value: e.target.checked });
    });
  }

  // Initialize prefer token checkbox
  const preferTokenCheckbox = document.getElementById('preferTokenCheckbox');
  if (preferTokenCheckbox) {
    // Load saved preference (default to false)
    const savedPreference = localStorage.getItem('preferToken');
    preferTokenCheckbox.checked = savedPreference === 'true';
    
    // Save preference when changed
    preferTokenCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('preferToken', e.target.checked ? 'true' : 'false');
      console.log('Prefer token setting saved:', e.target.checked);
      if (typeof trackGatewayEvent === 'function') trackGatewayEvent('setting_changed', { setting: 'preferToken', value: e.target.checked });
    });
  }

  // Initialize prefer auto sign in checkbox
  const preferAutoSignInCheckbox = document.getElementById('preferAutoSignInCheckbox');
  if (preferAutoSignInCheckbox) {
    // Load saved preference (default to false)
    const savedPreference = localStorage.getItem('preferAutoSignIn');
    preferAutoSignInCheckbox.checked = savedPreference === 'true';

    // Save preference when changed
    preferAutoSignInCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('preferAutoSignIn', e.target.checked ? 'true' : 'false');
      console.log('Prefer auto sign in setting saved:', e.target.checked);
      if (typeof trackGatewayEvent === 'function') trackGatewayEvent('setting_changed', { setting: 'preferAutoSignIn', value: e.target.checked });
    });
  }

  // Initialize skip countdown checkbox
  const skipCountdownCheckbox = document.getElementById('skipCountdownCheckbox');
  if (skipCountdownCheckbox) {
    // Load saved preference (default to false)
    const savedSkipCountdown = localStorage.getItem('skipCountdown');
    skipCountdownCheckbox.checked = savedSkipCountdown === 'true';

    // Save preference when changed
    skipCountdownCheckbox.addEventListener('change', (e) => {
      localStorage.setItem('skipCountdown', e.target.checked ? 'true' : 'false');
      console.log('Skip countdown setting saved:', e.target.checked);
      if (typeof trackGatewayEvent === 'function') trackGatewayEvent('setting_changed', { setting: 'skipCountdown', value: e.target.checked });
    });
  }

  // Initialize debug mode checkbox
  const debugModeCheckbox = document.getElementById('debugModeCheckbox');
  const debugEditLinkContainer = document.getElementById('debugEditLinkContainer');
  const debugModeLabel = debugModeCheckbox ? debugModeCheckbox.closest('label') : null;

  const updateDebugModeVisibility = (isEnabled) => {
    // Show/hide the edit link
    if (debugEditLinkContainer) {
      debugEditLinkContainer.style.display = isEnabled ? 'flex' : 'none';
    }
    // Keep debug checkbox visible when debug mode is enabled (persists across spacebar release)
    if (debugModeLabel) {
      if (isEnabled) {
        debugModeLabel.style.display = 'flex';
      }
      // Note: when disabled, visibility is controlled by showDeveloperOptions/hideDeveloperOptions
    }
  };

  if (debugModeCheckbox) {
    // Load saved preference (default to false)
    const savedDebugMode = typeof isDebugModeEnabled === 'function' ? isDebugModeEnabled() : false;
    debugModeCheckbox.checked = savedDebugMode;
    updateDebugModeVisibility(savedDebugMode);

    // Save preference when changed
    debugModeCheckbox.addEventListener('change', (e) => {
      updateDebugModeVisibility(e.target.checked);
      if (typeof setDebugMode === 'function') {
        setDebugMode(e.target.checked);
        console.log('Debug mode setting saved:', e.target.checked);
        if (typeof trackGatewayEvent === 'function') trackGatewayEvent('setting_changed', { setting: 'debugMode', value: e.target.checked });
      }
    });
  }
  
  // Check for storeToken parameter (from remember me flow)
  const urlParams = new URLSearchParams(window.location.search);
  const tokenToStore = urlParams.get('storeToken');
  const returnUrl = urlParams.get('returnUrl');
  
  if (tokenToStore) {
    console.log('Store token parameter detected, storing token and redirecting to .NET app');
    
    // Store the token
    if (storeToken(tokenToStore)) {
      // Clean URL by removing storeToken parameter
      urlParams.delete('storeToken');
      const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
      window.history.replaceState({}, document.title, newUrl);
      
      // Get cloud tunnel address from config (use preferred environment)
      const productionTunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
      
      if (productionTunnel && productionTunnel.address) {
        // Build token authentication URL
        const finalReturnUrl = returnUrl || '/Home/Index';
        const tokenAuthUrl = `${productionTunnel.address.replace(/\/$/, '')}/pr-auth/signin?token=${encodeURIComponent(tokenToStore)}&returnUrl=${encodeURIComponent(finalReturnUrl)}`;
        
        console.log('Redirecting to .NET app with stored token for authentication');
        
        // Use form submission to ensure cookies are set correctly
        const form = document.createElement('form');
        form.method = 'GET';
        form.action = tokenAuthUrl;
        form.style.display = 'none';
        document.body.appendChild(form);
        
        // Small delay to ensure token is stored before redirect
        setTimeout(() => {
          form.submit();
        }, 100);
        
        // Show loading message
        const container = document.querySelector('.sign-in-container');
        if (container) {
          container.innerHTML = `
            <div class="spinner"></div>
            <h1>Storing Token...</h1>
            <p class="message">Token saved! Redirecting to sign you in...</p>
          `;
        }
        
        return; // Don't proceed with normal initialization
      } else {
        console.error('No cloud tunnel configured, cannot redirect to .NET app');
        showErrorModal('Configuration Error', 'No cloud tunnel configured. Cannot complete token storage flow.');
      }
    } else {
      console.error('Failed to store token');
      showErrorModal('Error', 'Failed to store authentication token. Please try signing in again.');
    }
  }
  
  // Check for linking mode URL parameters
  // Supports two formats:
  //   ?link=discord&returnUrl=...  (from Settings page link buttons)
  //   ?linkingModeEnabled=true&provider=discord&returnUrl=...  (legacy format)
  const linkingModeParams = new URLSearchParams(window.location.search);
  const linkingModeEnabled = linkingModeParams.get('linkingModeEnabled');
  const linkParam = linkingModeParams.get('link');
  const provider = linkingModeParams.get('provider');
  const returnUrlForLink = linkingModeParams.get('returnUrl');

  // Determine the link provider from either format
  const linkProvider = linkParam || (linkingModeEnabled === 'true' ? provider : null);

  if (linkProvider) {
    // Link mode - set storage and immediately start OAuth for the provider
    // This must run before any auto sign-in or health check UI can interfere
    console.log('Link mode detected for provider:', linkProvider);
    console.log('Return URL:', returnUrlForLink);

    // Send debug analytics BEFORE any redirect (fire-and-forget via sendBeacon)
    if (typeof sendDebugEventNow === 'function') {
      sendDebugEventNow('LINK_MODE_DETECTED', {
        provider: linkProvider,
        returnUrl: returnUrlForLink,
        linkParam: linkParam,
        linkingModeEnabled: linkingModeEnabled,
        urlProvider: provider
      });
    }

    try {
      localStorage.setItem('linkingModeEnabled', 'true');
      localStorage.setItem('oauth_link_mode', 'true');
      localStorage.setItem('oauth_link_provider', linkProvider);
      if (returnUrlForLink) {
        localStorage.setItem('oauth_return_url', returnUrlForLink);
      }
      // Store linkToken as bb_gateway_token for cross-origin account linking auth
      const lateLinkToken = linkingModeParams.get('linkToken');
      if (lateLinkToken) {
        localStorage.setItem('bb_gateway_token', lateLinkToken);
        console.log('Link mode: Stored linkToken as bb_gateway_token for cross-origin auth');
      }
    } catch (e) {
      console.error('Failed to store linking mode:', e);
    }

    // Start the OAuth flow immediately - skip all other initialization
    console.log('Link mode: starting OAuth flow for', linkProvider);
    handleSignIn(linkProvider);
    console.log('Link mode: handleSignIn returned, exiting DOMContentLoaded');
    return; // Skip health checks, auto sign-in, everything else
  }

  if (!linkingModeEnabled) {
    // No link parameters at all - clear any stale linking mode
    try {
      localStorage.removeItem('linkingModeEnabled');
      localStorage.removeItem('oauth_link_mode');
      localStorage.removeItem('oauth_link_provider');
    } catch (e) {
      console.warn('Failed to clear linking mode:', e);
    }
  }

  // Check for ?provider= parameter (regular sign-in from Login page, NOT link mode)
  // This must also run immediately and skip all other initialization
  if (provider) {
    console.log('Provider sign-in requested from URL:', provider);
    handleSignIn(provider);
    return; // Skip health checks, auto sign-in, everything else
  }

  // Check for successful token sign-in redirect (from backend after successful authentication)
  // This happens when backend redirects back to gateway.html after successful token authentication
  const tokenSignInTarget = urlParams.get('tokenSignInTarget');
  const tunnelUrl = urlParams.get('tunnelUrl');
  const tokenFromBackend = urlParams.get('token');
  
  // If we have a token sign-in target and no error, redirect to the target
  if (tokenSignInTarget && !urlParams.has('error') && !urlParams.has('error_description')) {
    // Clear the attempt marker since authentication was successful
    try {
      sessionStorage.removeItem('tokenSignInAttempt');
    } catch (e) {
      console.warn('Failed to clear token sign-in attempt marker:', e);
    }
    
    if (tokenSignInTarget === 'portal') {
      // Redirect to portal.html with tunnelUrl parameter
      const currentUrl = new URL(window.location.href);
      const basePath = currentUrl.pathname.substring(0, currentUrl.pathname.lastIndexOf('/') + 1);
      const portalUrl = new URL(`${currentUrl.origin}${basePath}portal.html`);
      if (tunnelUrl) {
        portalUrl.searchParams.set('tunnelUrl', tunnelUrl);
      }
      if (tokenFromBackend) {
        portalUrl.searchParams.set('token', tokenFromBackend);
      }
      // Clean URL parameters before redirecting
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
      console.log('Token sign-in successful, redirecting to portal with tunnelUrl:', tunnelUrl);
      window.location.href = portalUrl.toString();
      return; // Don't proceed with error checking
    } else if (tokenSignInTarget === 'tunnel' && tunnelUrl) {
      // Redirect to tunnel
      // Clean URL parameters before redirecting
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
      console.log('Token sign-in successful, redirecting to tunnel...');
      window.location.href = tunnelUrl;
      return; // Don't proceed with error checking
    }
  }
  
  // Check for error parameters in URL (from backend redirects)
  const errorParams = new URLSearchParams(window.location.search);
  const error = errorParams.get('error');
  const errorDescription = errorParams.get('error_description');
  const errorProvider = errorParams.get('provider');
  
  // Check for provider-specific error parameters (steamError, discordError, etc.)
  const steamError = errorParams.get('steamError');
  const steamErrorDescription = errorParams.get('steamErrorDescription');
  const steamDebugInfo = errorParams.get('steamDebugInfo'); // Debug information from backend (if feature flag enabled)
  const discordError = errorParams.get('discordError');
  const discordErrorDescription = errorParams.get('discordErrorDescription');
  const googleError = errorParams.get('googleError');
  const googleErrorDescription = errorParams.get('googleErrorDescription');
  const githubError = errorParams.get('githubError');
  const githubErrorDescription = errorParams.get('githubErrorDescription');
  
  // Determine which error to show (provider-specific takes precedence)
  let finalError = error;
  let finalErrorDescription = errorDescription;
  let finalErrorProvider = errorProvider;
  
  if (steamError || steamErrorDescription) {
    finalError = steamError || 'steam_auth_failed';
    finalErrorDescription = steamErrorDescription || 'Steam authentication failed';
    finalErrorProvider = 'steam';
  } else if (discordError || discordErrorDescription) {
    finalError = discordError || 'discord_auth_failed';
    finalErrorDescription = discordErrorDescription || 'Discord authentication failed';
    finalErrorProvider = 'discord';
  } else if (googleError || googleErrorDescription) {
    finalError = googleError || 'google_auth_failed';
    finalErrorDescription = googleErrorDescription || 'Google authentication failed';
    finalErrorProvider = 'google';
  } else if (githubError || githubErrorDescription) {
    finalError = githubError || 'github_auth_failed';
    finalErrorDescription = githubErrorDescription || 'GitHub authentication failed';
    finalErrorProvider = 'github';
  }
  
  if (finalError || finalErrorDescription) {
    // Decode error description if it's URL encoded
    let decodedErrorDescription = finalErrorDescription;
    if (decodedErrorDescription) {
      try {
        decodedErrorDescription = decodeURIComponent(decodedErrorDescription);
      } catch (e) {
        console.warn('Failed to decode error description:', e);
      }
    }
    
    const providerName = finalErrorProvider 
      ? finalErrorProvider.charAt(0).toUpperCase() + finalErrorProvider.slice(1)
      : 'Authentication';
    
    // Build detailed error message with debugging info
    const currentUrl = window.location.href;
    const timestamp = new Date().toISOString();
    
    // Decode debug info if present (from backend when DebugAuthentication feature flag is enabled)
    let decodedDebugInfo = '';
    if (steamDebugInfo) {
      try {
        decodedDebugInfo = decodeURIComponent(steamDebugInfo);
        console.log('[Steam Debug Info] Backend debug information received:', decodedDebugInfo);
      } catch (e) {
        console.warn('Failed to decode steam debug info:', e);
        decodedDebugInfo = steamDebugInfo;
      }
    }
    
    const errorDetails = [
      `${providerName} Authentication Error: ${finalError || 'unknown_error'}`,
      decodedErrorDescription ? `Description: ${decodedErrorDescription}` : '',
      '',
      'Debug Information:',
      `Timestamp: ${timestamp}`,
      `URL: ${currentUrl}`,
      `Provider: ${finalErrorProvider || 'unknown'}`,
      decodedDebugInfo ? '\n=== Backend Debug Information (DebugAuthentication feature flag enabled) ===' : '',
      decodedDebugInfo ? decodedDebugInfo : '',
      decodedDebugInfo ? '=== End Backend Debug Information ===' : ''
    ].filter(line => line !== '').join('\n');
    
    // Show formatted error in modal
    let displayMessage = [
      `${providerName} Authentication Error: ${finalError || 'unknown_error'}`,
      decodedErrorDescription ? `\n${decodedErrorDescription}` : ''
    ].join('');
    
    // Special handling for code_already_used - encourage user to try again
    // Clear any stored state/codes and force a fresh sign-in
    if (error === 'code_already_used') {
      displayMessage = `The authentication code was already used. This usually happens if you refreshed the page or tried to sign in again too quickly.\n\nClicking "Try Again" will start a completely fresh sign-in with a new authorization code.`;
      
      // Clear any stored state that might cause issues
      // This ensures the next sign-in attempt gets a fresh code
      try {
        // Clear any localStorage items that might interfere
        localStorage.removeItem('oauth_state');
        localStorage.removeItem('oauth_provider');
        console.log('Cleared stored OAuth state for fresh sign-in');
      } catch (e) {
        console.warn('Failed to clear stored OAuth state:', e);
      }
    }
    
    // Special handling for state_missing (Steam authentication correlation cookie issue)
    if (finalError === 'state_missing' || steamError === 'state_missing') {
      displayMessage = `Steam Authentication Error: The authentication response was rejected because the state parameter was missing or invalid.\n\nThis usually happens when:\n1. You changed the environment selector between starting authentication and Steam redirecting back\n2. The correlation cookie was blocked by your browser\n3. There was a network issue during authentication\n4. The state parameter doesn't match what's stored in the correlation cookie\n\nPlease try signing in again, and make sure you don't change the environment selector during the authentication process.`;
      
      // If debug info is available, add it to the display message
      if (decodedDebugInfo) {
        displayMessage += `\n\n=== Backend Debug Information (DebugAuthentication feature flag enabled) ===\n${decodedDebugInfo}\n=== End Backend Debug Information ===`;
        console.log('[Steam Authentication] Backend debug information:', decodedDebugInfo);
      }
      
      // Clear any stored OAuth state
      try {
        sessionStorage.removeItem('oauthSignInAttempt');
        console.log('Cleared stored OAuth sign-in attempt for fresh sign-in');
      } catch (e) {
        console.warn('Failed to clear stored OAuth sign-in attempt:', e);
      }
    }
    
    // Special handling for token_expired - clear expired token and update UI
    if (error === 'token_expired' || error === 'invalid_token' || error === 'authentication_failed') {
      // Note: We can't identify which specific token expired, so we'll let the user remove it manually
      // The backend will reject expired tokens, and users can remove them from the list
      console.log('Token authentication failed:', error);
      updateTokenStatus();
      updateRememberedTokensList();
      
      if (error === 'token_expired') {
        displayMessage = `Your authentication token has expired. Please sign in again using one of the providers above, or remove the expired token from your remembered tokens list.`;
      } else if (error === 'invalid_token') {
        displayMessage = `The authentication token is invalid or has been revoked. Please sign in again using one of the providers above, or remove the invalid token from your remembered tokens list.`;
      } else if (error === 'authentication_failed') {
        displayMessage = `Token authentication failed. The token may be invalid, expired, or the backend service may be unavailable.\n\nPlease try:\n1. Signing in again with a fresh token\n2. Checking if the backend service is running\n3. Removing the token from your remembered tokens list`;
      }
      
      // Add more context to error details
      errorDetails = [
        `${providerName} Token Authentication Error: ${error || 'unknown_error'}`,
        decodedErrorDescription ? `Description: ${decodedErrorDescription}` : '',
        '',
        'Possible Causes:',
        '- Token has expired',
        '- Token was revoked or invalidated',
        '- Backend service is unavailable',
        '- Network connectivity issues',
        '',
        'Debug Information:',
        `Timestamp: ${timestamp}`,
        `URL: ${currentUrl}`,
        `Provider: ${errorProvider || 'token'}`,
        '',
        'Suggested Actions:',
        '1. Try signing in again with a new token',
        '2. Check the console for detailed error messages',
        '3. Verify the backend service is running',
        '4. Remove expired/invalid tokens from your remembered tokens list'
      ].filter(line => line !== '').join('\n');
    }
    
    showErrorModal(`${providerName} Authentication Failed`, displayMessage, errorDetails);
    
    // Log debug info to console for easy access
    if (decodedDebugInfo) {
      console.group('🔍 Steam Authentication Debug Information (Backend)');
      console.log(decodedDebugInfo);
      console.groupEnd();
    }
    
    // Clean URL by removing error parameters (but keep debug info in console)
    errorParams.delete('error');
    errorParams.delete('error_description');
    errorParams.delete('provider'); // Note: this removes the 'provider' query param, not the variable
    errorParams.delete('steamError');
    errorParams.delete('steamErrorDescription');
    errorParams.delete('steamDebugInfo'); // Remove debug info from URL after displaying
    const newUrl = window.location.pathname + (errorParams.toString() ? '?' + errorParams.toString() : '');
    window.history.replaceState({}, document.title, newUrl);
    
    // For code_already_used, add a "Try Again" button that clears everything and starts fresh
    if (error === 'code_already_used') {
      // The error modal will be shown, and user can click the sign-in button again
      // The prompt=consent parameter will force GitHub to generate a new code
    }
    
    return; // Don't proceed with sign-in check
  }
  
  // Check if we were redirected back to gateway.html unexpectedly after a token sign-in attempt
  // This can happen if the backend redirects back without error parameters
  const redirectCheck = sessionStorage.getItem('tokenSignInAttempt');
  if (redirectCheck) {
    const attemptData = JSON.parse(redirectCheck);
    const timeSinceAttempt = Date.now() - attemptData.timestamp;
    
    // If we're back here within 10 seconds of a token sign-in attempt, it likely failed
    if (timeSinceAttempt < 10000) {
      console.warn('Detected unexpected redirect back to gateway.html after token sign-in attempt');
      console.warn('Attempt details:', attemptData);
      
      // Check if there are any error parameters we might have missed
      const urlParams = new URLSearchParams(window.location.search);
      const hasErrorParams = urlParams.has('error') || urlParams.has('error_description');
      
      // Check if this is a new format returnUrl (gateway.html with tokenSignInTarget)
      // or old format (direct tunnel/portal URL)
      const isNewFormat = attemptData.targetUrl && attemptData.targetUrl.includes('gateway.html');
      const isOldFormat = attemptData.targetUrl && (attemptData.targetUrl.includes('trycloudflare.com') || attemptData.targetUrl.includes('portal.html'));
      
      if (!hasErrorParams) {
        // No error parameters, but we're back here - likely a silent failure
        // Check referrer to see if we came from the tunnel
        const referrer = document.referrer || 'none';
        const cameFromTunnel = referrer.includes('trycloudflare.com') || (isOldFormat && referrer.includes(attemptData.targetUrl || ''));
        
        let redirectChain;
        if (isNewFormat) {
          redirectChain = 'Backend → Gateway (new format - error parameters should be preserved)';
        } else if (cameFromTunnel) {
          redirectChain = 'Backend → Tunnel → Gateway (old format - error parameters may have been lost)';
        } else {
          redirectChain = 'Backend → Gateway (direct redirect)';
        }
        
        const errorDetails = [
          'Token Sign-In Redirect Issue',
          '',
          'You were redirected back to the sign-in page after attempting to authenticate with a saved token.',
          'This usually indicates one of the following:',
          '',
          'Possible Causes:',
          '1. The authentication token is invalid or expired (most likely)',
          isOldFormat ? '2. The backend service redirected to the tunnel with error parameters, but the tunnel redirected back without them (old returnUrl format)' : '2. The backend service redirected back without proper error handling',
          '3. The backend service is not responding correctly',
          '4. There was a network connectivity issue',
          '',
          'Debug Information:',
          `Attempt Time: ${new Date(attemptData.timestamp).toISOString()}`,
          `Time Since Attempt: ${Math.round(timeSinceAttempt / 1000)} seconds`,
          `Target URL: ${attemptData.targetUrl || 'unknown'}`,
          `Backend URL: ${attemptData.backendUrl || 'unknown'}`,
          `Referrer: ${referrer}`,
          `Redirect Chain: ${redirectChain}`,
          `ReturnUrl Format: ${isNewFormat ? 'New (gateway.html)' : isOldFormat ? 'Old (direct tunnel/portal)' : 'Unknown'}`,
          '',
          isOldFormat ? 'Note: This appears to be using the old returnUrl format (direct tunnel URL). The new format redirects to gateway.html first to preserve error parameters. If you see this message, please refresh the page to get the latest code.' : 'Note: If the backend redirected with error parameters, they should be preserved. Check backend logs for the specific failure reason.',
          '',
          'Suggested Actions:',
          '1. Check the browser console for detailed error messages',
          '2. Check backend logs for authentication errors (the backend should log why token validation failed)',
          '3. Try signing in again with a fresh token using one of the OAuth providers',
          '4. Verify the backend service is running and accessible',
          '5. Remove the expired/invalid token from your remembered tokens list and try again',
          '',
          'If this token was previously working, it may have expired. Tokens typically expire after a set period.'
        ].join('\n');
        
        console.error('Token authentication failed - redirect chain analysis:');
        console.error('  Referrer:', referrer);
        console.error('  Target URL:', attemptData.targetUrl);
        console.error('  Backend URL:', attemptData.backendUrl);
        console.error('  Redirect Chain:', redirectChain);
        console.error('  ReturnUrl Format:', isNewFormat ? 'New (gateway.html)' : isOldFormat ? 'Old (direct tunnel/portal)' : 'Unknown');
        console.error('  Note: Backend should have logged the reason for token validation failure. Check backend logs.');
        
        showErrorModal(
          'Token Authentication Failed',
          'You were redirected back to the sign-in page after attempting to authenticate with a saved token.\n\nThis most likely means the token is invalid or expired. The backend should have logged the specific reason for the failure.\n\nPlease try signing in again with a fresh token using one of the OAuth providers above.',
          errorDetails
        );
      }
      
      // Clear the attempt marker
      sessionStorage.removeItem('tokenSignInAttempt');
    }
  }
  
  // Check if we were redirected back to gateway.html after a Steam/OAuth sign-in attempt
  // This can happen if the backend redirects back with or without error parameters
  const oauthAttemptCheck = sessionStorage.getItem('oauthSignInAttempt');
  if (oauthAttemptCheck) {
    const attemptData = JSON.parse(oauthAttemptCheck);
    const timeSinceAttempt = Date.now() - attemptData.timestamp;
    
    // If we're back here within 30 seconds of an OAuth sign-in attempt, check if it failed
    if (timeSinceAttempt < 30000) {
      console.warn('Detected redirect back to gateway.html after OAuth sign-in attempt');
      console.warn('Attempt details:', attemptData);
      
      // Check if there are any error parameters
      const urlParams = new URLSearchParams(window.location.search);
      const hasErrorParams = urlParams.has('error') || urlParams.has('error_description');
      
      if (!hasErrorParams) {
        // No error parameters, but we're back here - might be a silent failure
        // Only show if we haven't already shown an error modal
        const providerName = attemptData.provider ? attemptData.provider.charAt(0).toUpperCase() + attemptData.provider.slice(1) : 'OAuth';
        const errorDetails = [
          `${providerName} Sign-In Redirect Issue`,
          '',
          `You were redirected back to the sign-in page after attempting to authenticate with ${providerName}.`,
          'This usually indicates one of the following:',
          '',
          'Possible Causes:',
          '1. The authentication was cancelled',
          '2. The backend service encountered an error',
          '3. There was a network connectivity issue',
          '4. The backend redirected back without proper error handling',
          '',
          'Debug Information:',
          `Provider: ${attemptData.provider || 'unknown'}`,
          `Attempt Time: ${new Date(attemptData.timestamp).toISOString()}`,
          `Time Since Attempt: ${Math.round(timeSinceAttempt / 1000)} seconds`,
          '',
          'Suggested Actions:',
          '1. Check the browser console for detailed error messages',
          '2. Try signing in again',
          '3. Verify the backend service is running and accessible',
          '4. Check if there are any error messages displayed above'
        ].join('\n');
        
        // Only show if we don't already have error parameters (they would have been handled above)
        console.warn('No error parameters found, but redirected back after OAuth attempt');
        console.warn('This may indicate a silent failure. Check backend logs for details.');
      }
      
      // Clear the attempt marker
      sessionStorage.removeItem('oauthSignInAttempt');
    }
  }
  
  // Update token status indicator
  updateTokenStatus();
  
  // Update remembered tokens list
  updateRememberedTokensList();
  
  // Position remembered tokens panel on page load (after a short delay to ensure layout is ready)
  setTimeout(() => {
    positionRememberedTokensPanel();
  }, 100);
  
  // Check for previous sign-in
  if (checkPreviousSignIn()) {
    // Check if auto sign-in is preferred
    // Allow bypassing with ?noauto=1 URL parameter (useful if stuck in redirect loop)
    // Skip auto sign-in when linking an account or when a specific provider sign-in was requested
    const autoSignInParams = new URLSearchParams(window.location.search);
    const noAutoParam = autoSignInParams.get('noauto');
    const hasLinkParam = autoSignInParams.has('link') || autoSignInParams.get('linkingModeEnabled') === 'true';
    const hasLinkInStorage = localStorage.getItem('oauth_link_mode') === 'true' || localStorage.getItem('linkingModeEnabled') === 'true';
    const hasProviderParam = autoSignInParams.has('provider') && !hasLinkParam;
    const preferAutoSignInRaw = localStorage.getItem('preferAutoSignIn') === 'true';
    const preferAutoSignIn = preferAutoSignInRaw
      && noAutoParam !== '1'
      && !hasLinkParam
      && !hasLinkInStorage
      && !hasProviderParam;

    // Debug analytics: track auto sign-in decision
    if (typeof sendDebugEventNow === 'function') {
      sendDebugEventNow('AUTO_SIGNIN_DECISION', {
        checkPreviousSignIn: true,
        preferAutoSignInRaw: preferAutoSignInRaw,
        preferAutoSignInFinal: preferAutoSignIn,
        noAutoParam: noAutoParam,
        hasLinkParam: hasLinkParam,
        hasLinkInStorage: hasLinkInStorage,
        hasProviderParam: hasProviderParam,
        url: window.location.href
      });
    }

    if (preferAutoSignIn) {
      // Get most recent token
      const tokens = getRememberedTokens();
      if (tokens.length > 0) {
        // Sort tokens by date (newest first) and use the most recent one
        const sortedTokens = [...tokens].sort((a, b) => {
          const dateA = new Date(a.rememberedAt || 0);
          const dateB = new Date(b.rememberedAt || 0);
          return dateB - dateA; // Newest first
        });

        const mostRecentToken = sortedTokens[0];
        if (mostRecentToken && mostRecentToken.id) {
          console.log('Prefer auto sign-in enabled, waiting for health check before countdown');

          // Debug analytics: auto sign-in is STARTING
          if (typeof sendDebugEventNow === 'function') {
            sendDebugEventNow('AUTO_SIGNIN_STARTING', {
              tokenId: mostRecentToken.id,
              tokenType: mostRecentToken.tokenType || 'one-time',
              tokensCount: tokens.length
            });
          }

          // Show "checking services" message while waiting for health check
          const prevContainer = document.getElementById('previousSignInContainer');
          const noContainer = document.getElementById('noSignInContainer');
          const countdownMsg = document.getElementById('countdownMessage');
          const countdownNum = document.getElementById('countdownText');

          if (prevContainer) prevContainer.style.display = 'block';
          if (noContainer) noContainer.style.display = 'none';
          if (countdownMsg) countdownMsg.textContent = 'Checking service health before sign in...';
          if (countdownNum) countdownNum.style.display = 'none';

          // Run health checks first - auto sign-in must wait for service availability
          await performHealthChecks();
          startHealthCheckAutoRefresh();

          // Check if user clicked Cancel during the health check wait
          const wasCanceled = prevContainer && prevContainer.style.display === 'none';

          if (wasCanceled) {
            console.log('Auto sign-in canceled by user during health check');
          } else if (isCloudServiceHealthy) {
            // Service is healthy, proceed with auto sign-in countdown
            if (prevContainer) prevContainer.style.display = 'none';
            if (countdownNum) countdownNum.style.display = '';
            startAutoSignInCountdown(mostRecentToken.id);
          } else {
            // Service is not healthy, redirect to normal sign-in page
            console.log('Cloud service unhealthy, canceling auto sign-in');
            if (prevContainer) prevContainer.style.display = 'none';
            if (noContainer) noContainer.style.display = 'block';
          }
          return; // Health checks already initialized, don't run again below
        }
      }
    }
    
    // Don't auto-sign in, just show the button
    // User can choose to sign in with stored token or use a different method
    const previousSignInContainer = document.getElementById('previousSignInContainer');
    const noSignInContainer = document.getElementById('noSignInContainer');
    
    if (previousSignInContainer) {
      previousSignInContainer.style.display = 'none';
    }
    if (noSignInContainer) {
      noSignInContainer.style.display = 'block';
    }
  } else {
    // Show sign-in options (already visible by default)
    const previousSignInContainer = document.getElementById('previousSignInContainer');
    const noSignInContainer = document.getElementById('noSignInContainer');
    
    if (previousSignInContainer) {
      previousSignInContainer.style.display = 'none';
    }
    if (noSignInContainer) {
      noSignInContainer.style.display = 'block';
    }
  }
  
  // Initialize health checks
  performHealthChecks().then(() => {
    // Start auto-refresh after initial check
    startHealthCheckAutoRefresh();
  });
});

// Update tunnel links from config
function updateTunnelLinks() {
  // Get tunnel for preferred environment
  const preferredTunnel = getTunnelForPreferredEnvironment();
  
  // Update Cloud Tunnel link from config
  const cloudTunnelLink = document.getElementById('cloudTunnelLink');
  if (cloudTunnelLink) {
    const cloudTunnel = preferredTunnel || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
    if (cloudTunnel && cloudTunnel.address) {
      cloudTunnelLink.href = cloudTunnel.address;
      cloudTunnelLink.style.opacity = '1';
      cloudTunnelLink.style.cursor = 'pointer';
      cloudTunnelLink.style.pointerEvents = 'auto';
      cloudTunnelLink.title = '';
      console.log('Cloud Tunnel link updated to:', cloudTunnel.address);
    } else {
      console.warn('Cloud tunnel not found in config, keeping placeholder link');
      cloudTunnelLink.style.opacity = '0.5';
      cloudTunnelLink.style.cursor = 'not-allowed';
      cloudTunnelLink.style.pointerEvents = 'none';
      cloudTunnelLink.title = 'Cloud tunnel not configured';
    }
  }
  
  // SignalR is now unified with Cloud service - no separate tunnel link needed
}

// Health Check Functions
let healthCheckCountdownInterval = null;
let healthCheckAutoRefreshInterval = null;
const HEALTH_CHECK_REFRESH_INTERVAL = 30; // 30 seconds

async function checkCloudServiceHealth() {
  // Get tunnel for preferred environment (includes fallback to 'cloud' if env-specific not found)
  const cloudTunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
  const statusElement = document.getElementById('cloudServiceStatus');
  const checkmarkElement = document.getElementById('cloudServiceCheckmark');
  const statusTextElement = document.getElementById('cloudServiceStatusText');
  const urlElement = document.getElementById('cloudServiceUrl');
  
  if (!cloudTunnel || !cloudTunnel.address) {
    console.warn('Cloud Service health check: No tunnel found. Available tunnels:', CONFIG.cloudflareTunnels?.map(t => t.name) || []);
    if (statusElement) {
      statusElement.style.background = 'rgba(255, 100, 100, 0.3)';
    }
    if (checkmarkElement) {
      checkmarkElement.style.display = 'none';
    }
    if (statusTextElement) {
      statusTextElement.textContent = 'Not available';
      statusTextElement.style.color = 'rgba(255, 100, 100, 0.8)';
    }
    if (urlElement) {
      urlElement.textContent = 'No tunnel configured';
    }
    // Update global health status and disable sign-in buttons
    isCloudServiceHealthy = false;
    updateSignInButtonStates();
    return false;
  }
  
  const cleanBaseUrl = cloudTunnel.address.replace(/\/$/, '');
  const healthUrl = `${cleanBaseUrl}/api/HealthCheck/system`;
  
  // Update URL display
  if (urlElement) {
    urlElement.textContent = healthUrl;
  }
  
  try {
    // Suppress console errors for expected health check failures
    const originalConsoleError = console.error;
    const suppressHealthCheckErrors = () => {
      console.error = (...args) => {
        const errorStr = args.join(' ');
        // Suppress CORS, 502, and network errors during health checks
        if (errorStr.includes('CORS') || 
            errorStr.includes('Access-Control-Allow-Origin') ||
            errorStr.includes('502') ||
            errorStr.includes('Bad Gateway') ||
            errorStr.includes('ERR_FAILED') ||
            errorStr.includes('ERR_ABORTED') ||
            errorStr.includes('Failed to fetch')) {
          // Suppress these expected errors - they're handled as health check failures
          return;
        }
        originalConsoleError.apply(console, args);
      };
    };
    const restoreConsoleError = () => {
      console.error = originalConsoleError;
    };
    
    suppressHealthCheckErrors();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*'
        },
        signal: controller.signal,
        mode: 'cors'
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        // Cloud service is healthy - don't check agent service status here
        // Agent service status is checked separately in checkAgentStatus()
        // Cloud service should show green if the endpoint responds OK, regardless of agent service status

        // Health check passed
        if (statusElement) {
          statusElement.style.background = 'rgba(100, 255, 100, 0.3)';
        }
        if (checkmarkElement) {
          checkmarkElement.style.display = 'block';
          checkmarkElement.style.color = 'rgba(100, 255, 100, 1)';
        }
        if (statusTextElement) {
          statusTextElement.textContent = 'Healthy';
          statusTextElement.style.color = 'rgba(100, 255, 100, 0.8)';
        }

        // Fetch version info
        const versionElement = document.getElementById('cloudServiceVersion');
        if (versionElement) {
          try {
            const versionUrl = `${cleanBaseUrl}/api/HealthCheck/version`;
            const versionResponse = await fetch(versionUrl, {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
              mode: 'cors'
            });
            if (versionResponse.ok) {
              const versionData = await versionResponse.json();
              if (versionData.gitSha && versionData.gitSha !== 'Unknown') {
                const shortSha = versionData.gitSha.substring(0, 8);
                versionElement.textContent = `v${shortSha}`;
                versionElement.title = `Full SHA: ${versionData.gitSha}`;
              }
            }
          } catch (versionErr) {
            // Silently ignore version fetch errors
          }
        }

        // Update global health status and enable sign-in buttons
        isCloudServiceHealthy = true;
        updateSignInButtonStates();
        return true;
      } else {
      // Health check failed - non-OK status code
      const statusCode = response.status;
      let errorMessage = 'Not available';
      
      if (statusCode >= 500) {
        errorMessage = `Server error (${statusCode})`;
      } else if (statusCode === 404) {
        errorMessage = 'Not found';
      } else if (statusCode === 403 || statusCode === 401) {
        errorMessage = 'Unauthorized';
      } else if (statusCode >= 400) {
        errorMessage = `Client error (${statusCode})`;
      }
      
      // Don't log expected health check failures (502, etc.)
      if (statusCode !== 502) {
        console.warn('Cloud Service health check failed with status:', statusCode);
      }
      if (statusElement) {
        statusElement.style.background = 'rgba(255, 100, 100, 0.3)';
      }
      if (checkmarkElement) {
        checkmarkElement.style.display = 'none';
      }
      if (statusTextElement) {
        statusTextElement.textContent = errorMessage;
        statusTextElement.style.color = 'rgba(255, 100, 100, 0.8)';
      }
        // Update global health status and disable sign-in buttons
        isCloudServiceHealthy = false;
        updateSignInButtonStates();
        return false;
      }
    } finally {
      restoreConsoleError();
    }
  } catch (error) {
    // Network error, timeout, or abort - always resolve to "Not available"
    // Suppress logging for expected health check failures
    const isExpectedFailure = error.name === 'AbortError' ||
      (error.message && (
        error.message.includes('CORS') ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('NetworkError') ||
        error.message.includes('502') ||
        error.message.includes('Bad Gateway')
      ));
    
    // Only log unexpected errors
    if (!isExpectedFailure) {
      console.warn('Cloud Service health check error:', error);
    }
    if (statusElement) {
      statusElement.style.background = 'rgba(255, 200, 100, 0.3)';
    }
    if (checkmarkElement) {
      checkmarkElement.style.display = 'none';
    }
    if (statusTextElement) {
      statusTextElement.textContent = 'Not available';
      statusTextElement.style.color = 'rgba(255, 200, 100, 0.8)';
    }
    // Update global health status and disable sign-in buttons
    isCloudServiceHealthy = false;
    updateSignInButtonStates();
    return false;
  }
}

async function checkAgentStatus() {
  const cloudTunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
  const statusElement = document.getElementById('agentStatusStatus');
  const checkmarkElement = document.getElementById('agentStatusCheckmark');
  const statusTextElement = document.getElementById('agentStatusStatusText');
  const urlElement = document.getElementById('agentStatusUrl');
  
  if (!cloudTunnel || !cloudTunnel.address) {
    if (statusElement) {
      statusElement.style.background = 'rgba(255, 100, 100, 0.3)';
    }
    if (checkmarkElement) {
      checkmarkElement.style.display = 'none';
    }
    if (statusTextElement) {
      statusTextElement.textContent = 'Not available';
      statusTextElement.style.color = 'rgba(255, 100, 100, 0.8)';
    }
    if (urlElement) {
      urlElement.textContent = 'No tunnel configured';
    }
    return false;
  }
  
  const cleanBaseUrl = cloudTunnel.address.replace(/\/$/, '');
  const healthUrl = `${cleanBaseUrl}/api/HealthCheck/system`;
  
  // Update URL display
  if (urlElement) {
    urlElement.textContent = healthUrl;
  }
  
  try {
    // Suppress console errors for expected health check failures
    const originalConsoleError = console.error;
    const suppressHealthCheckErrors = () => {
      console.error = (...args) => {
        const errorStr = args.join(' ');
        // Suppress CORS, 502, and network errors during health checks
        if (errorStr.includes('CORS') || 
            errorStr.includes('Access-Control-Allow-Origin') ||
            errorStr.includes('502') ||
            errorStr.includes('Bad Gateway') ||
            errorStr.includes('ERR_FAILED') ||
            errorStr.includes('ERR_ABORTED') ||
            errorStr.includes('Failed to fetch')) {
          // Suppress these expected errors - they're handled as health check failures
          return;
        }
        originalConsoleError.apply(console, args);
      };
    };
    const restoreConsoleError = () => {
      console.error = originalConsoleError;
    };
    
    suppressHealthCheckErrors();
    let response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      response = await fetch(healthUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*'
        },
        signal: controller.signal,
        mode: 'cors'
      });
      
      clearTimeout(timeoutId);
    } finally {
      restoreConsoleError();
    }
    
    if (response.ok) {
      // Try to parse JSON response to get agent service status
      try {
        // Read response as text first to check if it's empty
        const text = await response.text();
        
        if (text && text.trim().length > 0) {
          const trimmedText = text.trim();
          const isOkText = trimmedText === 'OK' || trimmedText.toLowerCase() === 'healthy';
          if (isOkText) {
            if (statusElement) {
              statusElement.style.background = 'rgba(100, 255, 100, 0.3)';
            }
            if (checkmarkElement) {
              checkmarkElement.style.display = 'block';
              checkmarkElement.style.color = 'rgba(100, 255, 100, 1)';
            }
            if (statusTextElement) {
              statusTextElement.textContent = 'Healthy';
              statusTextElement.style.color = 'rgba(100, 255, 100, 0.8)';
            }
            return true;
          }

          const looksLikeJson = trimmedText.startsWith('{') || trimmedText.startsWith('[');
          if (!looksLikeJson) {
            if (statusElement) {
              statusElement.style.background = 'rgba(100, 255, 100, 0.3)';
            }
            if (checkmarkElement) {
              checkmarkElement.style.display = 'block';
              checkmarkElement.style.color = 'rgba(100, 255, 100, 1)';
            }
            if (statusTextElement) {
              statusTextElement.textContent = trimmedText;
              statusTextElement.style.color = 'rgba(100, 255, 100, 0.8)';
            }
            return true;
          }

          try {
            const data = JSON.parse(trimmedText);
          if (data.agentService) {
            const agentInfo = data.agentService;
            const discordInfo = agentInfo.Discord || agentInfo.discord;
            let displayText = agentInfo.Status || agentInfo.status || 'unknown';
            let statusColor = 'rgba(255, 200, 100, 0.8)';
            let statusBg = 'rgba(255, 200, 100, 0.3)';
            let agentHealthy = false;

            if (discordInfo) {
              const isConnected = discordInfo.IsConnected ?? discordInfo.isConnected ?? false;
              const connectionState = discordInfo.ConnectionState || discordInfo.connectionState || '';

              agentHealthy = isConnected;
              displayText = isConnected ? 'Discord connected' : 'Discord disconnected';
              if (connectionState && connectionState.toLowerCase() !== 'connected') {
                displayText += ` (${connectionState})`;
              }
              statusColor = isConnected ? 'rgba(100, 255, 100, 0.8)' : 'rgba(255, 200, 100, 0.8)';
              statusBg = isConnected ? 'rgba(100, 255, 100, 0.3)' : 'rgba(255, 200, 100, 0.3)';
            } else {
              const agentStatus = agentInfo.Status || agentInfo.status || 'unknown';
              const agentError = agentInfo.error || agentInfo.Error || null;
              const agentUnreachable = agentStatus === 'unreachable' || agentStatus === 'Unreachable';
              const agentDisabled = agentStatus === 'disabled' || agentStatus === 'Disabled';

              if (agentUnreachable) {
                displayText = 'Not available';
                statusColor = 'rgba(255, 200, 100, 0.8)';
                statusBg = 'rgba(255, 200, 100, 0.3)';
              } else if (agentDisabled) {
                displayText = 'Disabled';
                statusColor = 'rgba(255, 200, 100, 0.8)';
                statusBg = 'rgba(255, 200, 100, 0.3)';
              } else if (agentError) {
                displayText = `${agentStatus} (${agentError})`;
                statusColor = 'rgba(255, 100, 100, 0.8)';
                statusBg = 'rgba(255, 100, 100, 0.3)';
              }
            }

            // no-op: connection state already appended above

            if (statusElement) {
              statusElement.style.background = statusBg;
            }
            if (checkmarkElement) {
              checkmarkElement.style.display = agentHealthy ? 'block' : 'none';
              checkmarkElement.style.color = 'rgba(100, 255, 100, 1)';
            }
            if (statusTextElement) {
              statusTextElement.textContent = displayText;
              statusTextElement.style.color = statusColor;
            }
            return agentHealthy;
          } else {
            console.warn('Agent service not found in health check response');
            if (statusElement) {
              statusElement.style.background = 'rgba(255, 200, 100, 0.3)';
            }
            if (checkmarkElement) {
              checkmarkElement.style.display = 'none';
            }
            if (statusTextElement) {
              statusTextElement.textContent = 'Unknown';
              statusTextElement.style.color = 'rgba(255, 200, 100, 0.8)';
            }
            return false;
          }
          } catch (parseError) {
            // Response has content but isn't valid JSON - show as unknown
            console.warn('Agent Status health check response is not valid JSON:', parseError);
            if (statusElement) {
              statusElement.style.background = 'rgba(255, 200, 100, 0.3)';
            }
            if (checkmarkElement) {
              checkmarkElement.style.display = 'none';
            }
            if (statusTextElement) {
              statusTextElement.textContent = 'Parse error';
              statusTextElement.style.color = 'rgba(255, 200, 100, 0.8)';
            }
            return false;
          }
        } else {
          // Empty response but status OK - check if it's just "OK" string response
          // The /api/HealthCheck/system endpoint returns "OK" as plain text, not JSON
          if (text === 'OK' || text.trim() === 'OK') {
            // This is the expected response from HealthCheck/system endpoint
            if (statusElement) {
              statusElement.style.background = 'rgba(100, 255, 100, 0.3)';
            }
            if (checkmarkElement) {
              checkmarkElement.style.display = 'block';
              checkmarkElement.style.color = 'rgba(100, 255, 100, 1)';
            }
            if (statusTextElement) {
              statusTextElement.textContent = 'Healthy';
              statusTextElement.style.color = 'rgba(100, 255, 100, 0.8)';
            }
            return true;
          } else {
            // Truly empty response - show as unknown
            console.warn('Agent Status health check returned empty response');
            if (statusElement) {
              statusElement.style.background = 'rgba(255, 200, 100, 0.3)';
            }
            if (checkmarkElement) {
              checkmarkElement.style.display = 'none';
            }
            if (statusTextElement) {
              statusTextElement.textContent = 'Unknown';
              statusTextElement.style.color = 'rgba(255, 200, 100, 0.8)';
            }
            return false;
          }
        }
      } catch (readError) {
        // If reading response fails but status is OK, show as unknown
        console.warn('Failed to read agent status health check response:', readError);
        if (statusElement) {
          statusElement.style.background = 'rgba(255, 200, 100, 0.3)';
        }
        if (checkmarkElement) {
          checkmarkElement.style.display = 'none';
        }
        if (statusTextElement) {
          statusTextElement.textContent = 'Read error';
          statusTextElement.style.color = 'rgba(255, 200, 100, 0.8)';
        }
        return false;
      }
    } else {
      // Health check failed - non-OK status code
      const statusCode = response.status;
      let errorMessage = 'Not available';
      
      if (statusCode >= 500) {
        errorMessage = `Server error (${statusCode})`;
      } else if (statusCode === 404) {
        errorMessage = 'Not found';
      } else if (statusCode === 403 || statusCode === 401) {
        errorMessage = 'Unauthorized';
      } else if (statusCode >= 400) {
        errorMessage = `Client error (${statusCode})`;
      }
      
      // Don't log expected health check failures (502, etc.)
      if (statusCode !== 502) {
        console.warn('Agent Status health check failed with status:', statusCode);
      }
      if (statusElement) {
        statusElement.style.background = 'rgba(255, 100, 100, 0.3)';
      }
      if (checkmarkElement) {
        checkmarkElement.style.display = 'none';
      }
      if (statusTextElement) {
        statusTextElement.textContent = errorMessage;
        statusTextElement.style.color = 'rgba(255, 100, 100, 0.8)';
      }
      return false;
    }
  } catch (error) {
    // Network error, timeout, or abort - always resolve to "Not available"
    // Suppress logging for expected health check failures
    const isExpectedFailure = error.name === 'AbortError' ||
      (error.message && (
        error.message.includes('CORS') ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('NetworkError') ||
        error.message.includes('502') ||
        error.message.includes('Bad Gateway')
      ));
    
    // Only log unexpected errors
    if (!isExpectedFailure) {
      console.warn('Agent Status health check error:', error);
    }
    if (statusElement) {
      statusElement.style.background = 'rgba(255, 200, 100, 0.3)';
    }
    if (checkmarkElement) {
      checkmarkElement.style.display = 'none';
    }
    if (statusTextElement) {
      statusTextElement.textContent = 'Not available';
      statusTextElement.style.color = 'rgba(255, 200, 100, 0.8)';
    }
    return false;
  }
}

async function checkSignalRHealth() {
  // SignalR is now unified with Cloud service - check through Cloud service endpoint
  // Use the same tunnel lookup and health check logic as Cloud service since they're unified
  const cloudTunnel = getTunnelForPreferredEnvironment() || CONFIG.cloudflareTunnels?.find(t => t.name === 'cloud');
  const statusElement = document.getElementById('signalrStatus');
  const checkmarkElement = document.getElementById('signalrCheckmark');
  const statusTextElement = document.getElementById('signalrStatusText');
  const urlElement = document.getElementById('signalrUrl');
  const connectionCountElement = document.getElementById('signalrConnectionCount');
  
  if (!cloudTunnel || !cloudTunnel.address) {
    console.warn('SignalR health check: No tunnel found (using same tunnel as Cloud service). Available tunnels:', CONFIG.cloudflareTunnels?.map(t => t.name) || []);
    if (statusElement) {
      statusElement.style.background = 'rgba(255, 100, 100, 0.3)';
    }
    if (checkmarkElement) {
      checkmarkElement.style.display = 'none';
    }
    if (statusTextElement) {
      statusTextElement.textContent = 'Not available';
      statusTextElement.style.color = 'rgba(255, 100, 100, 0.8)';
    }
    if (urlElement) {
      urlElement.textContent = 'No tunnel configured';
    }
    if (connectionCountElement) {
      connectionCountElement.style.display = 'none';
    }
    return false;
  }
  
  const cleanBaseUrl = cloudTunnel.address.replace(/\/$/, '');
  // Use Cloud service system health check endpoint which includes SignalR status
  const healthUrl = `${cleanBaseUrl}/api/HealthCheck/system`;
  
  // Update URL display
  if (urlElement) {
    urlElement.textContent = healthUrl;
  }
  
  try {
    // Suppress console errors for expected health check failures
    const originalConsoleError = console.error;
    const suppressHealthCheckErrors = () => {
      console.error = (...args) => {
        const errorStr = args.join(' ');
        // Suppress CORS, 502, and network errors during health checks
        if (errorStr.includes('CORS') || 
            errorStr.includes('Access-Control-Allow-Origin') ||
            errorStr.includes('502') ||
            errorStr.includes('Bad Gateway') ||
            errorStr.includes('ERR_FAILED') ||
            errorStr.includes('ERR_ABORTED') ||
            errorStr.includes('Failed to fetch')) {
          // Suppress these expected errors - they're handled as health check failures
          return;
        }
        originalConsoleError.apply(console, args);
      };
    };
    const restoreConsoleError = () => {
      console.error = originalConsoleError;
    };
    
    suppressHealthCheckErrors();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*'
        },
        signal: controller.signal,
        mode: 'cors'
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        // Try to parse the response to get SignalR connection count
        try {
          const data = await response.json();
          const signalrStatus = data.signalr;
          
          if (signalrStatus) {
            const signalrStatusText = signalrStatus.status || 'unknown';
            // SignalR is unified with Cloud service, so 'operational' means it's available
            // Also accept 'healthy' or 'Healthy' for backward compatibility
            const signalrHealthy = signalrStatusText === 'operational' || 
                                   signalrStatusText === 'healthy' || 
                                   signalrStatusText === 'Healthy';
            const connectionCount = signalrStatus.totalConnections ?? 0;
            
            if (statusElement) {
              statusElement.style.background = signalrHealthy ? 'rgba(100, 255, 100, 0.3)' : 'rgba(255, 200, 100, 0.3)';
            }
            if (checkmarkElement) {
              checkmarkElement.style.display = signalrHealthy ? 'block' : 'none';
              if (signalrHealthy) {
                checkmarkElement.style.color = 'rgba(100, 255, 100, 1)';
              }
            }
            if (statusTextElement) {
              statusTextElement.textContent = signalrHealthy ? 'Operational' : 'Degraded';
              statusTextElement.style.color = signalrHealthy ? 'rgba(100, 255, 100, 0.8)' : 'rgba(255, 200, 100, 0.8)';
            }
            if (connectionCountElement) {
              connectionCountElement.textContent = `Connections: ${connectionCount}`;
              connectionCountElement.style.display = 'block';
            }
            return signalrHealthy;
          } else {
            // SignalR status not in response - in unified mode, SignalR should always be included
            // If it's missing, the service might not have SignalR enabled or there's a configuration issue
            // Show as degraded rather than unavailable since Cloud service is running
            console.warn('SignalR status not found in health check response - SignalR may not be enabled or unified mode not configured');
            if (statusElement) {
              statusElement.style.background = 'rgba(255, 200, 100, 0.3)';
            }
            if (checkmarkElement) {
              checkmarkElement.style.display = 'none';
            }
            if (statusTextElement) {
              statusTextElement.textContent = 'Not configured';
              statusTextElement.style.color = 'rgba(255, 200, 100, 0.8)';
            }
            if (connectionCountElement) {
              connectionCountElement.style.display = 'none';
            }
            return false;
          }
        } catch (parseError) {
          console.warn('SignalR health check response is not valid JSON:', parseError);
          // If we can't parse, but got OK response, show as healthy but without connection count
          if (statusElement) {
            statusElement.style.background = 'rgba(100, 255, 100, 0.3)';
          }
          if (checkmarkElement) {
            checkmarkElement.style.display = 'block';
            checkmarkElement.style.color = 'rgba(100, 255, 100, 1)';
          }
          if (statusTextElement) {
            statusTextElement.textContent = 'Healthy';
            statusTextElement.style.color = 'rgba(100, 255, 100, 0.8)';
          }
          if (connectionCountElement) {
            connectionCountElement.style.display = 'none';
          }
          return true;
        }
      } else {
        // Health check failed - non-OK status code
        const statusCode = response.status;
        let errorMessage = 'Not available';
        
        if (statusCode >= 500) {
          errorMessage = `Server error (${statusCode})`;
        } else if (statusCode === 404) {
          errorMessage = 'Not found';
        } else if (statusCode === 403 || statusCode === 401) {
          errorMessage = 'Unauthorized';
        } else if (statusCode >= 400) {
          errorMessage = `Client error (${statusCode})`;
        }
        
        // Don't log expected health check failures (502, etc.)
        if (statusCode !== 502) {
          console.warn('SignalR Service health check failed with status:', statusCode);
        }
        if (statusElement) {
          statusElement.style.background = 'rgba(255, 100, 100, 0.3)';
        }
        if (checkmarkElement) {
          checkmarkElement.style.display = 'none';
        }
        if (statusTextElement) {
          statusTextElement.textContent = errorMessage;
          statusTextElement.style.color = 'rgba(255, 100, 100, 0.8)';
        }
        if (connectionCountElement) {
          connectionCountElement.style.display = 'none';
        }
        return false;
      }
    } finally {
      restoreConsoleError();
    }
  } catch (error) {
    // Network error, timeout, or abort - always resolve to "Not available"
    // Suppress logging for expected health check failures
    const isExpectedFailure = error.name === 'AbortError' ||
      (error.message && (
        error.message.includes('CORS') ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('NetworkError') ||
        error.message.includes('502') ||
        error.message.includes('Bad Gateway')
      ));
    
    // Only log unexpected errors
    if (!isExpectedFailure) {
      console.warn('SignalR Service health check error:', error);
    }
    if (statusElement) {
      statusElement.style.background = 'rgba(255, 200, 100, 0.3)';
    }
    if (checkmarkElement) {
      checkmarkElement.style.display = 'none';
    }
    if (statusTextElement) {
      statusTextElement.textContent = 'Not available';
      statusTextElement.style.color = 'rgba(255, 200, 100, 0.8)';
    }
    if (connectionCountElement) {
      connectionCountElement.style.display = 'none';
    }
    return false;
  }
}

async function performHealthChecks() {
  // Reload config.json to get latest tunnel addresses
  try {
    await loadConfig();
    console.log('Config reloaded for health checks');
    // Update tunnel links in Quick Links section with new addresses
    updateTunnelLinks();
  } catch (error) {
    console.warn('Failed to reload config for health checks, using cached config:', error);
    // Continue with cached config if reload fails
  }
  
  // Reset status indicators
  const cloudStatusElement = document.getElementById('cloudServiceStatus');
  const cloudStatusTextElement = document.getElementById('cloudServiceStatusText');
  const cloudCheckmarkElement = document.getElementById('cloudServiceCheckmark');
  const agentStatusStatusElement = document.getElementById('agentStatusStatus');
  const agentStatusStatusTextElement = document.getElementById('agentStatusStatusText');
  const agentStatusCheckmarkElement = document.getElementById('agentStatusCheckmark');
  const signalrStatusElement = document.getElementById('signalrStatus');
  const signalrStatusTextElement = document.getElementById('signalrStatusText');
  const signalrCheckmarkElement = document.getElementById('signalrCheckmark');
  const signalrConnectionCountElement = document.getElementById('signalrConnectionCount');
  
  if (cloudStatusElement) {
    cloudStatusElement.style.background = 'rgba(255, 255, 255, 0.2)';
  }
  if (cloudCheckmarkElement) {
    cloudCheckmarkElement.style.display = 'none';
  }
  if (cloudStatusTextElement) {
    cloudStatusTextElement.textContent = 'Checking...';
    cloudStatusTextElement.style.color = 'rgba(255, 255, 255, 0.6)';
  }
  
  if (agentStatusStatusElement) {
    agentStatusStatusElement.style.background = 'rgba(255, 255, 255, 0.2)';
  }
  if (agentStatusCheckmarkElement) {
    agentStatusCheckmarkElement.style.display = 'none';
  }
  if (agentStatusStatusTextElement) {
    agentStatusStatusTextElement.textContent = 'Checking...';
    agentStatusStatusTextElement.style.color = 'rgba(255, 255, 255, 0.6)';
  }
  
  if (signalrStatusElement) {
    signalrStatusElement.style.background = 'rgba(255, 255, 255, 0.2)';
  }
  if (signalrCheckmarkElement) {
    signalrCheckmarkElement.style.display = 'none';
  }
  if (signalrStatusTextElement) {
    signalrStatusTextElement.textContent = 'Checking...';
    signalrStatusTextElement.style.color = 'rgba(255, 255, 255, 0.6)';
  }
  if (signalrConnectionCountElement) {
    signalrConnectionCountElement.style.display = 'none';
  }
  
  // Perform checks in parallel with timeout to ensure they always resolve
  try {
    await Promise.race([
      Promise.all([
        checkCloudServiceHealth(),
        checkAgentStatus(),
        checkSignalRHealth()
      ]),
      new Promise((resolve) => setTimeout(resolve, 5000)) // 5 second max wait
    ]);
  } catch (error) {
    console.error('Health check error:', error);
    // Ensure all show "Not available" if something goes wrong
    if (cloudStatusTextElement) {
      cloudStatusTextElement.textContent = 'Not available';
      cloudStatusTextElement.style.color = 'rgba(255, 100, 100, 0.8)';
    }
    const agentStatusStatusTextElement = document.getElementById('agentStatusStatusText');
    if (agentStatusStatusTextElement) {
      agentStatusStatusTextElement.textContent = 'Not available';
      agentStatusStatusTextElement.style.color = 'rgba(255, 100, 100, 0.8)';
    }
    if (signalrStatusTextElement) {
      signalrStatusTextElement.textContent = 'Not available';
      signalrStatusTextElement.style.color = 'rgba(255, 100, 100, 0.8)';
    }
  }

  // Update the health badge on the active release card
  updateActiveReleaseHealthBadge();
}

// Start countdown timer for auto-refresh
function startHealthCheckCountdown() {
  const countdownElement = document.getElementById('healthCheckCountdown');
  if (!countdownElement) return;
  
  let seconds = HEALTH_CHECK_REFRESH_INTERVAL;
  
  // Clear existing interval if any
  if (healthCheckCountdownInterval) {
    clearInterval(healthCheckCountdownInterval);
  }
  
  // Update immediately
  countdownElement.textContent = `${seconds}s`;
  
  // Update every second
  healthCheckCountdownInterval = setInterval(() => {
    seconds--;
    if (seconds > 0) {
      countdownElement.textContent = `${seconds}s`;
    } else {
      countdownElement.textContent = '0s';
      clearInterval(healthCheckCountdownInterval);
      // Auto-refresh will be triggered by the auto-refresh interval
    }
  }, 1000);
}

// Refresh health checks - make it globally accessible
window.refreshHealthChecks = function refreshHealthChecks() {
  const refreshButton = document.getElementById('refreshHealthChecks');
  const refreshIcon = document.getElementById('refreshIcon');
  
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.style.opacity = '0.6';
    refreshButton.style.cursor = 'not-allowed';
  }
  
  if (refreshIcon) {
    refreshIcon.style.animation = 'spin 1s linear infinite';
    // Add spin animation if not already in CSS
    if (!document.getElementById('refreshSpinStyle')) {
      const style = document.createElement('style');
      style.id = 'refreshSpinStyle';
      style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }
  }
  
  performHealthChecks().then(() => {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.style.opacity = '1';
      refreshButton.style.cursor = 'pointer';
    }
    if (refreshIcon) {
      refreshIcon.style.animation = '';
    }
    // Restart countdown after refresh
    startHealthCheckCountdown();
    if (typeof trackGatewayEvent === 'function') trackGatewayEvent('health_check_refreshed', {});
  });
};

// Start auto-refresh interval
function startHealthCheckAutoRefresh() {
  // Clear existing interval if any
  if (healthCheckAutoRefreshInterval) {
    clearInterval(healthCheckAutoRefreshInterval);
  }

  // Start countdown
  startHealthCheckCountdown();

  // Set up auto-refresh
  healthCheckAutoRefreshInterval = setInterval(() => {
    performHealthChecks().then(() => {
      // Restart countdown after refresh
      startHealthCheckCountdown();
    });
  }, HEALTH_CHECK_REFRESH_INTERVAL * 1000);
}

// =============================================================================
// SERVICE WORKER INSTALL UI FUNCTIONS
// =============================================================================

// Show the service worker install UI
function showServiceWorkerInstallUI() {
  console.log('[Service Worker Install] Hash #install-sw detected, showing install UI');

  // Hide all other containers
  const noSignInContainer = document.getElementById('noSignInContainer');
  const previousSignInContainer = document.getElementById('previousSignInContainer');
  const autoSignInContainer = document.getElementById('autoSignInContainer');
  const swContainer = document.getElementById('serviceWorkerInstallContainer');

  if (noSignInContainer) noSignInContainer.style.display = 'none';
  if (previousSignInContainer) previousSignInContainer.style.display = 'none';
  if (autoSignInContainer) autoSignInContainer.style.display = 'none';

  // Show service worker install container
  if (swContainer) {
    swContainer.style.display = 'block';

    // Check service worker support and status
    checkServiceWorkerStatus();
  }

  // Hide the side panels (status panel, quick links)
  const statusPanel = document.querySelector('.status-panel');
  const quickLinksPanel = document.querySelector('.quick-links-panel');
  const rememberedTokensPanel = document.querySelector('.remembered-tokens-panel');

  if (statusPanel) statusPanel.style.display = 'none';
  if (quickLinksPanel) quickLinksPanel.style.display = 'none';
  if (rememberedTokensPanel) rememberedTokensPanel.style.display = 'none';
}

// Check service worker status and update UI accordingly
function checkServiceWorkerStatus() {
  const pendingEl = document.getElementById('swInstallPending');
  const readyEl = document.getElementById('swInstallReady');
  const successEl = document.getElementById('swInstallSuccess');
  const errorEl = document.getElementById('swInstallError');
  const notSupportedEl = document.getElementById('swNotSupported');
  const alreadyInstalledEl = document.getElementById('swAlreadyInstalled');
  const installBtn = document.getElementById('swInstallBtn');

  // Hide all status elements
  [pendingEl, readyEl, successEl, errorEl, notSupportedEl, alreadyInstalledEl].forEach(el => {
    if (el) el.style.display = 'none';
  });

  // Check browser support
  if (!('serviceWorker' in navigator)) {
    if (notSupportedEl) notSupportedEl.style.display = 'block';
    if (installBtn) installBtn.style.display = 'none';
    return;
  }

  // Check if already installed
  if (isServiceWorkerInstalled()) {
    if (alreadyInstalledEl) alreadyInstalledEl.style.display = 'block';
    if (installBtn) {
      installBtn.textContent = 'Already Installed';
      installBtn.disabled = true;
      installBtn.style.opacity = '0.6';
    }
    return;
  }

  // Ready to install
  if (readyEl) readyEl.style.display = 'block';
  if (installBtn) {
    installBtn.disabled = false;
    installBtn.style.opacity = '1';
  }
}

// Perform service worker installation
async function doServiceWorkerInstall() {
  console.log('[Service Worker Install] Starting installation...');

  const pendingEl = document.getElementById('swInstallPending');
  const readyEl = document.getElementById('swInstallReady');
  const successEl = document.getElementById('swInstallSuccess');
  const errorEl = document.getElementById('swInstallError');
  const successMessage = document.getElementById('swSuccessMessage');
  const errorMessage = document.getElementById('swErrorMessage');
  const installBtn = document.getElementById('swInstallBtn');

  // Hide ready state, show pending
  if (readyEl) readyEl.style.display = 'none';
  if (pendingEl) {
    pendingEl.style.display = 'block';
    const pendingText = pendingEl.querySelector('p');
    if (pendingText) pendingText.textContent = 'Installing service worker...';
  }
  if (installBtn) installBtn.disabled = true;

  try {
    // Use the installPlatformServiceWorker function from gateway-shared.js
    const result = await installPlatformServiceWorker();

    if (pendingEl) pendingEl.style.display = 'none';

    if (result.success) {
      console.log('[Service Worker Install] Installation successful');
      if (successEl) successEl.style.display = 'block';
      if (successMessage) successMessage.textContent = 'Service worker installed successfully! You can close this tab.';
      if (installBtn) {
        installBtn.textContent = 'Installed';
        installBtn.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
      }
    } else {
      console.error('[Service Worker Install] Installation failed:', result.error);
      if (errorEl) errorEl.style.display = 'block';
      if (errorMessage) errorMessage.textContent = 'Installation failed: ' + (result.error || 'Unknown error');
      if (installBtn) {
        installBtn.disabled = false;
        installBtn.textContent = 'Retry Installation';
      }
    }
  } catch (error) {
    console.error('[Service Worker Install] Installation error:', error);
    if (pendingEl) pendingEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'block';
    if (errorMessage) errorMessage.textContent = 'Installation error: ' + error.message;
    if (installBtn) {
      installBtn.disabled = false;
      installBtn.textContent = 'Retry Installation';
    }
  }
}

// Close service worker install UI and return to normal gateway
function closeServiceWorkerInstall() {
  // Remove the hash from URL
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);

  // Reload the page to show normal sign-in UI
  window.location.reload();
}

// Make functions globally accessible
window.doServiceWorkerInstall = doServiceWorkerInstall;
window.closeServiceWorkerInstall = closeServiceWorkerInstall;
