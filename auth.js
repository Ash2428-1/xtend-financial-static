/* ============================================================================
   AWS Cognito Authentication Module
   ============================================================================ */

const COGNITO_CONFIG = {
  UserPoolId: 'af-south-1_qovY6omk5',
  ClientId: '68lpnp93lshbhcu2jvf1cgce6b',
  Region: 'af-south-1'
};

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

async function cognitoAuth(email, password) {
  const url = `https://cognito-idp.${COGNITO_CONFIG.Region}.amazonaws.com/`;
  const payload = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: COGNITO_CONFIG.ClientId,
    AuthParameters: { USERNAME: email, PASSWORD: password }
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
  if (data.AuthenticationResult) return data.AuthenticationResult;
  throw new Error(data.message || 'Authentication failed');
}

async function cognitoForgotPassword(email) {
  const url = `https://cognito-idp.${COGNITO_CONFIG.Region}.amazonaws.com/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.ForgotPassword'
    },
    body: JSON.stringify({ ClientId: COGNITO_CONFIG.ClientId, Username: email })
  });
  const data = await res.json();
  if (data.CodeDeliveryDetails) return data;
  throw new Error(data.message || 'Failed to send reset code');
}

async function cognitoConfirmForgotPassword(email, code, newPassword) {
  const url = `https://cognito-idp.${COGNITO_CONFIG.Region}.amazonaws.com/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmForgotPassword'
    },
    body: JSON.stringify({
      ClientId: COGNITO_CONFIG.ClientId,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.message || 'Failed to reset password');
  return data;
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

function showLoginModal() {
  const existing = document.getElementById('xtend-auth-modal');
  if (existing) existing.style.display = 'flex';
}

function hideLoginModal() {
  const existing = document.getElementById('xtend-auth-modal');
  if (existing) existing.style.display = 'none';
}

function updateUIBasedOnRole(role) {
  document.body.classList.toggle('auth-readonly', role !== 'superadmin');
  document.body.classList.toggle('auth-superadmin', role === 'superadmin');

  if (role !== 'superadmin') {
    document.querySelectorAll('input, select, textarea, button:not(.auth-logout-btn)').forEach(el => {
      if (!el.hasAttribute('data-auth-exclude')) {
        el.disabled = true;
        el.style.opacity = '0.6';
        el.style.cursor = 'not-allowed';
      }
    });

    const banner = document.createElement('div');
    banner.id = 'auth-readonly-banner';
    banner.innerHTML = `
      <div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#7C2037;color:#fff;padding:10px 20px;text-align:center;font-size:14px;font-family:Calibri,'Segoe UI',Roboto,Arial,sans-serif;">
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
    bar.style.cssText = 'position:fixed;top:0;right:0;z-index:10000;padding:8px 16px;background:#111;color:#fff;font-size:13px;display:flex;align-items:center;gap:12px;border-radius:0 0 0 8px;font-family:Calibri,"Segoe UI",Roboto,Arial,sans-serif;';
    document.body.appendChild(bar);
  }
  const roleLabel = role === 'superadmin' ? 'Super Admin' : 'Viewer';
  const roleColor = role === 'superadmin' ? '#FF3366' : '#fbbf24';
  bar.innerHTML = `
    <span>${email}</span>
    <span style="color:${roleColor};font-weight:600;">${roleLabel}</span>
    <button class="auth-logout-btn" onclick="window.xtendAuthLogout()" style="background:#333;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-family:inherit;">Logout</button>
  `;
}

async function xtendAuthLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');

  try {
    const result = await cognitoAuth(email, password);
    const idToken = result.IdToken;
    const accessToken = result.AccessToken;

    const userData = await getUserAttributes(accessToken);
    const roleAttr = userData.UserAttributes?.find(a => a.Name === 'custom:role');
    const role = roleAttr?.Value || 'viewer';

    AUTH_STORE.setToken(idToken);
    AUTH_STORE.setRole(role);
    AUTH_STORE.setEmail(email);

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

  const payload = parseJwt(token);
  if (!payload || payload.exp * 1000 < Date.now()) {
    AUTH_STORE.clear();
    showLoginModal();
    return;
  }

  const role = AUTH_STORE.getRole() || 'viewer';
  const email = AUTH_STORE.getEmail() || '';
  hideLoginModal();
  updateUIBasedOnRole(role);
  showUserInfo(email, role);
}

/* --------------------------------------------------------------------------
   Forgot Password Flow
   -------------------------------------------------------------------------- */
async function xtendAuthForgotPassword() {
  const email = document.getElementById('fp-email').value.trim();
  const errorEl = document.getElementById('fp-error');
  const successEl = document.getElementById('fp-success');

  try {
    await cognitoForgotPassword(email);
    if (errorEl) errorEl.textContent = '';
    if (successEl) successEl.textContent = 'Reset code sent! Check your email.';
    setTimeout(() => showResetPasswordForm(email), 1500);
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Failed to send reset code';
    if (successEl) successEl.textContent = '';
  }
}

async function xtendAuthConfirmReset() {
  const email = document.getElementById('rp-email').value.trim();
  const code = document.getElementById('rp-code').value.trim();
  const password = document.getElementById('rp-password').value;
  const confirm = document.getElementById('rp-confirm').value;
  const errorEl = document.getElementById('rp-error');
  const successEl = document.getElementById('rp-success');

  if (password !== confirm) {
    if (errorEl) errorEl.textContent = 'Passwords do not match';
    return;
  }
  if (password.length < 8) {
    if (errorEl) errorEl.textContent = 'Password must be at least 8 characters';
    return;
  }

  try {
    await cognitoConfirmForgotPassword(email, code, password);
    if (errorEl) errorEl.textContent = '';
    if (successEl) successEl.textContent = 'Password reset successful! You can now log in.';
    setTimeout(() => showLoginForm(), 2000);
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Failed to reset password';
    if (successEl) successEl.textContent = '';
  }
}

function showLoginForm() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('forgot-form').style.display = 'none';
  document.getElementById('reset-form').style.display = 'none';
}

function showForgotForm() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('forgot-form').style.display = 'block';
  document.getElementById('reset-form').style.display = 'none';
}

function showResetPasswordForm(email) {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('forgot-form').style.display = 'none';
  document.getElementById('reset-form').style.display = 'block';
  const emailField = document.getElementById('rp-email');
  if (emailField && email) emailField.value = email;
}

/* --------------------------------------------------------------------------
   Create Login Modal HTML
   -------------------------------------------------------------------------- */
function createLoginModal() {
  const modal = document.createElement('div');
  modal.id = 'xtend-auth-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#F6E9EC;display:flex;align-items:center;justify-content:center;font-family:Calibri,"Segoe UI",Roboto,Arial,sans-serif;';
  modal.innerHTML = `
    <div style="background:#fff;padding:36px 32px;border-radius:10px;width:100%;max-width:380px;box-shadow:0 1px 3px rgba(22,50,58,0.08);border:1px solid #F5DCE3;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:24px;">
        <svg width="44" height="44" viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
          <circle cx="26" cy="26" r="25" fill="#FF3366"/>
          <circle cx="26" cy="26" r="25" fill="none" stroke="#FFF0F4" stroke-width="1.5" stroke-opacity="0.5"/>
          <text x="26" y="35" font-family="Calibri, Arial, sans-serif" font-size="26" font-weight="700" fill="#FFFFFF" text-anchor="middle">G</text>
        </svg>
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#FF3366;font-weight:700;margin-bottom:2px;">Mobile Economics</div>
          <div style="font-size:18px;font-weight:700;color:#111111;letter-spacing:0.2px;">Guud Marketplace</div>
        </div>
      </div>

      <!-- Login Form -->
      <div id="login-form">
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:12.5px;color:#6B6B6B;margin-bottom:4px;font-weight:600;">Email</label>
          <input id="auth-email" type="email" placeholder="you@guud.global" style="width:100%;padding:10px 12px;border:1px solid #F5DCE3;border-radius:6px;font-size:14px;box-sizing:border-box;font-family:inherit;background:#FFF0F4;" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:12.5px;color:#6B6B6B;margin-bottom:4px;font-weight:600;">Password</label>
          <input id="auth-password" type="password" placeholder="••••••••" style="width:100%;padding:10px 12px;border:1px solid #F5DCE3;border-radius:6px;font-size:14px;box-sizing:border-box;font-family:inherit;background:#FFF0F4;" />
        </div>
        <div id="auth-error" style="color:#E01F52;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <button onclick="window.xtendAuthLogin()" style="width:100%;padding:12px;background:#FF3366;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.15s;" onmouseover="this.style.background='#E01F52'" onmouseout="this.style.background='#FF3366'">
          Sign In
        </button>
        <div style="text-align:center;margin-top:14px;">
          <a href="#" onclick="window.showForgotForm();return false;" style="color:#FF3366;font-size:13px;font-weight:600;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Forgot password?</a>
        </div>
      </div>

      <!-- Forgot Password Form -->
      <div id="forgot-form" style="display:none;">
        <div style="font-size:13px;color:#6B6B6B;margin-bottom:16px;">Enter your email and we'll send you a reset code.</div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:12.5px;color:#6B6B6B;margin-bottom:4px;font-weight:600;">Email</label>
          <input id="fp-email" type="email" placeholder="you@guud.global" style="width:100%;padding:10px 12px;border:1px solid #F5DCE3;border-radius:6px;font-size:14px;box-sizing:border-box;font-family:inherit;background:#FFF0F4;" />
        </div>
        <div id="fp-error" style="color:#E01F52;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <div id="fp-success" style="color:#10b981;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <button onclick="window.xtendAuthForgotPassword()" style="width:100%;padding:12px;background:#FF3366;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.15s;" onmouseover="this.style.background='#E01F52'" onmouseout="this.style.background='#FF3366'">
          Send Reset Code
        </button>
        <div style="text-align:center;margin-top:14px;">
          <a href="#" onclick="window.showLoginForm();return false;" style="color:#6B6B6B;font-size:13px;font-weight:600;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">← Back to Sign In</a>
        </div>
      </div>

      <!-- Reset Password Form -->
      <div id="reset-form" style="display:none;">
        <div style="font-size:13px;color:#6B6B6B;margin-bottom:16px;">Enter the code from your email and your new password.</div>
        <input id="rp-email" type="hidden" />
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:12.5px;color:#6B6B6B;margin-bottom:4px;font-weight:600;">Verification Code</label>
          <input id="rp-code" type="text" placeholder="123456" style="width:100%;padding:10px 12px;border:1px solid #F5DCE3;border-radius:6px;font-size:14px;box-sizing:border-box;font-family:inherit;background:#FFF0F4;" />
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:12.5px;color:#6B6B6B;margin-bottom:4px;font-weight:600;">New Password</label>
          <input id="rp-password" type="password" placeholder="••••••••" style="width:100%;padding:10px 12px;border:1px solid #F5DCE3;border-radius:6px;font-size:14px;box-sizing:border-box;font-family:inherit;background:#FFF0F4;" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:12.5px;color:#6B6B6B;margin-bottom:4px;font-weight:600;">Confirm New Password</label>
          <input id="rp-confirm" type="password" placeholder="••••••••" style="width:100%;padding:10px 12px;border:1px solid #F5DCE3;border-radius:6px;font-size:14px;box-sizing:border-box;font-family:inherit;background:#FFF0F4;" />
        </div>
        <div id="rp-error" style="color:#E01F52;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <div id="rp-success" style="color:#10b981;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <button onclick="window.xtendAuthConfirmReset()" style="width:100%;padding:12px;background:#FF3366;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.15s;" onmouseover="this.style.background='#E01F52'" onmouseout="this.style.background='#FF3366'">
          Reset Password
        </button>
        <div style="text-align:center;margin-top:14px;">
          <a href="#" onclick="window.showLoginForm();return false;" style="color:#6B6B6B;font-size:13px;font-weight:600;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">← Back to Sign In</a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

(function initXtendAuth() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initXtendAuth);
    return;
  }
  window.xtendAuthLogin = xtendAuthLogin;
  window.xtendAuthLogout = xtendAuthLogout;
  window.xtendAuthForgotPassword = xtendAuthForgotPassword;
  window.xtendAuthConfirmReset = xtendAuthConfirmReset;
  window.showLoginForm = showLoginForm;
  window.showForgotForm = showForgotForm;
  window.showResetPasswordForm = showResetPasswordForm;
  createLoginModal();
  xtendAuthCheck();
})();
