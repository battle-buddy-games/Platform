// Auth Success Page JavaScript
//
// Authentication Flow:
// 1. User successfully authenticates on .NET app
// 2. .NET app redirects to auth-success.html?gatewayToken=xxx&returnUrl=yyy
// 3. auth-success.html stores gatewayToken in localStorage
// 4. Shows success message and countdown
// 5. Redirects to returnUrl (tunnel or portal)

// Storage key for gateway token
const GATEWAY_TOKEN_KEY = "bb_gateway_token";

// Countdown state
let countdownInterval = null;
let countdownTimeout = null;
let redirectUrl = null;
let countdownPaused = false;
let remainingTime = 3; // 3 seconds default
let performRedirect = null;
let updatePausePlayButton = null;
let restartCountdownTimeout = null;

// Toggle countdown pause/play
window.toggleCountdown = function toggleCountdown() {
  if (countdownInterval === null && countdownTimeout === null) {
    console.warn('toggleCountdown called but countdown is not active');
    return;
  }
  
  countdownPaused = !countdownPaused;
  
  if (countdownPaused) {
    console.log('Countdown paused at', remainingTime, 'seconds');
    if (countdownTimeout) {
      clearTimeout(countdownTimeout);
      countdownTimeout = null;
    }
  } else {
    console.log('Countdown resumed at', remainingTime, 'seconds');
    if (restartCountdownTimeout) {
      restartCountdownTimeout();
    } else if (window.restartCountdownTimeout) {
      window.restartCountdownTimeout();
    }
  }
  
  if (updatePausePlayButton) {
    updatePausePlayButton(countdownPaused);
  } else if (window.updatePausePlayButton) {
    window.updatePausePlayButton(countdownPaused);
  }
};

// Skip countdown and redirect immediately
window.skipCountdown = function skipCountdown() {
  console.log('Skipping countdown, redirecting immediately');
  if (window.performRedirect) {
    window.performRedirect();
  } else {
    console.warn('performRedirect not available, redirect may not work');
  }
};

// Cancel redirect - stay on this page
window.cancelRedirect = function cancelRedirect() {
  console.log('Redirect cancelled by user');
  countdownPaused = false;
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (countdownTimeout) {
    clearTimeout(countdownTimeout);
    countdownTimeout = null;
  }
  
  const countdownContainer = document.getElementById('countdownContainer');
  if (countdownContainer) {
    countdownContainer.style.display = 'none';
  }
  
  const countdownMessage = document.getElementById('countdownMessage');
  if (countdownMessage) {
    countdownMessage.textContent = 'You can close this page or navigate to the platform manually.';
  }
  
  const titleText = document.getElementById('titleText');
  if (titleText) {
    titleText.textContent = 'Authentication Remembered!';
  }
};

// Store gateway token in localStorage
function storeGatewayToken(token) {
  if (!token) {
    console.warn('No gateway token provided to store');
    return false;
  }
  
  try {
    localStorage.setItem(GATEWAY_TOKEN_KEY, token);
    console.log('Gateway token stored successfully');
    return true;
  } catch (error) {
    console.error('Failed to store gateway token:', error);
    return false;
  }
}

// Get gateway token from localStorage
function getGatewayToken() {
  try {
    return localStorage.getItem(GATEWAY_TOKEN_KEY);
  } catch (error) {
    console.error('Failed to get gateway token:', error);
    return null;
  }
}

// Clean URL by removing sensitive parameters
function cleanUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('gatewayToken');
    // Keep returnUrl for potential manual navigation
    window.history.replaceState({}, '', url.toString());
  } catch (error) {
    console.error('Failed to clean URL:', error);
  }
}

// Determine default return URL
function getDefaultReturnUrl() {
  // Default to portal.html on GitHub Pages
  const currentUrl = new URL(window.location.href);
  const basePath = currentUrl.pathname.substring(0, currentUrl.pathname.lastIndexOf('/') + 1);
  return `${currentUrl.origin}${basePath}portal.html`;
}

// Handle auth success flow
function handleAuthSuccess() {
  const urlParams = new URLSearchParams(window.location.search);
  const gatewayToken = urlParams.get('gatewayToken');
  const returnUrl = urlParams.get('returnUrl');
  
  console.log('Auth success page loaded', {
    hasToken: !!gatewayToken,
    hasReturnUrl: !!returnUrl
  });
  
  // Check for gateway token
  if (!gatewayToken) {
    console.error('No gateway token provided in URL');
    showErrorModal(
      'Missing Token',
      'No authentication token was provided. Please try signing in again.',
      'The gatewayToken parameter is required but was not found in the URL.'
    );
    return;
  }
  
  // Store the token
  const stored = storeGatewayToken(gatewayToken);
  if (!stored) {
    showErrorModal(
      'Storage Error',
      'Failed to store authentication token. Please try again.',
      'Unable to save the token to localStorage. This may be due to browser privacy settings.'
    );
    return;
  }
  
  // Clean URL to remove token (security)
  cleanUrl();
  
  // Determine redirect URL
  let finalReturnUrl = returnUrl;
  if (!finalReturnUrl || finalReturnUrl === '/') {
    finalReturnUrl = getDefaultReturnUrl();
  }
  
  console.log('Stored token, redirecting to:', finalReturnUrl);
  redirectUrl = finalReturnUrl;
  
  // Show success state
  showSuccessState();
  
  // Start countdown
  startCountdown(finalReturnUrl, 'Redirecting to platform...');
}

// Show success state with icon
function showSuccessState() {
  const spinner = document.querySelector('.spinner');
  const successIcon = document.getElementById('successIcon');
  
  if (spinner) {
    spinner.style.display = 'none';
  }
  
  if (successIcon) {
    successIcon.style.display = 'flex';
    // Ensure flex properties are applied
    successIcon.style.alignItems = 'center';
    successIcon.style.justifyContent = 'center';
  }
}

// Redirect with countdown
function startCountdown(url, message = 'Redirecting...') {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    console.error('Invalid redirect URL provided:', url);
    showErrorModal('Redirect Error', 'Invalid redirect URL. Please try again.');
    return;
  }
  
  redirectUrl = url.trim();
  console.log('Starting countdown redirect to:', redirectUrl);
  
  // Show countdown container
  const countdownContainer = document.getElementById('countdownContainer');
  const countdownText = document.getElementById('countdownText');
  const countdownSeconds = document.getElementById('countdownSeconds');
  const countdownMessage = document.getElementById('countdownMessage');
  
  if (countdownContainer && countdownText && countdownSeconds && countdownMessage) {
    countdownContainer.style.display = 'block';
    countdownMessage.textContent = message;
    
    // Reset pause state
    countdownPaused = false;
    let countdown = 3;
    remainingTime = 3;
    countdownText.textContent = countdown.toString();
    countdownSeconds.textContent = countdown.toString();
    
    // Update pause/play button UI
    const updatePausePlayButtonFunc = (isPaused) => {
      const pauseIcon = document.getElementById('pauseIcon');
      const playIcon = document.getElementById('playIcon');
      const pausePlayText = document.getElementById('pausePlayText');
      
      if (pauseIcon && playIcon && pausePlayText) {
        if (isPaused) {
          pauseIcon.style.display = 'none';
          playIcon.style.display = 'block';
          pausePlayText.textContent = 'Resume';
        } else {
          pauseIcon.style.display = 'block';
          playIcon.style.display = 'none';
          pausePlayText.textContent = 'Pause';
        }
      }
    };
    
    updatePausePlayButton = updatePausePlayButtonFunc;
    window.updatePausePlayButton = updatePausePlayButtonFunc;
    
    // Initialize button state
    updatePausePlayButtonFunc(false);
    
    // Function to perform redirect
    performRedirect = () => {
      console.log('Performing redirect to:', redirectUrl);
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      if (countdownTimeout) {
        clearTimeout(countdownTimeout);
        countdownTimeout = null;
      }
      if (redirectUrl) {
        try {
          window.location.replace(redirectUrl);
          setTimeout(() => {
            if (window.location.href !== redirectUrl) {
              console.log('Replace did not work, trying href instead');
              window.location.href = redirectUrl;
            }
          }, 100);
        } catch (error) {
          console.error('Error during redirect:', error);
          window.location.href = redirectUrl;
        }
      } else {
        console.error('Redirect URL is null or undefined!');
        showErrorModal('Redirect Error', 'Redirect URL is missing. Please try again.');
      }
    };
    
    // Function to restart timeout with remaining time
    const restartTimeout = () => {
      if (countdownTimeout) {
        clearTimeout(countdownTimeout);
      }
      if (remainingTime > 0 && !countdownPaused) {
        countdownTimeout = setTimeout(() => {
          if (!countdownPaused) {
            console.log('Countdown timeout reached (backup), redirecting to:', redirectUrl);
            performRedirect();
          }
        }, (remainingTime + 0.1) * 1000);
      }
    };
    
    // Update countdown every second
    countdownInterval = setInterval(() => {
      if (countdownPaused) {
        return;
      }
      
      countdown--;
      remainingTime = countdown;
      
      if (countdown > 0) {
        countdownText.textContent = countdown.toString();
        countdownSeconds.textContent = countdown.toString();
      } else {
        countdownText.textContent = '0';
        countdownSeconds.textContent = '0';
        performRedirect();
      }
    }, 1000);
    
    // Set timeout as backup
    countdownTimeout = setTimeout(() => {
      if (!countdownPaused) {
        console.log('Countdown timeout reached (backup), redirecting to:', redirectUrl);
        performRedirect();
      }
    }, 3100); // 3.1 seconds
    
    // Store functions globally
    window.performRedirect = performRedirect;
    restartCountdownTimeout = restartTimeout;
    window.restartCountdownTimeout = restartTimeout;
  } else {
    // Fallback: redirect immediately if elements not found
    console.warn('Countdown elements not found, redirecting immediately');
    window.location.href = url;
  }
}

// Initialize when page loads
(function init() {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleAuthSuccess);
  } else {
    handleAuthSuccess();
  }
})();

