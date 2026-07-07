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
  admin:       { label:'Administrador', icon:'👑', color:'#7c3aed',
                 modules:['chamados','registro','orcamento','relatorios','admin','preventiva','contratos','patrimonio'],
                 canCreate:true, canEdit:true, canDelete:true, canViewPrices:true,
                 canApprove:true, canManageUsers:true },

  diretor:     { label:'Diretor',       icon:'🏢', color:'#0369a1',
                 modules:['chamados','registro','orcamento','relatorios','preventiva','contratos','patrimonio'],
                 canCreate:true, canEdit:true, canDelete:true, canViewPrices:true,
                 canApprove:true, canManageUsers:false },

  supervisor:  { label:'Supervisor',    icon:'📌', color:'#0891b2',
                 modules:['chamados','registro','relatorios','preventiva','contratos','patrimonio'],
                 canCreate:true, canEdit:true, canDelete:false, canViewPrices:true,
                 canApprove:true, canManageUsers:false },

  gestor:      { label:'Gestor',        icon:'📊', color:'#0284c7',
                 modules:['chamados','registro','orcamento','relatorios','preventiva','contratos','patrimonio'],
                 canCreate:false, canEdit:false, canDelete:false, canViewPrices:true,
                 canApprove:false, canManageUsers:false },

  tecnico:     { label:'Técnico',       icon:'🔧', color:'#059669',
                 modules:['chamados','registro','preventiva','patrimonio'],
                 canCreate:true, canEdit:true, canDelete:false, canViewPrices:false,
                 canApprove:false, canManageUsers:false },

  solicitante: { label:'Solicitante',   icon:'📋', color:'#d97706',
                 modules:['chamados'],
                 canCreate:true, canEdit:false, canDelete:false, canViewPrices:false,
                 canApprove:false, canManageUsers:false },
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

async function logout() {
  try { await DB.logout(); } catch(e) {}
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
  updateChamadoStatus: (id, status) => API.patch(`/chamados/${id}/status`, { status }),
  updateOrcamentoStatus: (id, status) => API.patch(`/orcamentos/${id}/status`, { status }),
  delete:    (col, id) => API.delete(`/${col}/${id}`),

  // Usuários e whitelist
  getUsers:           () => API.get('/users'),
  updateUserRole:     (id, role)  => API.patch(`/users/${id}/role`, { role }),
  deactivateUser:     id          => API.delete(`/users/${id}`),
  getWhitelist:       ()          => API.get('/whitelist'),
  addWhitelist:       (e,r,n,c)   => API.post('/whitelist', { email:e, role:r, name:n, contract:c||null }),
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
  iniciarOrdem:       id    => API.patch(`/ordens-servico/${id}/iniciar`, {}),
  concluirOrdem:      (id, registroId) => API.patch(`/ordens-servico/${id}/concluir`, { registroId }),

  // Machine DB
  getMachineDB:       ()    => API.get('/machine-db'),
  saveMachineDB:      data  => API.post('/machine-db', { machineDb:data }),

  // Config e stats
  getConfig:          ()    => API.get('/config'),
  saveConfig:         cfg   => API.post('/config', { config:cfg }),
  getPrestadoraConfig:()    => API.get('/config/prestadora'),
  getStats:           ()    => API.get('/stats'),
  ping:               ()    => API.get('/../ping').then(()=>true).catch(()=>false),

  // Auditoria formal
  getAuditLog:        (filters={}) => API.get('/audit?' + new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,v])=>v))).toString()),
  getAuditSummary:    ()           => API.get('/audit/summary'),
  getExpiredAccess:   (days=90)    => API.get(`/audit/expired-access?days=${days}`),
  revokeUserSession:  (userId)     => API.delete(`/users/${userId}/session`),
  logout:             ()           => API.post('/auth/logout', {}),

  // Assinaturas digitais
  sign:         (recordId, action, module) => API.post('/sign', { recordId, action, module }),
  getSignatures:(recordId)                 => API.get(`/sign/${recordId}`),

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
  // 1. Cache
  if (_machineDBCache) return _machineDBCache;

  // 2. Constrói mapa contrato→equipamentos a partir de smm_contracts (fonte principal)
  let db = {};
  try {
    const contracts = JSON.parse(localStorage.getItem('smm_contracts') || '[]');
    contracts.forEach(c => {
      if (c.numero && Array.isArray(c.equipamentos)) {
        db[c.numero] = c.equipamentos;
      }
    });
  } catch(e) {}

  // 3. Se ainda vazio, tenta smm_custom_db (compatibilidade)
  if (Object.keys(db).length === 0) {
    const c = localStorage.getItem('smm_custom_db');
    if (c) try { db = JSON.parse(c); } catch {}
  }

  // 4. Fallback final: MACHINE_DB global (mock)
  if (Object.keys(db).length === 0) {
    db = typeof MACHINE_DB !== 'undefined' ? MACHINE_DB : {};
  }

  return db;
}

// ── Assinaturas digitais ──────────────────────────────────────────
const SIG_ICONS = {
  criado:    '✅',
  editado:   '✏️',
  aprovado:  '✔️',
  rejeitado: '✕',
  executado: '⚙️',
  concluido: '🏁',
  gerado:    '📋',
  excluido:  '🗑️',
};

const SIG_ROLES = {
  admin:'Administrador', gestor:'Gestor',
  tecnico:'Técnico', solicitante:'Solicitante',
};

// Assina um registro e retorna a assinatura (para inserir no objeto antes de salvar)
async function signRecord(recordId, action, module) {
  try {
    return await DB.sign(recordId, action, module);
  } catch(e) {
    // Fallback local se backend offline
    const user = getCurrentUser();
    const ts   = Date.now();
    return {
      recordId, module, action,
      by:   user?.name  || '?',
      role: user?.role  || '?',
      email:user?.email || '?',
      at:   ts,
      hash: Math.random().toString(36).slice(2,8),
      offline: true,
    };
  }
}

// Renderiza linha de assinaturas para exibir no card
function renderSignatures(sigs) {
  if (!sigs || !sigs.length) return '';
  return '<div class="sig-trail">' +
    sigs.map(s => {
      const icon = SIG_ICONS[s.action] || '•';
      const role = SIG_ROLES[s.role]   || s.role;
      const dt   = new Date(s.at).toLocaleString('pt-BR',
        {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      const hash = (s.hash||'').slice(0,6);
      return `<span class="sig-entry">${icon} <strong>${s.by_name||s.by}</strong> · ${role} · ${dt} <code class="sig-hash">[${hash}]</code></span>`;
    }).join('<span class="sig-sep">|</span>') +
  '</div>';
}

// Carrega e exibe assinaturas no elemento informado
async function loadAndRenderSigs(recordId, containerEl) {
  if (!containerEl) return;
  try {
    const sigs = await DB.getSignatures(recordId);
    containerEl.innerHTML = renderSignatures(sigs);
  } catch(e) {
    containerEl.innerHTML = '';
  }
}
