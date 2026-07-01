// ── auth.js v3.17 ────────────────────────────────────────────────
// MODELO DE SEGURANÇA DEFINITIVO — PIN DE ADMINISTRADOR
//
// PROBLEMA RESOLVIDO DEFINITIVAMENTE:
// O CLIENT_ID por si só nunca é suficiente para se tornar admin.
// É necessário também o PIN do administrador (definido por ele,
// nunca armazenado em texto puro, verificado por hash SHA-256
// com salt fixo do sistema).
//
// FLUXO DE PRIMEIRO SETUP (dispositivo original):
//   1. Admin abre painel oculto → insere Client ID
//   2. Sistema pede para CRIAR um PIN (6 dígitos) — não existe ainda
//   3. PIN é hasheado e salvo em ADMIN_PIN_HASH_KEY
//   4. Admin autentica com Google → loginWithGoogleToken cria admin,
//      grava ADMIN_EMAIL_KEY e SETUP_DONE_KEY
//
// FLUXO EM NOVO DISPOSITIVO:
//   1. Admin insere Client ID
//   2. Sistema pede o PIN (já existe — precisa ser importado via
//      arquivo de configuração OU digitado se o admin runs souber)
//   3. Sem o hash do PIN correto, o painel nunca libera o botão Google
//   4. Mesmo sabendo o Client ID, sem o PIN não há acesso admin
//
// O PIN é a segunda credencial que NUNCA viaja sozinha com o Client ID.
// Compartilhar o Client ID não compartilha o PIN.

const AUTH_KEY          = 'smm_auth';
const USERS_KEY         = 'smm_users';
const WHITELIST_KEY     = 'smm_whitelist';
const CLIENT_ID_KEY     = 'smm_client_id';
const USER_TOKEN_KEY    = 'smm_user_token';
const USER_CID_KEY      = 'smm_user_cid';
const ADMIN_DEVICE_KEY  = 'smm_admin_device';
const ADMIN_EMAIL_KEY   = 'smm_admin_email';
const SETUP_DONE_KEY    = 'smm_setup_done';
const ADMIN_PIN_HASH_KEY= 'smm_admin_pin_hash';   // NEW: hash do PIN
const PIN_SALT          = 'SMM-PIN-SALT-v1';        // salt fixo do app (não secreto, só evita colisão trivial)
const DB_KEY            = 'smm_custom_db';

const ROLES = {
  admin:       { label:'Administrador', icon:'👑', color:'#7c3aed', modules:['chamados','registro','orcamento','relatorios','admin','preventiva'], canCreate:true,  canEdit:true,  canDelete:true,  canViewPrices:true  },
  gestor:      { label:'Gestor',        icon:'📊', color:'#0284c7', modules:['chamados','registro','orcamento','relatorios','preventiva'],         canCreate:false, canEdit:false, canDelete:false, canViewPrices:true  },
  tecnico:     { label:'Técnico',       icon:'🔧', color:'#059669', modules:['chamados','registro','preventiva'],                                  canCreate:true,  canEdit:true,  canDelete:false, canViewPrices:false },
  solicitante: { label:'Solicitante',   icon:'📋', color:'#d97706', modules:['chamados'],                                                          canCreate:true,  canEdit:false, canDelete:false, canViewPrices:false },
};

// ── Device / setup flags ──────────────────────────────────────────
function isAdminDevice()    { return localStorage.getItem(ADMIN_DEVICE_KEY) === 'true'; }
function markAsAdminDevice(){ localStorage.setItem(ADMIN_DEVICE_KEY, 'true'); }
function isSetupDone()      { return localStorage.getItem(SETUP_DONE_KEY) === 'true'; }
function getAdminEmail()    { return localStorage.getItem(ADMIN_EMAIL_KEY) || null; }
function hasPinConfigured() { return !!localStorage.getItem(ADMIN_PIN_HASH_KEY); }

// ── PIN hashing (SHA-256 via Web Crypto) ──────────────────────────
async function sha256(text) {
  const enc  = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function setAdminPin(pin) {
  if (!/^\d{6}$/.test(pin)) throw new Error('O PIN deve ter exatamente 6 dígitos numéricos');
  const hash = await sha256(PIN_SALT + ':' + pin);
  localStorage.setItem(ADMIN_PIN_HASH_KEY, hash);
}

async function verifyAdminPin(pin) {
  const stored = localStorage.getItem(ADMIN_PIN_HASH_KEY);
  if (!stored) return false;
  const hash = await sha256(PIN_SALT + ':' + pin);
  return hash === stored;
}

// PIN session: depois de verificado, libera o fluxo admin por 10 minutos
const PIN_SESSION_KEY = 'smm_pin_verified_at';
const PIN_SESSION_TTL = 10 * 60 * 1000;

function markPinVerified() { sessionStorage.setItem(PIN_SESSION_KEY, String(Date.now())); }
function isPinVerified() {
  const t = sessionStorage.getItem(PIN_SESSION_KEY);
  if (!t) return false;
  return (Date.now() - parseInt(t, 10)) < PIN_SESSION_TTL;
}
function clearPinVerified() { sessionStorage.removeItem(PIN_SESSION_KEY); }

// ── Users / Whitelist ─────────────────────────────────────────────
function getWhitelist()           { return JSON.parse(localStorage.getItem(WHITELIST_KEY) || '[]'); }
function saveWhitelist(l)         { localStorage.setItem(WHITELIST_KEY, JSON.stringify(l)); }
function getWhitelistEntry(email) { return getWhitelist().find(e=>e.email.toLowerCase()===email.toLowerCase())||null; }
function getUsers()               { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }
function saveUsers(u)             { localStorage.setItem(USERS_KEY, JSON.stringify(u)); }

// ── Session ───────────────────────────────────────────────────────
let _cu = null;

function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (!s) return null;
    if (Date.now() - s.loginAt > 8 * 3600 * 1000) {
      localStorage.removeItem(AUTH_KEY); return null;
    }
    return s;
  } catch { return null; }
}

function saveSession(user) {
  if (!isAdminDevice() && user.role === 'admin') user.role = 'gestor';
  localStorage.setItem(AUTH_KEY, JSON.stringify({ ...user, loginAt: Date.now() }));
  _cu = user;
}

function logout() {
  localStorage.removeItem(AUTH_KEY);
  clearPinVerified();
  _cu = null;
  window.location.href = 'index.html';
}

function getCurrentUser() {
  if (_cu) return _cu;
  const s = getSession();
  if (!s) return null;
  if (isAdminDevice()) {
    const fresh = getUsers().find(u => u.id === s.id);
    if (fresh) { _cu = {...s, role:fresh.role, active:fresh.active}; return _cu; }
  }
  if (!isAdminDevice() && s.role === 'admin') {
    localStorage.removeItem(AUTH_KEY); return null;
  }
  _cu = s; return s;
}

function can(p)         { const u = getCurrentUser(); return u ? !!(ROLES[u.role]||{})[p] : false; }
function hasModule(mod) { const u = getCurrentUser(); return u ? (ROLES[u.role]?.modules||[]).includes(mod) : false; }

// ── HMAC-SHA256 (para tokens de usuário) ──────────────────────────
async function hmacSign(msg, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function hmacVerify(msg, secret, sig) {
  return (await hmacSign(msg, secret)) === sig;
}

// ── Token de usuário ───────────────────────────────────────────────
async function generateAccessToken(email, role, name) {
  const clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) throw new Error('Client ID não configurado');
  const safeRole = (role === 'admin') ? 'gestor' : role;
  const payload  = JSON.stringify({ email, role:safeRole, name, clientId, issuedAt:Date.now(), v:2 });
  const b64      = btoa(unescape(encodeURIComponent(payload)));
  const sig      = await hmacSign(b64, clientId);
  return `${b64}.${sig}`;
}

async function verifyAndDecodeToken(token) {
  if (!token || typeof token !== 'string') throw new Error('Token inválido');
  const parts = token.trim().split('.');
  if (parts.length !== 2) throw new Error('Formato inválido');
  const [b64, sig] = parts;
  let payload;
  try { payload = JSON.parse(decodeURIComponent(escape(atob(b64)))); }
  catch { throw new Error('Token corrompido'); }
  if (!payload.email || !payload.clientId || !payload.role)
    throw new Error('Token incompleto — solicite novo ao admin');
  const valid = await hmacVerify(b64, payload.clientId, sig);
  if (!valid) throw new Error('Token inválido ou adulterado');
  if (Date.now() - payload.issuedAt > 30*24*3600*1000)
    throw new Error('Token expirado — solicite novo ao admin');
  if (payload.role === 'admin') payload.role = 'gestor';
  return payload;
}

function getStoredAccessToken() { return localStorage.getItem(USER_TOKEN_KEY) || null; }
function saveAccessToken(t)     { localStorage.setItem(USER_TOKEN_KEY, t); }

// ── Client ID resolution ──────────────────────────────────────────
function resolveClientId() {
  if (isAdminDevice()) return localStorage.getItem(CLIENT_ID_KEY) || null;
  const hasCid  = !!localStorage.getItem(CLIENT_ID_KEY);
  const hasUCid = !!localStorage.getItem(USER_CID_KEY);
  // Admin-intent device: só usa CLIENT_ID se o PIN já foi verificado nesta sessão
  if (hasCid && !hasUCid && isPinVerified()) return localStorage.getItem(CLIENT_ID_KEY);
  return localStorage.getItem(USER_CID_KEY) || null;
}

// ── Google OAuth ──────────────────────────────────────────────────
function startGoogleLogin() {
  const cid = resolveClientId();
  if (!cid) {
    if (typeof showToast === 'function') showToast('Verificação necessária antes de continuar');
    return;
  }
  const base = location.origin + location.pathname.replace(/\/[^/]*$/, '/');
  const params = new URLSearchParams({
    client_id: cid,
    redirect_uri: base + 'auth-callback.html',
    response_type: 'token',
    scope: 'openid email profile',
    include_granted_scopes: 'true',
  });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

async function fetchGoogleProfile(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo',
    {headers:{Authorization:`Bearer ${token}`}});
  if (!res.ok) throw new Error('Falha ao verificar conta Google');
  return res.json();
}

// ── Login ─────────────────────────────────────────────────────────
async function loginWithGoogleToken(googleToken) {
  const profile     = await fetchGoogleProfile(googleToken);
  const hasAdminCid = !!localStorage.getItem(CLIENT_ID_KEY);
  const hasUserCid  = !!localStorage.getItem(USER_CID_KEY);

  // ── ADMIN FLOW: requer CLIENT_ID + PIN verificado nesta sessão ──
  if (hasAdminCid && !hasUserCid) {

    // Camada extra de segurança: SEM PIN verificado, bloqueia tudo.
    // Isso é redundante com resolveClientId(), mas garante blindagem
    // mesmo que o fluxo de OAuth seja iniciado por outro caminho.
    if (!isPinVerified()) {
      throw new Error(
        'PIN de administrador não verificado nesta sessão.\n' +
        'Volte ao painel e informe o PIN antes de autenticar.'
      );
    }

    const users = getUsers();

    // CASE A: primeiro setup — só ocorre se PIN acabou de ser criado
    // (isSetupDone()=false) E o hash do PIN já existe (foi definido agora)
    if (!isSetupDone() && !getAdminEmail() && hasPinConfigured()) {
      const admin = {
        id: profile.sub, email: profile.email, name: profile.name,
        picture: profile.picture, role: 'admin', createdAt: Date.now(), active: true,
      };
      saveUsers([admin]);
      localStorage.setItem(ADMIN_EMAIL_KEY, profile.email.toLowerCase());
      localStorage.setItem(SETUP_DONE_KEY, 'true');
      markAsAdminDevice();
      saveSession(admin);
      clearPinVerified();
      return admin;
    }

    // CASE B: setup já feito — verifica e-mail do admin master
    const adminEmail = getAdminEmail();
    if (!adminEmail) {
      throw new Error(
        'Configuração incompleta neste dispositivo.\n' +
        'Importe a configuração do dispositivo original.'
      );
    }
    if (profile.email.toLowerCase() !== adminEmail.toLowerCase()) {
      throw new Error(
        'Esta conta Google não é o Administrador Master.\n' +
        'Use a tela de login normal com seu token de acesso.'
      );
    }

    const users2 = getUsers();
    let user = users2.find(u => u.email === profile.email);
    if (!user) {
      user = { id: profile.sub, email: profile.email, name: profile.name,
               picture: profile.picture, role: 'admin', createdAt: Date.now(), active: true };
      users2.push(user);
    } else {
      if (!user.active) throw new Error('Conta desativada.');
    }
    user.name = profile.name; user.picture = profile.picture; user.lastLogin = Date.now();
    saveUsers(users2);
    markAsAdminDevice();
    saveSession(user);
    clearPinVerified();
    return user;
  }

  // ── USER FLOW ─────────────────────────────────────────────────
  const storedToken = getStoredAccessToken();
  if (!storedToken) throw new Error(
    'Token de acesso não encontrado.\n' +
    'Solicite seu token pessoal ao administrador.'
  );
  const payload = await verifyAndDecodeToken(storedToken);
  if (payload.email.toLowerCase() !== profile.email.toLowerCase()) throw new Error(
    `Conta incorreta para este token.\n` +
    `Token autoriza: ${payload.email}\n` +
    `Conta usada: ${profile.email}\n\n` +
    `Use a conta Google correta ou solicite novo token.`
  );
  const user = {
    id: profile.sub, email: profile.email,
    name: payload.name || profile.name,
    picture: profile.picture,
    role: payload.role,
    active: true,
    loginAt: Date.now(),
  };
  saveSession(user);
  return user;
}

// ── Machine DB ────────────────────────────────────────────────────
function getEffDB() {
  const c = localStorage.getItem(DB_KEY);
  if (c) { try { return JSON.parse(c); } catch {} }
  return typeof MACHINE_DB !== 'undefined' ? MACHINE_DB : {};
}
