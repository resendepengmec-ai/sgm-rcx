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

// ── V03: fonte de imagem segura ───────────────────────────────────
// O sistema interpolava `<img src="${p.dataUrl}">` por concatenação. Um
// dataUrl gravado por outro usuário podia conter  x" onerror="..."  e
// executar script na sessão de quem abrisse o registro.
//
// Uma data-URL de imagem legítima NÃO contém aspas, < nem >. Validar o
// formato fecha a quebra do atributo src E a da string do onclick de uma
// vez. O servidor já recusa dataUrl inválida (validate.js), mas registros
// gravados ANTES da correção podem trazer conteúdo malicioso do banco —
// por isso a checagem também vive aqui.
const _RE_IMG = /^data:image\/(png|jpe?g|webp|gif|bmp|hei[cf]|avif|tiff?);base64,[A-Za-z0-9+/]+={0,2}$/i;
function imgSrc(dataUrl) { return _RE_IMG.test(String(dataUrl || '')) ? dataUrl : ''; }
window.imgSrc = imgSrc;

// Monta uma miniatura por DOM em vez de string: atribuir a PROPRIEDADE
// .src nunca injeta HTML, seja qual for o conteúdo.
function thumbImg(dataUrl, { alt = 'foto', style = '', onClick = null } = {}) {
  const img = document.createElement('img');
  img.src = imgSrc(dataUrl);
  img.alt = alt;
  if (style) img.style.cssText = style;
  if (onClick) img.addEventListener('click', onClick);
  return img;
}
window.thumbImg = thumbImg;

// Escapa texto de usuário antes de inserir em innerHTML — sem isso, um nome,
// descrição ou observação contendo tags/script poderia rodar código na tela
// de outra pessoa que visualizasse aquele dado (XSS armazenado).
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ROLES = {
  // Papel da PLATAFORMA (dono do Client ID Google). Fica acima do admin:
  // cadastra as empresas prestadoras assinantes e enxerga todas elas.
  // Os papéis abaixo são internos a UMA empresa e não mudaram.
  superadmin:  { label:'Plataforma',    icon:'🛰️', color:'#be123c',
                 modules:['chamados','registro','orcamento','relatorios','laudo','admin','preventiva','contratos','patrimonio','saas'],
                 canCreate:true, canEdit:true, canDelete:true, canViewPrices:true,
                 canApprove:true, canManageUsers:true, canManageEmpresas:true },

  admin:       { label:'Administrador', icon:'👑', color:'#7c3aed',
                 modules:['chamados','registro','orcamento','relatorios','laudo','admin','preventiva','contratos','patrimonio'],
                 canCreate:true, canEdit:true, canDelete:true, canViewPrices:true,
                 canApprove:true, canManageUsers:true },

  diretor:     { label:'Diretor',       icon:'🏢', color:'#0369a1',
                 modules:['chamados','registro','orcamento','relatorios','laudo','admin','preventiva','contratos','patrimonio'],
                 canCreate:true, canEdit:true, canDelete:true, canViewPrices:true,
                 canApprove:true, canManageUsers:false },

  supervisor:  { label:'Supervisor',    icon:'📌', color:'#0891b2',
                 modules:['chamados','registro','orcamento','relatorios','laudo','preventiva','contratos','patrimonio'],
                 canCreate:true, canEdit:true, canDelete:true, canViewPrices:true,
                 canApprove:true, canManageUsers:false },

  gestor:      { label:'Gestor',        icon:'📊', color:'#0284c7',
                 modules:['chamados','registro','orcamento','relatorios','laudo','preventiva','contratos','patrimonio'],
                 canCreate:false, canEdit:false, canDelete:false, canViewPrices:false,
                 canApprove:false, canManageUsers:false },

  tecnico:     { label:'Técnico',       icon:'🔧', color:'#059669',
                 modules:['chamados','registro','orcamento','relatorios','preventiva','contratos','patrimonio'],
                 canCreate:true, canEdit:false, canDelete:false, canViewPrices:false,
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
  // Timeout: em rede de campo instável, o fetch pode travar sem resolver
  // nem rejeitar. O AbortController garante que a chamada sempre termina.
  const ctrl = new AbortController();
  // 60s serve para tudo, MENOS leitura de PDF por IA: um pedido com muitas
  // páginas leva mais que isso, e abortar no meio desperdiça uma chamada
  // paga que já estava quase pronta. Só esta rota tem folga maior.
  const TIMEOUT_MS = path.startsWith('/orcamentos/importar-pdf') ? 180000 : 60000;
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${SMM_API_URL}/api${path}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch(e) {
    if (e.name === 'AbortError')
      throw new Error('Tempo esgotado ao falar com o servidor. Verifique a conexão e tente de novo.');
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
  } finally {
    clearTimeout(timer);
  }
  let json;
  try {
    json = await res.json();
  } catch(e) {
    // O servidor não devolveu JSON (erro interno, instabilidade do
    // serviço, etc.) — mensagem clara em vez do erro de parse cru.
    throw new Error(`O servidor não respondeu corretamente (status ${res.status}). Tente novamente em instantes.`);
  }
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

// Busca o papel/contrato atuais no servidor e atualiza a sessão em memória,
// sem exigir logout — o token (JWT) guarda o papel/contrato só do momento
// do login, e o backend já revalida a cada chamada, mas a TELA (menus,
// filtros por contrato) usava o valor congelado do token até isso existir.
// ── V13: guarda de página com confirmação no servidor ─────────────
// As guardas de cada página liam o JWT com _decodeJWT (atob puro, SEM
// verificar assinatura). Bastava editar sessionStorage com um token
// montado à mão para desbloquear a interface inteira, inclusive o painel
// admin. Isoladamente isso é cosmético — o requireAuth do backend relê o
// papel do banco — mas era o multiplicador das rotas que não checavam
// papel no servidor (corrigidas em V05/V06/V07/V21/V22).
//
// Uso nas páginas:  guardaDeModulo('registro').then(u => { if (u) iniciar(u); });
async function guardaDeModulo(modulo, destino = 'index.html') {
  const local = getCurrentUser();
  if (!local) { window.location.href = destino; return null; }
  let u = local;
  try {
    const servidor = await refreshCurrentUser();   // GET /auth/me
    if (servidor) u = servidor;
    // Se a rede falhar, segue com o papel local: o servidor continua
    // sendo a barreira real em cada chamada de API.
  } catch (e) { /* rede instável em campo — não bloqueia a tela */ }
  if (!u || !(ROLES[u.role]?.modules || []).includes(modulo)) {
    window.location.href = destino; return null;
  }
  return u;
}
window.guardaDeModulo = guardaDeModulo;

// ── SaaS: empresas (tenant) ───────────────────────────────────────
const Empresas = {
  listar:    ()        => API.get('/empresas'),
  obter:     (id)      => API.get('/empresas/' + encodeURIComponent(id)),
  criar:     (empresa) => API.post('/empresas', { empresa }),
  atualizar: (id, e)   => API.post('/empresas/' + encodeURIComponent(id), { empresa: e }),
  status:    (id, ativa) => API.post('/empresas/' + encodeURIComponent(id) + '/status', { ativa }),
  vincular:  (id, email) => API.post('/empresas/' + encodeURIComponent(id) + '/vincular', { email }),
};
window.Empresas = Empresas;

// ── Matriz CRUD por contrato ──────────────────────────────────────
// O admin da empresa ajusta, contrato a contrato, o que cada papel faz
// em cada recurso. O servidor recorta pelo TETO — a tela desabilita o que
// não pode ser marcado, mas quem decide é sempre o backend.
const Permissoes = {
  obter: (contrato) =>
    API.get('/contratos/' + encodeURIComponent(contrato) + '/permissoes'),
  salvar: (contrato, matriz) =>
    API.post('/contratos/' + encodeURIComponent(contrato) + '/permissoes', { matriz }),
  restaurar: (contrato) =>
    API.delete('/contratos/' + encodeURIComponent(contrato) + '/permissoes'),
};
window.Permissoes = Permissoes;

// Permissão efetiva do usuário ATUAL naquele contrato, para a tela
// esconder o que o servidor recusaria. `contrato` é o objeto vindo de
// DB.getContratos(), que já traz `_permissoes` calculado pelo servidor.
function podeNoContrato(contrato, recurso, acao) {
  const u = getCurrentUser();
  if (!u) return false;
  if (u.role === 'superadmin' || u.role === 'admin') return true;
  const p = contrato && contrato._permissoes;
  // Contrato sem a informação (cache antigo, ou tela que não carregou a
  // lista): não bloqueia a UI — o servidor continua sendo a barreira.
  if (!p || !p[recurso]) return true;
  return p[recurso].includes(acao);
}
window.podeNoContrato = podeNoContrato;

// ── Checklists de preventiva por tipo de equipamento ──────────────
// Os templates vivem no CONTRATO. Um plano já criado NÃO é afetado por
// edições posteriores: ele carrega o próprio snapshot congelado.
const Checklists = {
  listar: (contrato) =>
    API.get('/contratos/' + encodeURIComponent(contrato) + '/checklists'),
  salvar: (contrato, checklist) =>
    API.post('/contratos/' + encodeURIComponent(contrato) + '/checklists', { checklist }),
  remover: (contrato, chave) =>
    API.delete('/contratos/' + encodeURIComponent(contrato) + '/checklists/' + encodeURIComponent(chave)),
  gerarIA: (contrato, tipo, observacao) =>
    API.post('/contratos/' + encodeURIComponent(contrato) + '/checklists/gerar',
             { tipo, observacao }),
};
window.Checklists = Checklists;

// Itens que valem para um equipamento dentro de um plano. Usa o SNAPSHOT
// congelado no plano; se o plano for anterior a esta versão, cai no
// checklist padrão — nenhum plano antigo fica sem lista.
function checklistDoEquipamento(plano, equipamento, nivel) {
  const chave = chaveTipoEquip(equipamento?.tipo);
  const snap  = plano?.checklistSnapshot?.[chave]
             || plano?.checklistSnapshot?.['sem-tipo'];
  const itens = snap?.itens;
  if (!itens) return null;                       // chamador usa CHECKLIST padrão
  const n = Math.min(3, Math.max(1, parseInt(nivel, 10) || 1));
  const out = [];
  for (let i = 1; i <= n; i++) out.push(...(itens[i] || []));
  return out;
}
// Mesma normalização do backend (checklists.js): "Split Hi-Wall",
// "split hi wall" e "SPLIT HI-WALL" precisam bater na mesma chave.
function chaveTipoEquip(tipo) {
  const t = String(tipo || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t || 'sem-tipo';
}
window.checklistDoEquipamento = checklistDoEquipamento;
window.chaveTipoEquip = chaveTipoEquip;

async function refreshCurrentUser() {
  try {
    const fresh = await API.get('/auth/me');
    if (fresh && _currentUser) {
      _currentUser = { ..._currentUser, role: fresh.role, contract: fresh.contract, active: fresh.active };
    }
    return _currentUser;
  } catch(e) { return _currentUser; }
}

// V20: o logout removia APENAS o token. Ficavam no localStorage os
// contratos (com preços e documentos), os registros com fotos, a lista de
// chamados, o cache de usuários e a whitelist inteira — com e-mails e
// papéis de toda a equipe. Em tablet compartilhado entre técnicos, cenário
// comum em campo, o próximo usuário lia tudo pelo DevTools.
//
// `smm_api_url` e `smm_client_id` são preservados: são configuração do
// dispositivo, não dado de usuário.
const CACHES_DE_SESSAO = [
  'smm_contracts', 'chamados_list', 'registro_records', 'prev_plans',
  'orcamento_quotes', 'smm_movimentacoes', 'smm_ordens_servico',
  'smm_users_cache', 'smm_whitelist_cache', 'smm_custom_db', 'smm_user_cid',
  'smm_responsaveis', 'smm_laudos', 'smm_prestadora',
];
function limparCachesLocais() {
  CACHES_DE_SESSAO.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
  try {
    Object.keys(localStorage)
      .filter(k => k.endsWith('_settings') || k.startsWith('smm_cache_'))
      .forEach(k => localStorage.removeItem(k));
  } catch(e) {}
}
window.limparCachesLocais = limparCachesLocais;

async function logout() {
  try { await DB.logout(); } catch(e) {}
  sessionStorage.removeItem(SESSION_KEY);
  limparCachesLocais();                 // V20
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
  // ── O Client ID vem SEMPRE do servidor ───────────────────────────
  // O cache local é apenas fallback para rede indisponível — nunca a
  // fonte de verdade.
  //
  // Por que mudou: antes o cache era permanente ("se já existe, não
  // busca"). Isso era inofensivo enquanto o backend não validava o
  // audience do token. Com V01 corrigido, um Client ID antigo em cache
  // faria o Google emitir um token com `aud` errado e o servidor
  // recusaria o login — travando o usuário fora do sistema sem forma
  // óbvia de limpar (smm_client_id é preservado no logout de propósito,
  // justamente para servir de fallback offline).
  //
  // Trocar o Client ID no painel admin agora se propaga sozinho no
  // próximo login de cada dispositivo.
  let clientId = null;
  try {
    const res  = await fetch(`${SMM_API_URL}/api/auth/config/public`);
    const json = await res.json();
    if (json.ok && json.data.clientId) {
      clientId = json.data.clientId;
      localStorage.setItem(CLIENT_ID_KEY, clientId);
    }
  } catch(e) {
    // Rede fora: usa o último valor conhecido em vez de impedir o login.
    clientId = localStorage.getItem(CLIENT_ID_KEY);
  }
  if (!clientId) clientId = localStorage.getItem(CLIENT_ID_KEY);
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


const MS_CLIENT_ID_KEY = 'smm_ms_client_id';

async function loginWithMicrosoftToken(microsoftToken) {
  const data = await API.post('/auth/microsoft', { microsoftToken });
  saveSession(data.token, data.user);
  return data.user;
}

async function startMicrosoftLogin() {
  let msClientId = localStorage.getItem(MS_CLIENT_ID_KEY);
  if (!msClientId) {
    try {
      const res  = await fetch(`${SMM_API_URL}/api/auth/config/public`);
      const json = await res.json();
      if (json.ok && json.data.microsoftClientId) {
        msClientId = json.data.microsoftClientId;
        localStorage.setItem(MS_CLIENT_ID_KEY, msClientId);
      }
    } catch(e) {}
  }
  if (!msClientId) {
    if (typeof showToast === 'function') showToast('Login Microsoft nao configurado. Contate o administrador.');
    return;
  }
  const base  = location.origin + location.pathname.replace(/\/[^/]*$/, '/');
  const redir = base + 'auth-callback.html';
  // /common cobre contas pessoais (Hotmail/Outlook) e workspace (M365).
  // Fluxo implicito (token no fragmento), igual ao do Google. O state=ms
  // avisa o auth-callback qual provedor validar.
  const params = new URLSearchParams({
    client_id:     msClientId,
    response_type: 'token',
    redirect_uri:  redir,
    scope:         'User.Read',
    response_mode: 'fragment',
    prompt:        'select_account',
    state:         'ms',
  });
  window.location.href = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + params;
}

// Carrega Client IDs (Google e Microsoft) do backend silenciosamente ao iniciar
async function loadClientIdFromBackend() {
  // Sem atalho por cache: mantém o valor local alinhado ao do servidor.
  try {
    const res  = await fetch(`${SMM_API_URL}/api/auth/config/public`);
    const json = await res.json();
    if (json.ok && json.data) {
      if (json.data.clientId)          localStorage.setItem(CLIENT_ID_KEY, json.data.clientId);
      if (json.data.microsoftClientId) localStorage.setItem(MS_CLIENT_ID_KEY, json.data.microsoftClientId);
    }
  } catch(e) {}
}
// Executa ao carregar o script
loadClientIdFromBackend();

// Contato do admin (WhatsApp/e-mail) para quem não tem acesso pedir cadastro.
// Vem da rota PÚBLICA de config — não exige login. Cacheado em memória para
// não repetir a chamada. Retorna { whatsapp, email, nome } (campos podem vir
// vazios se o admin ainda não cadastrou).
let _adminContactCache = null;
async function getAdminContact() {
  if (_adminContactCache) return _adminContactCache;
  try {
    const res  = await fetch(`${SMM_API_URL}/api/auth/config/public`);
    const json = await res.json();
    if (json.ok && json.data && json.data.contact) {
      _adminContactCache = json.data.contact;
      return _adminContactCache;
    }
  } catch(e) {}
  return { whatsapp:'', email:'', nome:'' };
}

// ── Data API ──────────────────────────────────────────────────────
const DB = {
  // Coleções
  getAll:    col       => API.get(`/${col}`),
  save:      (col, r)  => API.post(`/${col}`, { record:r }),
  updateChamadoStatus: (id, status) => API.patch(`/chamados/${id}/status`, { status }),

  // Importação de pedido de orçamento em PDF. O servidor lê o arquivo com
  // IA e devolve um RASCUNHO conciliado com o catálogo do contrato — nada
  // é gravado nesta chamada.
  importarPedidoPdf: (contrato, pdf, respostas) =>
    API.post('/orcamentos/importar-pdf', { contrato, pdf, respostas }),
  updateOrcamentoStatus: (id, status) => API.patch(`/orcamentos/${id}/status`, { status }),
  delete:    (col, id) => API.delete(`/${col}/${id}`),

  // Usuários e whitelist
  getUsers:           () => API.get('/users'),
  getTechnicians:     () => API.get('/technicians'),
  updateUserRole:     (id, role)  => API.patch(`/users/${id}/role`, { role }),
  setUserActive:      (id, active) => API.patch(`/users/${id}/active`, { active }),
  deactivateUser:     id          => API.delete(`/users/${id}`),
  getWhitelist:       ()          => API.get('/whitelist'),
  addWhitelist:       (e,r,n,c)   => API.post('/whitelist', { email:e, role:r, name:n, contract:c||null }),
  removeWhitelist:    email       => API.delete(`/whitelist/${encodeURIComponent(email)}`),

  // Contratos
  getContratos:       ()    => API.get('/contratos'),
  saveContrato:       c     => API.post('/contratos', { contrato:c }),
  deleteContrato:     id    => API.delete(`/contratos/${id}`),

  // Responsáveis de estabelecimento (whitelist p/ assinatura do cliente)
  getResponsaveis:    ()    => API.get('/responsaveis'),
  saveResponsavel:    r     => API.post('/responsaveis', r),
  deleteResponsavel:  id    => API.delete(`/responsaveis/${id}`),

  // Assinatura do cliente por estabelecimento
  solicitarAssinaturaCliente: p  => API.post('/assinatura-cliente/solicitar', p),
  assinaturasPendentes:       () => API.get('/assinatura-cliente/pendentes'),
  aprovarAssinatura:          id => API.post(`/assinatura-cliente/${id}/aprovar`, {}),
  rejeitarAssinatura:  (id,motivo) => API.post(`/assinatura-cliente/${id}/rejeitar`, { motivo }),

  // Laudos / relatórios de vistoria
  gerarLaudoTexto:    p     => API.post('/laudo/gerar-texto', p),
  getLaudos:          ()    => API.get('/laudos'),
  getLaudo:           id    => API.get(`/laudos/${id}`),
  saveLaudo:          l     => API.post('/laudos', { laudo:l }),
  deleteLaudo:        id    => API.delete(`/laudos/${id}`),

  // Movimentações
  getMovimentacoes:   ()    => API.get('/movimentacoes'),
  saveMovimentacao:   m     => API.post('/movimentacoes', { movimentacao:m }),
  deleteMovimentacao: id    => API.delete(`/movimentacoes/${id}`),
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
  getAdminContact:    ()    => API.get('/auth/admin-contact'),
  saveAdminContact:   c     => API.post('/auth/admin-contact', c),
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
  verifySignatures:(recordId)              => API.get(`/sign/${recordId}/verify`),

  // Técnico dono/atribuído anexa foto (assinada) a um registro já criado
  addRegistroFoto: (id, photo) => API.post(`/registros/${id}/foto`, { photo }),

  // Upload incremental de UMA foto de preventiva (por equipamento), sem
  // reenviar o plano inteiro
  addPreventivaFoto: (id, ei, photo) => API.post(`/preventiva/${id}/equip/${ei}/foto`, { photo }),

  // Remoção incremental e determinística de UMA foto de preventiva
  delPreventivaFoto: (id, ei, photoId) => API.delete(`/preventiva/${id}/equip/${ei}/foto/${encodeURIComponent(photoId)}`),

};

// ── Machine DB local fallback ──────────────────────────────────────
// Usado pelos módulos que ainda precisam acesso síncrono às TAGs
let _machineDBCache = null;
async function loadMachineDB() {
  try { _machineDBCache = await DB.getMachineDB(); }
  catch(e) {
    const c = localStorage.getItem('smm_custom_db');
    _machineDBCache = c ? JSON.parse(c) : {};
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

  // 3. Se ainda vazio, tenta smm_custom_db (importação em lote via .xlsx no admin)
  if (Object.keys(db).length === 0) {
    const c = localStorage.getItem('smm_custom_db');
    if (c) try { db = JSON.parse(c); } catch {}
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
      // V11: `by_name` vem de signatures.by_name — que, para aceites de
      // cliente, é o nome do responsável digitado por um técnico em campo.
      // Era o vetor de XSS armazenado mais direto do sistema.
      return `<span class="sig-entry">${icon} <strong>${esc(s.by_name||s.by||'?')}</strong> · ${esc(role)} · ${esc(dt)} <code class="sig-hash">[${esc(hash)}]</code></span>`;
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
