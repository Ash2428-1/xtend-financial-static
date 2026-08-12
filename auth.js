/* ============================================================================
   AWS Cognito Authentication Module
   - Sign in (USER_PASSWORD_AUTH)
   - First-login account confirmation (verification code emailed by Cognito)
   - Forgot / reset password
   - User creation (SignUp) used by the User Permissions tab
   - Per-user authorization: custom:role, custom:access (read|write),
     custom:perms (JSON of granted sections) — enforced on the dashboard UI
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

/* --------------------------------------------------------------------------
   Cognito API helpers (plain fetch — no SDK)
   -------------------------------------------------------------------------- */
async function cognitoCall(target, body) {
  const res = await fetch(`https://cognito-idp.${COGNITO_CONFIG.Region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function cognitoAuth(email, password) {
  const data = await cognitoCall('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: COGNITO_CONFIG.ClientId,
    AuthParameters: { USERNAME: email, PASSWORD: password }
  });
  if (data.AuthenticationResult) return data.AuthenticationResult;
  const err = new Error(data.message || 'Authentication failed');
  err.code = data.__type || '';
  throw err;
}

async function cognitoSignUp({ email, password, name, access, perms }) {
  const data = await cognitoCall('SignUp', {
    ClientId: COGNITO_CONFIG.ClientId,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'name', Value: name },
      { Name: 'custom:access', Value: access },
      { Name: 'custom:perms', Value: JSON.stringify(perms) }
    ]
  });
  if (data.UserSub) return data;
  const err = new Error(
    (data.__type || '').includes('UsernameExists')
      ? 'A login with this email already exists.'
      : (data.message || 'Failed to create user')
  );
  err.code = data.__type || '';
  throw err;
}

async function cognitoConfirmSignUp(email, code) {
  const data = await cognitoCall('ConfirmSignUp', {
    ClientId: COGNITO_CONFIG.ClientId,
    Username: email,
    ConfirmationCode: code
  });
  if (data.error || data.__type) throw new Error(data.message || 'Failed to confirm account');
  return data;
}

async function cognitoResendCode(email) {
  const data = await cognitoCall('ResendConfirmationCode', {
    ClientId: COGNITO_CONFIG.ClientId,
    Username: email
  });
  if (data.CodeDeliveryDetails) return data;
  throw new Error(data.message || 'Failed to resend code');
}

async function cognitoForgotPassword(email) {
  const data = await cognitoCall('ForgotPassword', {
    ClientId: COGNITO_CONFIG.ClientId,
    Username: email
  });
  if (data.CodeDeliveryDetails) return data;
  throw new Error(data.message || 'Failed to send reset code');
}

async function cognitoConfirmForgotPassword(email, code, newPassword) {
  const data = await cognitoCall('ConfirmForgotPassword', {
    ClientId: COGNITO_CONFIG.ClientId,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword
  });
  if (data.error || data.__type) throw new Error(data.message || 'Failed to reset password');
  return data;
}

/* --------------------------------------------------------------------------
   Authorization — derive role / access level / granted sections from the
   ID token claims (custom attributes ride along in the ID token).
   -------------------------------------------------------------------------- */
function getAuthzFromToken(idToken) {
  const claims = parseJwt(idToken) || {};
  let perms = null;
  try {
    perms = claims['custom:perms'] ? JSON.parse(claims['custom:perms']) : null;
  } catch (e) {
    perms = null;
  }
  return {
    role: claims['custom:role'] || 'user',
    access: claims['custom:access'] || 'read',
    perms
  };
}

function showLoginModal() {
  const existing = document.getElementById('xtend-auth-modal');
  if (existing) existing.style.display = 'flex';
}

function hideLoginModal() {
  const existing = document.getElementById('xtend-auth-modal');
  if (existing) existing.style.display = 'none';
}

function showAuthBanner(text) {
  if (document.getElementById('auth-readonly-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'auth-readonly-banner';
  banner.innerHTML = `
    <div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#7C2037;color:#fff;padding:10px 20px;text-align:center;font-size:14px;font-family:Calibri,'Segoe UI',Roboto,Arial,sans-serif;">
      ${text}
    </div>
  `;
  document.body.appendChild(banner);
  document.body.style.paddingTop = '40px';
}

/* --- Read-only enforcement: disable every editable control, including ones
       added later by re-renders (MutationObserver). --- */
let readOnlyObserver = null;

function disableEditableElements(root) {
  root.querySelectorAll('input, select, textarea, button').forEach((el) => {
    if (el.closest('#xtend-auth-modal')) return;
    if (el.classList.contains('auth-logout-btn')) return;
    if (el.hasAttribute('data-auth-exclude')) return;
    if (!el.disabled) {
      el.disabled = true;
      el.style.opacity = '0.6';
      el.style.cursor = 'not-allowed';
    }
  });
}

function startReadOnlyEnforcement() {
  disableEditableElements(document);
  if (readOnlyObserver) return;
  let scheduled = false;
  readOnlyObserver = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      disableEditableElements(document);
    }, 50);
  });
  readOnlyObserver.observe(document.body, { childList: true, subtree: true });
}

/* --- Per-section visibility: hide entity/output/input tabs the user was
       not granted, then make sure the active tab is a visible one. --- */
const ENTITY_PANEL_IDS = [
  'entityGeneral', 'entityMobiles', 'entitySA', 'entitySubs',
  'entityEcosystem', 'entitySensitivity', 'entityPipeline',
  'entitySummary', 'entityPermissions'
];

function hideAllEntityPanels() {
  ENTITY_PANEL_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function activateFirstVisible(selector) {
  const tabs = Array.from(document.querySelectorAll(selector));
  if (!tabs.length) return;
  const active = tabs.find((t) => t.classList.contains('active'));
  if (active && active.style.display !== 'none') return;
  const first = tabs.find((t) => t.style.display !== 'none');
  if (first) first.click();
}

function applySectionPermissions(perms) {
  const mTabs = (perms.guudMobiles && perms.guudMobiles.tabs) || {};
  const saTabs = (perms.guudSA && perms.guudSA.tabs) || {};

  const entityGrants = {
    general: !!perms.generalAssumptions,
    summary: !!perms.summary,
    mobiles: !!(perms.guudMobiles && perms.guudMobiles.enabled),
    sa: !!(perms.guudSA && perms.guudSA.enabled)
  };

  // Top-level entity tabs — only granted entities stay visible.
  document.querySelectorAll('.entity-tab').forEach((tab) => {
    tab.style.display = entityGrants[tab.dataset.entity] ? '' : 'none';
  });

  // Guud Mobiles output tabs.
  document.querySelectorAll('.output-tab[data-output]').forEach((tab) => {
    tab.style.display = mTabs[tab.dataset.output] ? '' : 'none';
  });

  // Guud SA output tabs.
  document.querySelectorAll('.sa-output-tab[data-saoutput]').forEach((tab) => {
    tab.style.display = saTabs[tab.dataset.saoutput] ? '' : 'none';
  });

  // Guud Mobiles input tabs (region tabs map to Mobiles grants; the POCx /
  // SIOC / Dental product inputs map to the matching Guud SA grants).
  const inputMap = {
    'region-nc': 'nc', 'region-gt': 'gt', 'region-kzn': 'kzn',
    'supportoffice': 'supportoffice',
    'pocx': 'pocx', 'sioc': 'sioc', 'dental': 'dental'
  };
  document.querySelectorAll('#entityMobiles .tab[data-product]').forEach((tab) => {
    const permKey = inputMap[tab.dataset.product];
    tab.style.display = permKey && (mTabs[permKey] || saTabs[permKey]) ? '' : 'none';
  });

  activateFirstVisible('.entity-tab');
  activateFirstVisible('#entityMobiles .tab[data-product]');
  activateFirstVisible('.output-tab[data-output]');
  activateFirstVisible('.sa-output-tab[data-saoutput]');

  const anyGranted = Object.values(entityGrants).some(Boolean);
  if (!anyGranted) {
    hideAllEntityPanels();
    const header = document.querySelector('header');
    if (header) header.style.display = 'none';
  }
  return anyGranted;
}

function applyAuthz(authz) {
  const isSuper = authz.role === 'superadmin';
  document.body.classList.toggle('auth-superadmin', isSuper);
  document.body.classList.toggle('auth-readonly', !isSuper && authz.access !== 'write');

  if (isSuper) return; // full access, nothing hidden or disabled

  let anyGranted = false;
  if (authz.perms) {
    anyGranted = applySectionPermissions(authz.perms);
  } else {
    // No permissions recorded on this account (e.g. someone self-registered
    // instead of being created by an admin) — deny by default: no tabs, no
    // panels, no data.
    document.querySelectorAll('.entity-tab').forEach((t) => { t.style.display = 'none'; });
    hideAllEntityPanels();
    const header = document.querySelector('header');
    if (header) header.style.display = 'none';
  }

  if (authz.access !== 'write') {
    startReadOnlyEnforcement();
  }
  if (!anyGranted) {
    showAuthBanner('🔒 This account has no dashboard access yet — contact your admin.');
  } else if (authz.access !== 'write') {
    showAuthBanner('🔒 View-only mode — Contact admin for edit access');
  } else {
    showAuthBanner('🔒 Limited access — you can edit the sections granted to you');
  }
}

function showUserInfo(email, authz) {
  let bar = document.getElementById('auth-user-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'auth-user-bar';
    bar.style.cssText = 'position:fixed;top:0;right:0;z-index:10000;padding:8px 16px;background:#111;color:#fff;font-size:13px;display:flex;align-items:center;gap:12px;border-radius:0 0 0 8px;font-family:Calibri,"Segoe UI",Roboto,Arial,sans-serif;';
    document.body.appendChild(bar);
  }
  const roleLabel = authz.role === 'superadmin' ? 'Super Admin' : (authz.access === 'write' ? 'Editor' : 'Viewer');
  const roleColor = authz.role === 'superadmin' ? '#FF3366' : '#fbbf24';
  bar.innerHTML = `
    <span>${email}</span>
    <span style="color:${roleColor};font-weight:600;">${roleLabel}</span>
    <button class="auth-logout-btn" onclick="window.xtendAuthLogout()" style="background:#333;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-family:inherit;">Logout</button>
  `;
}

/* --------------------------------------------------------------------------
   User creation (called from the User Permissions tab)
   -------------------------------------------------------------------------- */
function generateTempPassword() {
  const groups = ['ABCDEFGHJKMNPQRSTUVWXYZ', 'abcdefghjkmnpqrstuvwxyz', '23456789', '!@#$%&*'];
  const all = groups.join('');
  const rand = (n, chars) => {
    const arr = new Uint32Array(n);
    crypto.getRandomValues(arr);
    return Array.from(arr, (v) => chars[v % chars.length]).join('');
  };
  const chars = (groups.map((g) => rand(2, g)).join('') + rand(4, all)).split('');
  // Fisher–Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function xtendCreateUser({ name, email, access, perms }) {
  const password = generateTempPassword();
  await cognitoSignUp({ email, password, name, access: access === 'write' ? 'write' : 'read', perms });
  return { password };
}

/* --------------------------------------------------------------------------
   Main Auth Flow
   -------------------------------------------------------------------------- */
function completeLogin(authResult, email) {
  const idToken = authResult.IdToken;
  const authz = getAuthzFromToken(idToken);

  AUTH_STORE.setToken(idToken);
  AUTH_STORE.setRole(authz.role);
  AUTH_STORE.setEmail(email);

  hideLoginModal();
  applyAuthz(authz);
  showUserInfo(email, authz);
}

async function xtendAuthLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');

  try {
    const result = await cognitoAuth(email, password);
    completeLogin(result, email);
  } catch (err) {
    if (err && err.code === 'UserNotConfirmedException') {
      if (errorEl) errorEl.textContent = '';
      showConfirmForm(email);
      return;
    }
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

  const authz = getAuthzFromToken(token);
  const email = AUTH_STORE.getEmail() || payload.email || '';
  hideLoginModal();
  applyAuthz(authz);
  showUserInfo(email, authz);
}

/* --------------------------------------------------------------------------
   First-login account confirmation (verification code emailed by Cognito)
   -------------------------------------------------------------------------- */
async function xtendAuthConfirmSignup() {
  const email = document.getElementById('cf-email').value.trim();
  const code = document.getElementById('cf-code').value.trim();
  const errorEl = document.getElementById('cf-error');
  const successEl = document.getElementById('cf-success');

  try {
    await cognitoConfirmSignUp(email, code);
    if (errorEl) errorEl.textContent = '';
    if (successEl) successEl.textContent = 'Account confirmed! You can now sign in.';
    setTimeout(() => showLoginForm(), 1500);
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Failed to confirm account';
    if (successEl) successEl.textContent = '';
  }
}

async function xtendAuthResendCode() {
  const email = document.getElementById('cf-email').value.trim();
  const errorEl = document.getElementById('cf-error');
  const successEl = document.getElementById('cf-success');

  try {
    await cognitoResendCode(email);
    if (errorEl) errorEl.textContent = '';
    if (successEl) successEl.textContent = 'A new code is on its way — check your email.';
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Failed to resend code';
    if (successEl) successEl.textContent = '';
  }
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
  document.getElementById('confirm-form').style.display = 'none';
}

function showForgotForm() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('forgot-form').style.display = 'block';
  document.getElementById('reset-form').style.display = 'none';
  document.getElementById('confirm-form').style.display = 'none';
}

function showResetPasswordForm(email) {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('forgot-form').style.display = 'none';
  document.getElementById('reset-form').style.display = 'block';
  document.getElementById('confirm-form').style.display = 'none';
  const emailField = document.getElementById('rp-email');
  if (emailField && email) emailField.value = email;
}

function showConfirmForm(email) {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('forgot-form').style.display = 'none';
  document.getElementById('reset-form').style.display = 'none';
  document.getElementById('confirm-form').style.display = 'block';
  const emailField = document.getElementById('cf-email');
  if (emailField && email) emailField.value = email;
}

/* --------------------------------------------------------------------------
   Create Login Modal HTML
   -------------------------------------------------------------------------- */
function createLoginModal() {
  const inputStyle = 'width:100%;padding:10px 12px;border:1px solid #F5DCE3;border-radius:6px;font-size:14px;box-sizing:border-box;font-family:inherit;background:#FFF0F4;';
  const labelStyle = 'display:block;font-size:12.5px;color:#6B6B6B;margin-bottom:4px;font-weight:600;';
  const btnStyle = 'width:100%;padding:12px;background:#FF3366;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.15s;';
  const btnHover = `onmouseover="this.style.background='#E01F52'" onmouseout="this.style.background='#FF3366'"`;

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
          <label style="${labelStyle}">Email</label>
          <input id="auth-email" type="email" placeholder="you@guud.global" style="${inputStyle}" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="${labelStyle}">Password</label>
          <input id="auth-password" type="password" placeholder="••••••••" style="${inputStyle}" />
        </div>
        <div id="auth-error" style="color:#E01F52;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <button onclick="window.xtendAuthLogin()" style="${btnStyle}" ${btnHover}>
          Sign In
        </button>
        <div style="text-align:center;margin-top:14px;">
          <a href="#" onclick="window.showForgotForm();return false;" style="color:#FF3366;font-size:13px;font-weight:600;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Forgot password?</a>
        </div>
      </div>

      <!-- First-login Confirm Form -->
      <div id="confirm-form" style="display:none;">
        <div style="font-size:13px;color:#6B6B6B;margin-bottom:16px;">Your account was created by an admin and needs one quick confirmation. Enter the verification code Cognito emailed to you, then sign in with your temporary password.</div>
        <div style="margin-bottom:12px;">
          <label style="${labelStyle}">Email</label>
          <input id="cf-email" type="email" readonly style="${inputStyle}opacity:0.7;" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="${labelStyle}">Verification Code</label>
          <input id="cf-code" type="text" placeholder="123456" style="${inputStyle}" />
        </div>
        <div id="cf-error" style="color:#E01F52;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <div id="cf-success" style="color:#10b981;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <button onclick="window.xtendAuthConfirmSignup()" style="${btnStyle}" ${btnHover}>
          Confirm Account
        </button>
        <div style="text-align:center;margin-top:14px;display:flex;justify-content:space-between;">
          <a href="#" onclick="window.xtendAuthResendCode();return false;" style="color:#FF3366;font-size:13px;font-weight:600;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">Resend code</a>
          <a href="#" onclick="window.showLoginForm();return false;" style="color:#6B6B6B;font-size:13px;font-weight:600;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">← Back to Sign In</a>
        </div>
      </div>

      <!-- Forgot Password Form -->
      <div id="forgot-form" style="display:none;">
        <div style="font-size:13px;color:#6B6B6B;margin-bottom:16px;">Enter your email and we'll send you a reset code.</div>
        <div style="margin-bottom:16px;">
          <label style="${labelStyle}">Email</label>
          <input id="fp-email" type="email" placeholder="you@guud.global" style="${inputStyle}" />
        </div>
        <div id="fp-error" style="color:#E01F52;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <div id="fp-success" style="color:#10b981;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <button onclick="window.xtendAuthForgotPassword()" style="${btnStyle}" ${btnHover}>
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
          <label style="${labelStyle}">Verification Code</label>
          <input id="rp-code" type="text" placeholder="123456" style="${inputStyle}" />
        </div>
        <div style="margin-bottom:12px;">
          <label style="${labelStyle}">New Password</label>
          <input id="rp-password" type="password" placeholder="••••••••" style="${inputStyle}" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="${labelStyle}">Confirm New Password</label>
          <input id="rp-confirm" type="password" placeholder="••••••••" style="${inputStyle}" />
        </div>
        <div id="rp-error" style="color:#E01F52;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <div id="rp-success" style="color:#10b981;font-size:13px;margin-bottom:12px;font-weight:600;"></div>
        <button onclick="window.xtendAuthConfirmReset()" style="${btnStyle}" ${btnHover}>
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
  window.xtendAuthConfirmSignup = xtendAuthConfirmSignup;
  window.xtendAuthResendCode = xtendAuthResendCode;
  window.xtendCreateUser = xtendCreateUser;
  window.showLoginForm = showLoginForm;
  window.showForgotForm = showForgotForm;
  window.showResetPasswordForm = showResetPasswordForm;
  window.showConfirmForm = showConfirmForm;
  createLoginModal();
  xtendAuthCheck();
})();
