/**
 * Cognito Authentication Module
 * Handles OAuth2 authentication flow with AWS Cognito
 */

let cognitoConfig = null;
let accessToken = null;

/**
 * Initialize authentication on page load
 */
async function initAuth() {
  // Load Cognito configuration from backend
  try {
    const response = await fetch('/api/auth/config');
    cognitoConfig = await response.json();

    if (!cognitoConfig.enabled) {
      console.log('Authentication disabled - running in local dev mode');
      // Hide auth UI elements
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) logoutBtn.style.display = 'none';
      return;
    }

    console.log('Authentication enabled');

    // Check if user is already authenticated
    accessToken = localStorage.getItem('access_token');
    if (accessToken) {
      // Verify token is still valid by making an API call
      try {
        await fetchWithAuth('/api/health');
        console.log('User authenticated with valid token');
        updateAuthUI(true);
      } catch (error) {
        // Token invalid or expired
        console.log('Token expired or invalid, redirecting to login');
        localStorage.removeItem('access_token');
        redirectToLogin();
      }
    } else {
      // No token, redirect to login
      redirectToLogin();
    }
  } catch (error) {
    console.error('Failed to initialize auth:', error);
  }
}

/**
 * Redirect to custom login page
 */
function redirectToLogin() {
  if (!cognitoConfig || !cognitoConfig.enabled) return;

  // Redirect to custom login page
  console.log('Redirecting to login page...');
  window.location.href = '/login.html';
}

/**
 * Logout user
 */
function logout() {
  if (!cognitoConfig || !cognitoConfig.enabled) return;

  // Clear local storage
  localStorage.removeItem('access_token');
  localStorage.removeItem('id_token');
  localStorage.removeItem('refresh_token');

  // Redirect to login page
  window.location.href = '/login.html';
}

/**
 * Update UI based on auth state
 */
function updateAuthUI(authenticated) {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.style.display = authenticated ? 'block' : 'none';
  }
}

/**
 * Check authentication status (for manual checks)
 */
async function checkAuth() {
  // If auth is not configured, allow access
  if (!cognitoConfig || !cognitoConfig.enabled) {
    return true;
  }

  // Check if we have a token
  const token = localStorage.getItem('access_token');
  if (!token) {
    redirectToLogin();
    return false;
  }

  return true;
}

/**
 * Fetch with authentication header
 */
async function fetchWithAuth(url, options = {}) {
  const token = localStorage.getItem('access_token');

  const headers = {
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // If unauthorized, token might be expired
  if (response.status === 401) {
    console.log('Unauthorized - token may be expired');
    localStorage.removeItem('access_token');
    if (cognitoConfig && cognitoConfig.enabled) {
      redirectToLogin();
    }
    throw new Error('Unauthorized');
  }

  return response;
}

// Initialize auth when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}
