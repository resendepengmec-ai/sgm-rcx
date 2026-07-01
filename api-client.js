// ── api-client.js v4 ──────────────────────────────────────────────
// Substitui o auth.js standalone. Toda lógica de dados vai para o backend.
// Configure SMM_API_URL antes de usar, ou deixe vazio para URL relativa.

const SMM_API_URL = (() => {
  // 1. Variável global (pode ser definida antes deste script)
  if (typeof window.SMM_API !== 'undefined') return window.SMM_API;
  // 2. localStorage (configurado pelo admin na primeira abertura)
  const stored = localStorage.getItem('smm_api_url');
  if (stored) return stored;
  // 3. Mesmo origin (quando frontend é servido pelo backend)
  return '';
})();

const SESSION_KEY = 'smm_jwt';

const ROLES = {
  admin:       { label:'Administrador', icon:'👑', color:'#7c3aed', modules:['chamados','registro','orcamento','relatorios','admin','preventiva','contratos','patrimonio'], canCreate:true, canEdit:true, canDelete:true, canViewPrices:true },
  gestor:      { label:'Gestor',        icon:'📊', color:'#0284c7', modules:['chamados','registro','orcamento','relatorios','preventiva','contratos','patrimonio'],         canCreate:false,canEdit:false,canDelete:false,canViewPrices:true },
  tecnico:     { label:'Técnico',       icon:'🔧', color:'#059669', modules:['chamados','registro','preventiva','patrimonio'],                                              canCreate:true, canEdit:true, canDelete:false,canViewPrices:false },
  solicitante: { label:'Solicitante',   icon:'📋', color:'#d97706', modules:['chamados'],                                                                                  canCreate:true, canEdit:false,canDelete:false,canViewPrices:false },
};

// ── HTTP client ───────────────────────────────────────────────────
async function _call(method, path, body) {
  const token   = sessionStorage.getItem(SESSION_KEY);
  const headers = { 'Content-Type':'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${SMM_API_URL}/api${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) {
    const e = new Error(json.error || `Erro ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return json.data;
}
const API = {
  get:    p     => _call('GET',    p),
  post:   (p,b) => _call('POST',   p, b),
  patch:  (p,b) => _call('PATCH',  p, b),
  delete: p     => _call('DELETE', p),
};

// ── Session ───────────────────────────────────────────────────────
let _currentUser = null;

function _decodeJWT(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (Date.now()/1000 > payload.exp) return null;
    return { id:payload.id, email:payload.email, role:payload.role,
             name:payload.name, picture:payload.picture };
  } catch { return null; }
}

function getCurrentUser() {
  if (_currentUser) return _currentUser;
  const token = sessionStorage.getItem(SESSION_KEY);
  if (!token) return null;
  _currentUser = _decodeJWT(token);
  return _currentUser;
}

function saveSession(token, user) {
  sessionStorage.setItem(SESSION_KEY, token);
  _currentUser = user;
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  _currentUser = null;
  window.location.href = 'index.html';
}

function can(p)         { const u=getCurrentUser(); return u ? !!(ROLES[u.role]||{})[p] : false; }
function hasModule(mod) { const u=getCurrentUser(); return u ? (ROLES[u.role]?.modules||[]).includes(mod) : false; }

// ── Google OAuth ──────────────────────────────────────────────────
// Client ID é configurado pelo admin e salvo no localStorage
const CLIENT_ID_KEY = 'smm_client_id';

async function loginWithGoogleToken(googleToken) {
  const data = await API.post('/auth/google', { googleToken });
  saveSession(data.token, data.user);
  return data.user;
}

async function startGoogleLogin() {
  // Get Client ID from cache or backend
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    try {
      const res  = await fetch(`${SMM_API_URL}/api/auth/config/public`);
      const json = await res.json();
      if (json.ok && json.data.clientId) {
        clientId = json.data.clientId;
        localStorage.setItem(CLIENT_ID_KEY, clientId);
      }
    } catch(e) {}
  }
  if (!clientId) {
    if (typeof showToast === 'function') showToast('Client ID nao disponivel. Contate o administrador.');
    return;
  }
  // Use standard OAuth2 implicit flow with token
  // Note: for new Google Cloud projects, ensure "Web application" type is selected
  // and the redirect URI is registered exactly as shown
  const base   = location.origin + location.pathname.replace(/\/[^/]*$/, '/');
  const redir  = base + 'auth-callback.html';
  const params = new URLSearchParams({
    client_id:              clientId,
    redirect_uri:           redir,
    response_type:          'token',
    scope:                  'openid email profile',
    include_granted_scopes: 'true',
    prompt:                 'select_account',
  });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}


// Carrega Client ID do backend silenciosamente ao iniciar
async function loadClientIdFromBackend() {
  if (localStorage.getItem(CLIENT_ID_KEY)) return; // já tem em cache
  try {
    const res  = await fetch(`${SMM_API_URL}/api/auth/config/public`);
    const json = await res.json();
    if (json.ok && json.data.clientId) {
      localStorage.setItem(CLIENT_ID_KEY, json.data.clientId);
    }
  } catch(e) {}
}
// Executa ao carregar o script
loadClientIdFromBackend();

// ── Data API ──────────────────────────────────────────────────────
const DB = {
  // Coleções
  getAll:    col       => API.get(`/${col}`),
  save:      (col, r)  => API.post(`/${col}`, { record:r }),
  delete:    (col, id) => API.delete(`/${col}/${id}`),

  // Usuários e whitelist
  getUsers:           () => API.get('/users'),
  updateUserRole:     (id, role)  => API.patch(`/users/${id}/role`, { role }),
  deactivateUser:     id          => API.delete(`/users/${id}`),
  getWhitelist:       ()          => API.get('/whitelist'),
  addWhitelist:       (e,r,n)     => API.post('/whitelist', { email:e, role:r, name:n }),
  removeWhitelist:    email       => API.delete(`/whitelist/${encodeURIComponent(email)}`),

  // Contratos
  getContratos:       ()    => API.get('/contratos'),
  saveContrato:       c     => API.post('/contratos', { contrato:c }),
  deleteContrato:     id    => API.delete(`/contratos/${id}`),

  // Movimentações
  getMovimentacoes:   ()    => API.get('/movimentacoes'),
  saveMovimentacao:   m     => API.post('/movimentacoes', { movimentacao:m }),
  updateMovStatus:    (id, status, motivoRejeicao) =>
                              API.patch(`/movimentacoes/${id}/status`, { status, motivoRejeicao }),

  // Ordens de serviço
  getOrdens:          ()    => API.get('/ordens-servico'),
  getOrdensByChamado: id    => API.get(`/ordens-servico/chamado/${id}`),
  saveOrdem:          o     => API.post('/ordens-servico', { ordem:o }),
  concluirOrdem:      (id, registroId) => API.patch(`/ordens-servico/${id}/concluir`, { registroId }),

  // Machine DB
  getMachineDB:       ()    => API.get('/machine-db'),
  saveMachineDB:      data  => API.post('/machine-db', { machineDb:data }),

  // Config e stats
  getConfig:          ()    => API.get('/config'),
  saveConfig:         cfg   => API.post('/config', { config:cfg }),
  getStats:           ()    => API.get('/stats'),
  ping:               ()    => API.get('/../ping').then(()=>true).catch(()=>false),
};

// ── Machine DB local fallback ──────────────────────────────────────
// Usado pelos módulos que ainda precisam acesso síncrono às TAGs
let _machineDBCache = null;
async function loadMachineDB() {
  try { _machineDBCache = await DB.getMachineDB(); }
  catch(e) {
    const c = localStorage.getItem('smm_custom_db');
    _machineDBCache = c ? JSON.parse(c) : (typeof MACHINE_DB!=='undefined' ? MACHINE_DB : {});
  }
  return _machineDBCache;
}
function getEffDB() {
  if (_machineDBCache) return _machineDBCache;
  const c = localStorage.getItem('smm_custom_db');
  if (c) try { return JSON.parse(c); } catch {}
  return typeof MACHINE_DB !== 'undefined' ? MACHINE_DB : {};
}
