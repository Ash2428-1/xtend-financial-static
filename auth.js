/* ============================================================================
   AWS Cognito Authentication Module
   Add this to your index.html before the closing </body> tag
   ============================================================================ */

const COGNITO_CONFIG = {
  UserPoolId: 'af-south-1_qovY6omk5',
  ClientId: '68lpnp93lshbhcu2jvf1cgce6b',
  Region: 'af-south-1'
};

// Simple hash storage for tokens
const AUTH_STORE = {
  getToken: () => localStorage.getItem('xtend_auth_token'),
  setToken: (t) => localStorage.setItem('xtend_auth_token', t),
  getRole: () => localStorage.getItem('xtend_auth_role'),
  setRole: (r) => localStorage.setItem('xtend_auth_role', r),
  getEmail: () => localStorage.getItem('xtend_auth_email'),
  setEmail: (e) => localStorage.setItem('xtend_auth_email', e),
  clear: () => {
    localStorage.removeItem('xtend_auth_token');
    localStorage.removeItem('xtend_auth_role');
    localStorage.removeItem('xtend_auth_email');
  }
};

/* --------------------------------------------------------------------------
   Base64 helper for JWT decoding
   -------------------------------------------------------------------------- */
function b64DecodeUnicode(str) {
  return decodeURIComponent(
    atob(str.replace(/-/g, '+').replace(/_/g, '/'))
      .split('')
      .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    return JSON.parse(b64DecodeUnicode(base64Url));
  } catch (e) {
    return null;
  }
}

/* --------------------------------------------------------------------------
   AWS Cognito Auth API (using fetch - no SDK needed)
   -------------------------------------------------------------------------- */
async function cognitoAuth(email, password) {
  const url = `https://cognito-idp.${COGNITO_CONFIG.Region}.amazonaws.com/`;
  const payload = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: COGNITO_CONFIG.ClientId,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (data.AuthenticationResult) {
    return data.AuthenticationResult;
  }
  throw new Error(data.message || 'Authentication failed');
}

async function getUserAttributes(accessToken) {
  const url = `https://cognito-idp.${COGNITO_CONFIG.Region}.amazonaws.com/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.GetUser'
    },
    body: JSON.stringify({ AccessToken: accessToken })
  });
  return res.json();
}

/* --------------------------------------------------------------------------
   UI Helpers
   -------------------------------------------------------------------------- */
function showLoginModal() {
  const existing = document.getElementById('xtend-auth-modal');
  if (existing) existing.style.display = 'flex';
}

function hideLoginModal() {
  const existing = document.getElementById('xtend-auth-modal');
  if (existing) existing.style.display = 'none';
}

function updateUIBasedOnRole(role) {
  // Add 'read-only' class to body for CSS targeting
  document.body.classList.toggle('auth-readonly', role !== 'superadmin');
  document.body.classList.toggle('auth-superadmin', role === 'superadmin');

  // Find all editable inputs and disable them for non-superadmin
  if (role !== 'superadmin') {
    document.querySelectorAll('input, select, textarea, button:not(.auth-logout-btn)').forEach(el => {
      if (!el.hasAttribute('data-auth-exclude')) {
        el.disabled = true;
        el.style.opacity = '0.6';
        el.style.cursor = 'not-allowed';
      }
    });

    // Add a read-only banner
    const banner = document.createElement('div');
    banner.id = 'auth-readonly-banner';
    banner.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#111;color:#fff;padding:10px 20px;text-align:center;font-size:14px;">
        🔒 View-only mode — Contact admin for edit access
      </div>
    `;
    document.body.appendChild(banner);
    document.body.style.paddingTop = '40px';
  }
}

function showUserInfo(email, role) {
  let bar = document.getElementById('auth-user-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'auth-user-bar';
    bar.style.cssText = 'position:fixed;top:0;right:0;z-index:10000;padding:8px 16px;background:#111;color:#fff;font-size:13px;display:flex;align-items:center;gap:12px;border-radius:0 0 0 8px;';
    document.body.appendChild(bar);
  }
  const roleLabel = role === 'superadmin' ? 'Super Admin' : 'Viewer';
  const roleColor = role === 'superadmin' ? '#4ade80' : '#fbbf24';
  bar.innerHTML = `
    <span>${email}</span>
    <span style="color:${roleColor};font-weight:600;">${roleLabel}</span>
    <button class="auth-logout-btn" onclick="window.xtendAuthLogout()" style="background:#333;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">Logout</button>
  `;
}

/* --------------------------------------------------------------------------
   Main Auth Flow
   -------------------------------------------------------------------------- */
async function xtendAuthLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');

  try {
    const result = await cognitoAuth(email, password);
    const idToken = result.IdToken;
    const accessToken = result.AccessToken;

    // Get user attributes to find role
    const userData = await getUserAttributes(accessToken);
    const roleAttr = userData.UserAttributes?.find(a => a.Name === 'custom:role');
    const role = roleAttr?.Value || 'viewer';

    // Store auth data
    AUTH_STORE.setToken(idToken);
    AUTH_STORE.setRole(role);
    AUTH_STORE.setEmail(email);

    // Update UI
    hideLoginModal();
    updateUIBasedOnRole(role);
    showUserInfo(email, role);

  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Login failed';
  }
}

function xtendAuthLogout() {
  AUTH_STORE.clear();
  location.reload();
}

function xtendAuthCheck() {
  const token = AUTH_STORE.getToken();
  if (!token) {
    showLoginModal();
    return;
  }

  // Validate token (basic expiry check)
  const payload = parseJwt(token);
  if (!payload || payload.exp * 1000 < Date.now()) {
    AUTH_STORE.clear();
    showLoginModal();
    return;
  }

  // User is authenticated
  const role = AUTH_STORE.getRole() || 'viewer';
  const email = AUTH_STORE.getEmail() || '';
  hideLoginModal();
  updateUIBasedOnRole(role);
  showUserInfo(email, role);
}

/* --------------------------------------------------------------------------
   Create Login Modal HTML
   -------------------------------------------------------------------------- */
function createLoginModal() {
  const modal = document.createElement('div');
  modal.id = 'xtend-auth-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;padding:32px;border-radius:8px;width:100%;max-width:360px;box-shadow:0 20px 40px rgba(0,0,0,0.3);">
      <h2 style="margin:0 0 20px;font-size:20px;color:#111;">Guud Financial Dashboard</h2>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;color:#666;margin-bottom:4px;">Email</label>
        <input id="auth-email" type="email" placeholder="you@guud.global" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;font-size:14px;box-sizing:border-box;" />
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;color:#666;margin-bottom:4px;">Password</label>
        <input id="auth-password" type="password" placeholder="••••••••" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;font-size:14px;box-sizing:border-box;" />
      </div>
      <div id="auth-error" style="color:#dc2626;font-size:13px;margin-bottom:12px;"></div>
      <button onclick="window.xtendAuthLogin()" style="width:100%;padding:12px;background:#111;color:#fff;border:none;border-radius:4px;font-size:14px;font-weight:600;cursor:pointer;">
        Sign In
      </button>
    </div>
  `;
  document.body.appendChild(modal);
}

/* --------------------------------------------------------------------------
   Initialize
   -------------------------------------------------------------------------- */
(function initXtendAuth() {
  // Only run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initXtendAuth);
    return;
  }

  // Expose globally
  window.xtendAuthLogin = xtendAuthLogin;
  window.xtendAuthLogout = xtendAuthLogout;

  createLoginModal();
  xtendAuthCheck();
})();
