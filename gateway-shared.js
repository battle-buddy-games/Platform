// Shared Gateway JavaScript

// Configuration - loaded from config.json
// Check if CONFIG already exists to avoid redeclaration errors
if (typeof CONFIG === 'undefined') {
  var CONFIG = {
    github: {
      clientId: '',
      redirectUri: '',
      scope: 'user:email'
    },
    backend: {
      callbackEndpoint: '/signin-github'
    }
  };
}

// Load configuration from config.json
async function loadConfig() {
  try {
    // Add cache-busting parameter to ensure we always get the latest config
    const cacheBuster = `?t=${Date.now()}`;
    const response = await fetch(`./config.json${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.status} ${response.statusText}`);
    }
    CONFIG = await response.json();
    console.log('Configuration loaded:', CONFIG);
    return true;
  } catch (error) {
    console.error('Error loading configuration:', error);
    showErrorModal('Configuration Error', `Failed to load configuration file:\n\n${error.message}\n\nPlease ensure config.json exists in the same directory.`);
    // Use fallback values if config fails to load (for gateway.html only)
    if (typeof CONFIG.github !== 'undefined') {
      CONFIG.github.clientId = CONFIG.github.clientId || 'Ov23liXpQBh8YbkP2AIy';
      CONFIG.github.redirectUri = CONFIG.github.redirectUri || 'https://battle-buddy-games.github.io/Platform/gateway-callback-github.html';
    }
    return false;
  }
}

// Tracking helpers for backend logging (always-on page view tracking)
const GATEWAY_TRACKING_SENT_KEY = '__gatewayTrackingSent';

function getPreferredEnvironmentForTracking() {
  try {
    const preferred = localStorage.getItem('preferredEnvironment');
    if (preferred && ['develop', 'staging', 'test', 'production'].includes(preferred)) {
      return preferred;
    }
  } catch (e) {
    console.warn('Failed to read preferred environment for tracking:', e);
  }
  return 'production';
}

function getTunnelForEnvironmentName(envName) {
  const tunnelNameMap = {
    'develop': 'develop-cloud',
    'staging': 'staging-cloud',
    'test': 'test-cloud',
    'production': 'production-cloud'
  };

  const tunnelName = tunnelNameMap[envName] || 'cloud';
  let tunnel = CONFIG?.cloudflareTunnels?.find(t => t.name === tunnelName);

  if (!tunnel) {
    tunnel = CONFIG?.cloudflareTunnels?.find(t => t.name === 'cloud');
  }

  return tunnel;
}

function getPageName() {
  try {
    const pathname = window.location.pathname || '';
    const fileName = pathname.split('/').pop();
    if (fileName) {
      return fileName;
    }
  } catch (e) {
    // Ignore and fall back to default
  }
  return 'unknown';
}

function getTrackingTunnelUrlFromSession() {
  try {
    const rawAttempt = sessionStorage.getItem('oauthSignInAttempt');
    if (!rawAttempt) {
      return null;
    }
    const attempt = JSON.parse(rawAttempt);
    if (attempt?.tunnelUrl && typeof attempt.tunnelUrl === 'string') {
      return attempt.tunnelUrl;
    }
    if (attempt?.environment) {
      const envTunnel = getTunnelForEnvironmentName(attempt.environment);
      if (envTunnel?.address) {
        return envTunnel.address;
      }
    }
  } catch (e) {
    console.warn('Failed to read tracking tunnel from session:', e);
  }
  return null;
}

function getBackendTrackingUrl() {
  try {
    const sessionTunnelUrl = getTrackingTunnelUrlFromSession();
    if (sessionTunnelUrl) {
      return `${sessionTunnelUrl.replace(/\/$/, '')}/api/GatewayDebug/log`;
    }

    const preferredEnv = getPreferredEnvironmentForTracking();
    const preferredTunnel = getTunnelForEnvironmentName(preferredEnv);
    if (preferredTunnel?.address) {
      return `${preferredTunnel.address.replace(/\/$/, '')}/api/GatewayDebug/log`;
    }

    const productionTunnel = CONFIG?.cloudflareTunnels?.find(t => t.name === 'cloud');
    if (productionTunnel?.address) {
      return `${productionTunnel.address.replace(/\/$/, '')}/api/GatewayDebug/log`;
    }
  } catch (e) {
    console.warn('Failed to build backend tracking URL:', e);
  }

  return null;
}

function buildGatewayTrackingPayload(eventName) {
  const currentUrl = new URL(window.location.href);
  const urlParams = {};

  currentUrl.searchParams.forEach((value, key) => {
    if ((key === 'token' || key === 'code') && value) {
      urlParams[key] = value.substring(0, 20) + '...';
    } else {
      urlParams[key] = value;
    }
  });

  if (currentUrl.hash) {
    urlParams['_hash'] = currentUrl.hash;
  }

  return {
    Page: getPageName(),
    Url: window.location.href,
    Path: currentUrl.pathname,
    Parameters: urlParams,
    Messages: [
      {
        Level: 'info',
        Message: eventName || 'pageview',
        Timestamp: new Date().toISOString()
      }
    ]
  };
}

async function sendGatewayTrackingPing(eventName = 'pageview') {
  if (window[GATEWAY_TRACKING_SENT_KEY]) {
    return;
  }
  window[GATEWAY_TRACKING_SENT_KEY] = true;

  try {
    if (typeof loadConfig === 'function' && (!CONFIG || !CONFIG.cloudflareTunnels)) {
      await loadConfig();
    }

    const backendUrl = getBackendTrackingUrl();
    if (!backendUrl) {
      return;
    }

    const payload = buildGatewayTrackingPayload(eventName);

    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(backendUrl, blob);
    } else {
      await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        keepalive: true
      });
    }
  } catch (e) {
    // Tracking should never break the flow, ignore failures
  }
}

// Generate a random state parameter for CSRF protection
// Includes timestamp and random component to ensure uniqueness and force new OAuth codes
function generateState() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const randomHex = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  // Add timestamp and additional random component to ensure state is always unique
  // This forces GitHub to generate a new code each time
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `${randomHex}-${timestamp}-${randomSuffix}`;
}

// Generate state with provider encoded in it
// Format: {provider}:{randomState} - this way provider is preserved through OAuth redirect
// 
// NOTE: This is only used for GitHub OAuth, which redirects directly to gateway-callback.html.
// GitHub supports custom state parameters per OAuth 2.0 spec (RFC 6749) - providers MUST return
// the state parameter unchanged. Google/Discord/Steam go through the backend first, so the
// backend knows the provider and includes it in the redirect to gateway-callback.html.
function generateStateWithProvider(provider) {
  const randomState = generateState();
  return `${provider}:${randomState}`;
}

// Extract provider and state from encoded state parameter
// Returns { provider: string, state: string } or null if invalid
// 
// This is used to identify the OAuth provider when GitHub redirects directly with code/state.
// The state format is: "github:{randomState}" where randomState is the CSRF token.
function parseStateWithProvider(encodedState) {
  if (!encodedState || typeof encodedState !== 'string') {
    return null;
  }
  
  const parts = encodedState.split(':');
  if (parts.length !== 2) {
    return null;
  }
  
  return {
    provider: parts[0],
    state: parts[1]
  };
}

// Error Modal Functions
let currentErrorText = '';

function showErrorModal(title, message, detailedMessage = null) {
  // Use detailed message for clipboard if provided, otherwise use regular message
  currentErrorText = detailedMessage || message;
  const modal = document.getElementById('errorModal');
  if (!modal) {
    console.error('Error modal not found in DOM');
    // Fallback to alert if modal doesn't exist
    alert(`${title}\n\n${message}`);
    return;
  }
  const modalBody = document.getElementById('errorModalBody');
  const modalTitle = document.querySelector('.modal-title');
  
  if (modalTitle) {
    modalTitle.textContent = title || 'Error';
  }
  if (modalBody) {
    // Format message with line breaks and highlight debug information
    let formattedMessage = message.replace(/\n/g, '<br>');
    
    // Highlight backend debug information section if present
    if (formattedMessage.includes('=== Backend Debug Information')) {
      // Style the debug section with a distinct background and monospace font
      formattedMessage = formattedMessage.replace(
        /(=== Backend Debug Information[^=]+=== End Backend Debug Information ===)/g,
        '<div style="background: rgba(255, 200, 100, 0.1); border: 1px solid rgba(255, 200, 100, 0.3); border-radius: 8px; padding: 12px; margin: 12px 0; font-family: monospace; font-size: 11px; white-space: pre-wrap; overflow-x: auto; color: rgba(255, 255, 255, 0.9);">$1</div>'
      );
      // Also highlight the section header
      formattedMessage = formattedMessage.replace(
        /=== Backend Debug Information \(DebugAuthentication feature flag enabled\) ===/g,
        '<strong style="color: rgba(255, 200, 100, 1);">=== Backend Debug Information (DebugAuthentication feature flag enabled) ===</strong>'
      );
      formattedMessage = formattedMessage.replace(
        /=== End Backend Debug Information ===/g,
        '<strong style="color: rgba(255, 200, 100, 1);">=== End Backend Debug Information ===</strong>'
      );
    }
    
    modalBody.innerHTML = formattedMessage;
    
    // For code_already_used errors, add a "Try Again" button
    if (message.includes('code was already used') || message.includes('code_already_used')) {
      const tryAgainButton = document.createElement('button');
      tryAgainButton.className = 'modal-button primary';
      tryAgainButton.style.marginTop = '16px';
      tryAgainButton.style.width = '100%';
      tryAgainButton.textContent = 'Try Again - Start Fresh Sign-In';
      tryAgainButton.onclick = function() {
        closeErrorModal();
        // Clear any stored state
        try {
          localStorage.clear();
          sessionStorage.clear();
          console.log('Cleared all storage for fresh sign-in');
        } catch (e) {
          console.warn('Failed to clear storage:', e);
        }
        // Force a hard reload to clear any cached state
        // Add cache-busting parameter to ensure fresh page load
        const url = new URL(window.location.href);
        url.searchParams.set('_retry', Date.now().toString());
        url.searchParams.delete('error');
        url.searchParams.delete('error_description');
        url.searchParams.delete('provider');
        window.location.href = url.toString();
      };
      modalBody.appendChild(tryAgainButton);
    }
  }
  modal.classList.add('show');
}

function closeErrorModal() {
  const modal = document.getElementById('errorModal');
  if (modal) {
    modal.classList.remove('show');
  }
}

function copyErrorToClipboard() {
  if (!currentErrorText) return;

  navigator.clipboard.writeText(currentErrorText).then(() => {
    // Show success notification
    const notification = document.createElement('div');
    notification.className = 'copy-success';
    notification.textContent = 'Copied to clipboard!';
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 300);
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy:', err);
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = currentErrorText;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      const notification = document.createElement('div');
      notification.className = 'copy-success';
      notification.textContent = 'Copied to clipboard!';
      document.body.appendChild(notification);
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 2000);
    } catch (err) {
      console.error('Fallback copy failed:', err);
    }
    if (document.body.contains(textArea)) {
      document.body.removeChild(textArea);
    }
  });
}

// Initialize error modal event listeners (only if modal exists)
function initErrorModal() {
  const modal = document.getElementById('errorModal');
  if (!modal) return;

  // Close modal when clicking outside
  modal.addEventListener('click', function(e) {
    if (e.target === this) {
      closeErrorModal();
    }
  });

  // Close modal with Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeErrorModal();
    }
  });
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initErrorModal);
} else {
  initErrorModal();
}

// Always send a lightweight pageview log to the backend for tracking login flow progression
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    sendGatewayTrackingPing();
  });
} else {
  sendGatewayTrackingPing();
}

// Debug Mode Functions
const DEBUG_MODE_STORAGE_KEY = 'gateway_debug_mode';

// Get debug mode state from localStorage
function isDebugModeEnabled() {
  try {
    return localStorage.getItem(DEBUG_MODE_STORAGE_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

// Set debug mode state in localStorage
function setDebugMode(enabled) {
  try {
    localStorage.setItem(DEBUG_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    console.warn('Failed to save debug mode setting:', e);
  }
}

// Get backend URL for debug logging
function getBackendDebugUrl() {
  try {
    // Get tunnel from CONFIG (same as used for OAuth callbacks)
    const productionTunnel = CONFIG?.cloudflareTunnels?.find(t => t.name === 'cloud');
    if (!productionTunnel || !productionTunnel.address) {
      return null;
    }
    const cleanTunnelUrl = productionTunnel.address.replace(/\/$/, '');
    return `${cleanTunnelUrl}/api/GatewayDebug/log`;
  } catch (e) {
    console.warn('Failed to get backend debug URL:', e);
    return null;
  }
}

// Console message tracking for backend logging (only when debug mode is enabled)
let pendingConsoleMessages = [];
const MAX_PENDING_MESSAGES = 50;
let sendLogsTimeout = null;
const LOG_BATCH_DELAY_MS = 2000; // Send logs in batches every 2 seconds

// Send console messages to backend
async function sendConsoleMessagesToBackend() {
  if (!isDebugModeEnabled() || pendingConsoleMessages.length === 0) {
    return;
  }

  const backendUrl = getBackendDebugUrl();
  if (!backendUrl) {
    // Backend URL not available, keep messages in buffer
    return;
  }

  // Get messages to send and clear the buffer
  const messagesToSend = [...pendingConsoleMessages];
  pendingConsoleMessages = [];

  try {
    const pageName = getPageName();
    const currentUrl = new URL(window.location.href);
    
    // Extract URL parameters for tracking sign-in progression
    const urlParams = {};
    currentUrl.searchParams.forEach((value, key) => {
      // Truncate sensitive values for security (tokens, codes, etc.)
      if (key === 'token' && value) {
        urlParams[key] = value.substring(0, 20) + '...';
      } else if (key === 'code' && value) {
        urlParams[key] = value.substring(0, 20) + '...';
      } else {
        urlParams[key] = value;
      }
    });
    
    // Extract hash if present
    if (currentUrl.hash) {
      urlParams['_hash'] = currentUrl.hash;
    }
    
    // CRITICAL: Collect client-side authentication state when debug mode is enabled
    // This helps debug authentication issues in production
    const clientState = {};
    if (isDebugModeEnabled()) {
      try {
        // Collect sessionStorage items related to authentication
        const sessionStorageItems = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && (key.includes('oauth') || key.includes('auth') || key.includes('state') || key.includes('token'))) {
            try {
              const value = sessionStorage.getItem(key);
              // Truncate sensitive values
              if (key.includes('token') && value && value.length > 20) {
                sessionStorageItems[key] = value.substring(0, 20) + '...';
              } else {
                sessionStorageItems[key] = value;
              }
            } catch (e) {
              sessionStorageItems[key] = '(error reading)';
            }
          }
        }
        clientState.sessionStorage = sessionStorageItems;
        
        // Collect localStorage items related to authentication
        const localStorageItems = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.includes('oauth') || key.includes('auth') || key.includes('state') || key.includes('token') || key.includes('debug'))) {
            try {
              const value = localStorage.getItem(key);
              // Truncate sensitive values
              if (key.includes('token') && value && value.length > 20) {
                localStorageItems[key] = value.substring(0, 20) + '...';
              } else {
                localStorageItems[key] = value;
              }
            } catch (e) {
              localStorageItems[key] = '(error reading)';
            }
          }
        }
        clientState.localStorage = localStorageItems;
        
        // Collect document cookies (authentication cookies)
        const cookies = {};
        if (document.cookie) {
          document.cookie.split(';').forEach(cookie => {
            const [key, value] = cookie.trim().split('=');
            if (key && (key.includes('Auth') || key.includes('Correlation') || key.includes('auth') || key.includes('state'))) {
              // Truncate cookie values for security
              if (value && value.length > 30) {
                cookies[key] = value.substring(0, 30) + '...';
              } else {
                cookies[key] = value || '';
              }
            }
          });
        }
        clientState.cookies = cookies;
        
        // Add provider detection
        const path = currentUrl.pathname;
        if (path.includes('callback-github')) {
          clientState.detectedProvider = 'github';
        } else if (path.includes('callback-google')) {
          clientState.detectedProvider = 'google';
        } else if (path.includes('callback-discord')) {
          clientState.detectedProvider = 'discord';
        } else if (path.includes('callback-steam')) {
          clientState.detectedProvider = 'steam';
        }
        
        // Add state parameter info
        if (urlParams.state) {
          clientState.hasStateParam = true;
          clientState.stateLength = urlParams.state.length;
        }
        
        // Add code parameter info (if present)
        if (urlParams.code) {
          clientState.hasCodeParam = true;
        }
      } catch (e) {
        clientState.error = 'Failed to collect client state: ' + e.message;
      }
    }
    
    const requestBody = {
      Page: pageName,
      Url: window.location.href,
      Path: currentUrl.pathname,
      Parameters: urlParams,
      Messages: messagesToSend.map(msg => ({
        Level: msg.level,
        Message: msg.message,
        Timestamp: msg.timestamp
      })),
      DebugMode: isDebugModeEnabled(),
      Provider: clientState.detectedProvider || urlParams.provider || null,
      ClientState: isDebugModeEnabled() ? clientState : null
    };

    // Use fetch with sendBeacon fallback for reliability
    if (navigator.sendBeacon) {
      // Use sendBeacon for better reliability on page unload
      const blob = new Blob([JSON.stringify(requestBody)], { type: 'application/json' });
      navigator.sendBeacon(backendUrl, blob);
    } else {
      // Fallback to fetch
      await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        keepalive: true // Keep request alive even if page unloads
      });
    }
  } catch (e) {
    // Silently fail - don't log errors about logging errors
    // Restore messages to buffer if send failed
    pendingConsoleMessages.unshift(...messagesToSend);
    // Limit buffer size
    if (pendingConsoleMessages.length > MAX_PENDING_MESSAGES) {
      pendingConsoleMessages = pendingConsoleMessages.slice(-MAX_PENDING_MESSAGES);
    }
  }
}

// Schedule sending logs (debounced)
function scheduleLogSend() {
  if (sendLogsTimeout) {
    clearTimeout(sendLogsTimeout);
  }
  sendLogsTimeout = setTimeout(() => {
    sendConsoleMessagesToBackend();
    sendLogsTimeout = null;
  }, LOG_BATCH_DELAY_MS);
}

// Override console methods to capture and send messages when debug mode is enabled
(function() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  
  function captureConsoleMessage(level, args) {
    // Only capture if debug mode is enabled
    if (!isDebugModeEnabled()) {
      return;
    }

    try {
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch (e) {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');
      
      const timestamp = new Date().toISOString();
      
      pendingConsoleMessages.push({
        level: level,
        message: message,
        timestamp: timestamp
      });
      
      // Limit messages in buffer
      if (pendingConsoleMessages.length > MAX_PENDING_MESSAGES) {
        pendingConsoleMessages.shift();
      }

      // Schedule sending logs to backend
      scheduleLogSend();
    } catch (e) {
      // Silently fail if capturing fails
    }
  }
  
  console.log = function(...args) {
    captureConsoleMessage('log', args);
    originalLog.apply(console, args);
  };
  
  console.error = function(...args) {
    captureConsoleMessage('error', args);
    originalError.apply(console, args);
  };
  
  console.warn = function(...args) {
    captureConsoleMessage('warn', args);
    originalWarn.apply(console, args);
  };
  
  console.info = function(...args) {
    captureConsoleMessage('info', args);
    originalInfo.apply(console, args);
  };
  
  console.debug = function(...args) {
    captureConsoleMessage('debug', args);
    originalDebug.apply(console, args);
  };
  
  // Capture unhandled errors
  window.addEventListener('error', function(event) {
    captureConsoleMessage('error', [
      `Unhandled Error: ${event.message}`,
      `File: ${event.filename}`,
      `Line: ${event.lineno}`,
      `Column: ${event.colno}`,
      event.error ? event.error.stack : ''
    ]);
  });
  
  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function(event) {
    captureConsoleMessage('error', [
      `Unhandled Promise Rejection: ${event.reason}`,
      event.reason && event.reason.stack ? event.reason.stack : ''
    ]);
  });
})();

// Send any pending logs on page unload
window.addEventListener('beforeunload', function() {
  if (sendLogsTimeout) {
    clearTimeout(sendLogsTimeout);
  }
  sendConsoleMessagesToBackend();
});

// =============================================================================
// ALWAYS-ON FRONTEND ERROR FORWARDING
// Captures all JavaScript errors and forwards them to backend regardless of debug mode.
// This enables debugging production issues via PullPlatformLogs.ps1
// =============================================================================

const FRONTEND_ERROR_BUFFER = [];
const MAX_FRONTEND_ERRORS = 20;
let frontendErrorSendTimeout = null;
const FRONTEND_ERROR_BATCH_DELAY_MS = 1000;

// Get backend URL for frontend error logging
function getFrontendErrorLogUrl() {
  try {
    // Try session tunnel first (from OAuth flow)
    const sessionTunnelUrl = getTrackingTunnelUrlFromSession();
    if (sessionTunnelUrl) {
      return `${sessionTunnelUrl.replace(/\/$/, '')}/api/FrontendError/log`;
    }

    // Try preferred environment
    const preferredEnv = getPreferredEnvironmentForTracking();
    const preferredTunnel = getTunnelForEnvironmentName(preferredEnv);
    if (preferredTunnel?.address) {
      return `${preferredTunnel.address.replace(/\/$/, '')}/api/FrontendError/log`;
    }

    // Fallback to production tunnel
    const productionTunnel = CONFIG?.cloudflareTunnels?.find(t => t.name === 'cloud');
    if (productionTunnel?.address) {
      return `${productionTunnel.address.replace(/\/$/, '')}/api/FrontendError/log`;
    }
  } catch (e) {
    // Silently fail - don't cause errors while handling errors
  }
  return null;
}

// Buffer a frontend error for sending
function bufferFrontendError(errorInfo) {
  FRONTEND_ERROR_BUFFER.push(errorInfo);

  // Limit buffer size
  if (FRONTEND_ERROR_BUFFER.length > MAX_FRONTEND_ERRORS) {
    FRONTEND_ERROR_BUFFER.shift();
  }

  // Schedule sending
  if (frontendErrorSendTimeout) {
    clearTimeout(frontendErrorSendTimeout);
  }
  frontendErrorSendTimeout = setTimeout(sendFrontendErrors, FRONTEND_ERROR_BATCH_DELAY_MS);
}

// Send buffered frontend errors to backend
async function sendFrontendErrors() {
  if (FRONTEND_ERROR_BUFFER.length === 0) {
    return;
  }

  const backendUrl = getFrontendErrorLogUrl();
  if (!backendUrl) {
    return;
  }

  // Get errors to send and clear buffer
  const errorsToSend = [...FRONTEND_ERROR_BUFFER];
  FRONTEND_ERROR_BUFFER.length = 0;

  try {
    const payload = {
      Page: getPageName(),
      Url: window.location.href,
      Errors: errorsToSend
    };

    // Use sendBeacon for reliability on page unload
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(backendUrl, blob);
    } else {
      await fetch(backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      });
    }
  } catch (e) {
    // Restore errors to buffer if send failed (limit to avoid infinite growth)
    if (FRONTEND_ERROR_BUFFER.length + errorsToSend.length <= MAX_FRONTEND_ERRORS) {
      FRONTEND_ERROR_BUFFER.unshift(...errorsToSend);
    }
  }
}

// ALWAYS-ON: Capture unhandled JavaScript errors
window.addEventListener('error', function(event) {
  // Skip if it's a resource load error (handled separately)
  if (event.target && event.target !== window) {
    return;
  }

  bufferFrontendError({
    Type: 'error',
    Message: event.message || 'Unknown error',
    Source: event.filename || '',
    Line: event.lineno || null,
    Column: event.colno || null,
    Stack: event.error?.stack || '',
    Timestamp: new Date().toISOString()
  });
}, true);

// ALWAYS-ON: Capture unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
  const reason = event.reason;
  let message = 'Unhandled Promise Rejection';
  let stack = '';

  if (reason instanceof Error) {
    message = reason.message || message;
    stack = reason.stack || '';
  } else if (typeof reason === 'string') {
    message = reason;
  } else if (reason) {
    try {
      message = JSON.stringify(reason);
    } catch (e) {
      message = String(reason);
    }
  }

  bufferFrontendError({
    Type: 'unhandledrejection',
    Message: message,
    Stack: stack,
    Timestamp: new Date().toISOString()
  });
});

// ALWAYS-ON: Capture resource load errors (images, scripts, stylesheets)
window.addEventListener('error', function(event) {
  // Only handle resource load errors
  if (!event.target || event.target === window) {
    return;
  }

  const target = event.target;
  const tagName = target.tagName?.toLowerCase() || 'unknown';
  const src = target.src || target.href || '';

  // Skip if no source (not a resource load error)
  if (!src) {
    return;
  }

  bufferFrontendError({
    Type: 'resourceError',
    Message: `Failed to load ${tagName}: ${src}`,
    Source: src,
    Timestamp: new Date().toISOString()
  });
}, true);

// Send any pending frontend errors on page unload
window.addEventListener('beforeunload', function() {
  if (frontendErrorSendTimeout) {
    clearTimeout(frontendErrorSendTimeout);
  }
  sendFrontendErrors();
});
