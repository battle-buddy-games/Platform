// SDK Start - Launch Parameter Relay
// Reads pending launch instructions from localStorage and sends them
// to the SDK Hub's temporary HTTP listener on localhost.

const SDK_LAUNCH_HISTORY_KEY = 'sdk_launch_history';
const POLL_INTERVAL_MS = 500;
const MAX_POLL_ATTEMPTS = 120; // 60 seconds at 500ms intervals
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

let sdkHubPort = null;
let pollTimer = null;
let pollAttempts = 0;
let pendingEntry = null;

// ============================================================================
// localStorage helpers (duplicated from gateway.js for independence)
// ============================================================================

function getSdkLaunchHistory() {
  try {
    const raw = localStorage.getItem(SDK_LAUNCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveSdkLaunchHistory(entries) {
  try {
    localStorage.setItem(SDK_LAUNCH_HISTORY_KEY, JSON.stringify(entries));
  } catch (e) { /* silent */ }
}

function markCompleted(entryId) {
  const history = getSdkLaunchHistory();
  const entry = history.find(function(e) { return e.id === entryId; });
  if (entry) {
    entry.completed = true;
    entry.completedAt = new Date().toISOString();
    saveSdkLaunchHistory(history);
  }
}

function getMostRecentPending() {
  const history = getSdkLaunchHistory();
  const pending = history.filter(function(e) { return !e.completed; });
  return pending.length > 0 ? pending[pending.length - 1] : null;
}

// ============================================================================
// UI helpers
// ============================================================================

function setStatus(text, type) {
  var statusText = document.getElementById('statusText');
  var spinner = document.getElementById('statusSpinner');

  if (statusText) statusText.textContent = text;

  if (type === 'connected' && spinner) {
    spinner.style.borderTopColor = '#4CAF50';
  } else if ((type === 'error' || type === 'success') && spinner) {
    spinner.style.display = 'none';
  }
}

function showPanel(panelId) {
  var panels = ['pendingLaunchPanel', 'noPendingPanel', 'successPanel', 'errorPanel'];
  panels.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = (id === panelId) ? '' : 'none';
  });
}

function formatTimeAgo(isoString) {
  var diff = Date.now() - new Date(isoString).getTime();
  var seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  var minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  var days = Math.floor(hours / 24);
  return days + 'd ago';
}

function renderHistory() {
  var container = document.getElementById('historyList');
  if (!container) return;

  var history = getSdkLaunchHistory().slice().reverse();

  if (history.length === 0) {
    container.innerHTML = '<p style="font-size: 12px; color: rgba(255,255,255,0.4);">No launch history</p>';
    return;
  }

  container.innerHTML = history.map(function(entry) {
    var statusDot = entry.completed
      ? '<span style="color: #4CAF50;">&#x2713;</span>'
      : '<span style="color: #ff9800;">&#x25CF;</span>';
    return '<div class="sdk-history-entry">' +
      statusDot +
      '<span class="sdk-history-label">' + escapeHtml(entry.label) + '</span>' +
      '<span class="sdk-history-time">' + formatTimeAgo(entry.timestamp) + '</span>' +
      '</div>';
  }).join('');
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================================
// SDK Hub communication
// ============================================================================

function pollSdkHub() {
  if (!sdkHubPort || !pendingEntry) return;

  pollAttempts++;
  if (pollAttempts > MAX_POLL_ATTEMPTS) {
    clearInterval(pollTimer);
    setStatus('SDK Hub did not respond (timeout)', 'error');
    showPanel('errorPanel');
    var errorMsg = document.getElementById('errorMessage');
    if (errorMsg) {
      errorMsg.textContent = 'SDK Hub did not start listening within 60 seconds. You can close this page and try again.';
    }
    return;
  }

  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 2000);

  fetch('http://localhost:' + sdkHubPort + '/api/sdk-start/status', {
    method: 'GET',
    signal: controller.signal
  })
  .then(function(response) {
    clearTimeout(timeoutId);
    if (response.ok) {
      clearInterval(pollTimer);
      setStatus('Connected to SDK Hub!', 'connected');
      sendLaunchParameters();
    }
  })
  .catch(function() {
    clearTimeout(timeoutId);
    // SDK Hub not ready yet, keep polling
  });
}

function sendLaunchParameters() {
  if (!pendingEntry) return;

  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 5000);

  fetch('http://localhost:' + sdkHubPort + '/api/sdk-start/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pendingEntry),
    signal: controller.signal
  })
  .then(function(response) {
    clearTimeout(timeoutId);
    if (response.ok) {
      markCompleted(pendingEntry.id);
      setStatus('Launch parameters sent!', 'success');
      showPanel('successPanel');
      renderHistory();
    } else {
      setStatus('SDK Hub rejected the launch parameters', 'error');
      showPanel('errorPanel');
      var errorMsg = document.getElementById('errorMessage');
      if (errorMsg) {
        errorMsg.textContent = 'SDK Hub returned status ' + response.status + '. Check the SDK Hub console for details.';
      }
    }
  })
  .catch(function(e) {
    clearTimeout(timeoutId);
    setStatus('Failed to send launch parameters', 'error');
    showPanel('errorPanel');
    var errorMsg = document.getElementById('errorMessage');
    if (errorMsg) {
      errorMsg.textContent = 'Network error: ' + e.message + '. Ensure SDK Hub is still running.';
    }
  });
}

// ============================================================================
// Initialization
// ============================================================================

function initialize() {
  // Parse port from query params
  var params = new URLSearchParams(window.location.search);
  sdkHubPort = params.get('port') || '18720';

  // Get most recent pending launch
  pendingEntry = getMostRecentPending();

  if (pendingEntry) {
    var labelEl = document.getElementById('pendingLaunchLabel');
    var appEl = document.getElementById('pendingLaunchApp');
    var timeEl = document.getElementById('pendingLaunchTime');
    var staleEl = document.getElementById('pendingLaunchStale');

    if (labelEl) labelEl.textContent = pendingEntry.label;
    if (appEl) appEl.textContent = pendingEntry.app;
    if (timeEl) timeEl.textContent = formatTimeAgo(pendingEntry.timestamp);

    // Check staleness
    var age = Date.now() - new Date(pendingEntry.timestamp).getTime();
    if (age > STALE_THRESHOLD_MS && staleEl) {
      staleEl.style.display = '';
    }

    showPanel('pendingLaunchPanel');

    // Start polling for SDK Hub
    setStatus('Waiting for SDK Hub on port ' + sdkHubPort + '...', 'waiting');
    pollTimer = setInterval(pollSdkHub, POLL_INTERVAL_MS);
    // Also poll immediately
    pollSdkHub();
  } else {
    showPanel('noPendingPanel');
    setStatus('No pending launches', 'error');
  }

  renderHistory();

  // Send tracking ping
  if (typeof sendGatewayTrackingPing === 'function') {
    sendGatewayTrackingPing('sdk_start_pageview');
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
