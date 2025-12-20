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

    // Check if we're on the OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('code')) {
      await handleOAuthCallback(urlParams.get('code'));
      return;
    }

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
 * Redirect to Cognito hosted UI for login
 */
function redirectToLogin() {
  if (!cognitoConfig || !cognitoConfig.enabled) return;

  const { region, userPoolId, clientId } = cognitoConfig;
  const domain = `https://crypto-trading-bot-dev-${userPoolId.split('_')[1]}.auth.${region}.amazoncognito.com`;
  const redirectUri = window.location.origin;

  const loginUrl = `${domain}/login?` + new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'email openid profile'
  });

  console.log('Redirecting to Cognito login...');
  window.location.href = loginUrl;
}

/**
 * Handle OAuth callback with authorization code
 */
async function handleOAuthCallback(code) {
  console.log('Handling OAuth callback...');

  try {
    const { region, userPoolId, clientId } = cognitoConfig;
    const domain = `https://crypto-trading-bot-dev-${userPoolId.split('_')[1]}.auth.${region}.amazoncognito.com`;
    const redirectUri = window.location.origin;

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(`${domain}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for tokens');
    }

    const tokens = await tokenResponse.json();
    accessToken = tokens.access_token;

    // Store tokens
    localStorage.setItem('access_token', accessToken);
    if (tokens.id_token) {
      localStorage.setItem('id_token', tokens.id_token);
    }
    if (tokens.refresh_token) {
      localStorage.setItem('refresh_token', tokens.refresh_token);
    }

    // Remove code from URL and redirect to clean dashboard
    window.history.replaceState({}, document.title, window.location.pathname);
    updateAuthUI(true);

    // Reload the page to start fresh with authenticated state
    window.location.reload();
  } catch (error) {
    console.error('OAuth callback failed:', error);
    alert('Login failed. Please try again.');
    localStorage.clear();
    redirectToLogin();
  }
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

  // Redirect to Cognito logout endpoint
  const { region, userPoolId, clientId } = cognitoConfig;
  const domain = `https://crypto-trading-bot-dev-${userPoolId.split('_')[1]}.auth.${region}.amazoncognito.com`;
  const redirectUri = window.location.origin;

  const logoutUrl = `${domain}/logout?` + new URLSearchParams({
    client_id: clientId,
    logout_uri: redirectUri,
  });

  window.location.href = logoutUrl;
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
