// ── api-client.js v4 ──────────────────────────────────────────────
// Substitui o auth.js standalone. Toda lógica de dados vai para o backend.
// Configure SMM_API_URL antes de usar, ou deixe vazio para URL relativa.

// Cache local nunca é a fonte de verdade. Ele serve apenas como uma cópia
// auxiliar para abrir a tela mais rápido/offline e, por isso, toda leitura e
// escrita precisa ser tolerante a cache corrompido ou quota cheia. Em especial
// não guardamos fotos/documentos base64 no localStorage: no Safari/iOS isso
// esgota a quota e pode interromper o render da resposta recém-chegada do API.
function safeLocalStorageGet(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (_) { return fallback; }
}

function safeLocalStorageGetJSON(key, fallback) {
  const raw = safeLocalStorageGet(key, null);
  if (raw === null || raw === '') return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function _cacheSemBinarios(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    const out = value.map(item => _cacheSemBinarios(item, seen));
    seen.delete(value);
    return out;
  }
  const out = {};
  Object.keys(value).forEach(key => {
    const lower = key.toLowerCase();
    const item = value[key];
    // Campos usados pelos módulos para anexos/fotos/documentos e payloads
    // binários. Metadados (nome, hash, tipo, data) continuam no cache.
    if (['dataurl', 'data_url', 'base64', 'bytes'].includes(lower)) return;
    if (lower === 'data' && typeof item === 'string' && (item.length > 2048 || /^data:/i.test(item))) return;
    if (lower === 'content' && typeof item === 'string' && item.length > 2048) return;
    if ((lower === 'url' || lower === 'src') && typeof item === 'string' && /^data:/i.test(item)) return;
    out[key] = _cacheSemBinarios(item, seen);
  });
  seen.delete(value);
  return out;
}

function safeLocalStorageSet(key, value) {
  try { localStorage.setItem(key, String(value)); return true; }
  catch (_) {
    // Remove somente a entrada que falhou; nunca deixe uma exceção de cache
    // impedir a atualização em memória ou a persistência no servidor.
    try { localStorage.removeItem(key); } catch (_) {}
    return false;
  }
}

function safeLocalStorageSetJSON(key, value, { stripBinaries = false } = {}) {
  try {
    const payload = stripBinaries ? _cacheSemBinarios(value) : value;
    return safeLocalStorageSet(key, JSON.stringify(payload));
  } catch (_) { return false; }
}

window.safeLocalStorageGet = safeLocalStorageGet;
window.safeLocalStorageGetJSON = safeLocalStorageGetJSON;
window.safeLocalStorageSet = safeLocalStorageSet;
window.safeLocalStorageSetJSON = safeLocalStorageSetJSON;

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

// ── Estado padrão de ações assíncronas ─────────────────────────────
// Bloqueia cliques duplicados, sinaliza aria-busy e restaura o rótulo original.
function setActionBusy(button, busy, label = 'Enviando…') {
  const btn = typeof button === 'string' ? document.querySelector(button) : button;
  if (!btn) return () => {};
  if (!busy) {
    const original = btn.dataset.busyOriginalHtml;
    if (original !== undefined) btn.innerHTML = original;
    if (btn.dataset.busyOriginalDisabled !== undefined)
      btn.disabled = btn.dataset.busyOriginalDisabled === '1';
    delete btn.dataset.busyOriginalHtml;
    delete btn.dataset.busyOriginalDisabled;
    delete btn.dataset.busy;
    btn.removeAttribute('aria-busy');
    btn.classList.remove('is-busy');
    return () => {};
  }
  if (btn.dataset.busy === '1') return () => setActionBusy(btn, false);
  btn.dataset.busy = '1';
  btn.dataset.busyOriginalHtml = btn.innerHTML;
  btn.dataset.busyOriginalDisabled = btn.disabled ? '1' : '0';
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.classList.add('is-busy');
  btn.replaceChildren();
  const spinner = document.createElement('span');
  spinner.className = 'action-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = label;
  btn.append(spinner, text);
  return () => setActionBusy(btn, false);
}

async function withActionBusy(button, label, task) {
  const restore = setActionBusy(button, true, label);
  try { return await task(); } finally { restore(); }
}

// Estado visual e semântico de abas; preserva a classe legada active.
function setTabSelected(button, selected) {
  const btn = typeof button === 'string' ? document.querySelector(button) : button;
  if (!btn) return;
  btn.classList.toggle('active', !!selected);
  btn.setAttribute('aria-selected', selected ? 'true' : 'false');
  btn.tabIndex = selected ? 0 : -1;
}
window.setActionBusy = setActionBusy;
window.withActionBusy = withActionBusy;
window.setTabSelected = setTabSelected;
function selectTab(container, activeTab) {
  const root = typeof container === 'string' ? document.querySelector(container) : container;
  if (!root) return;
  root.querySelectorAll('[role="tab"], .tab, .stab, .filter-pill, .scope-tab, .admin-tab, .period-pill').forEach(btn => {
    const key = btn.dataset.tab || btn.dataset.value || btn.getAttribute('data-tab');
    const selected = key ? key === activeTab : false;
    // Abas legadas sem data-tab usam o texto/posição; as páginas novas passam
    // data-tab e obtêm seleção semântica completa.
    if (key) setTabSelected(btn, selected);
  });
}
window.selectTab = selectTab;
const ROLES = {
  admin:       { label:'Administrador', icon:'👑', color:'#7c3aed',
                 modules:['chamados','registro','orcamento','relatorios','laudo','admin','preventiva','contratos','patrimonio','dashboard'],
                 canCreate:true, canEdit:true, canDelete:true, canViewPrices:true,
                 canApprove:true, canManageUsers:true },

  diretor:     { label:'Diretor',       icon:'🏢', color:'#0369a1',
                 modules:['chamados','registro','orcamento','relatorios','laudo','preventiva','contratos','patrimonio','dashboard'],
                 canCreate:true, canEdit:true, canDelete:true, canViewPrices:true,
                 canApprove:true, canManageUsers:false },

  supervisor:  { label:'Supervisor',    icon:'📌', color:'#0891b2',
                 modules:['chamados','registro','orcamento','relatorios','laudo','preventiva','contratos','patrimonio','dashboard'],
                 canCreate:true, canEdit:true, canDelete:true, canViewPrices:true,
                 canApprove:true, canManageUsers:false },

  gestor:      { label:'Gestor',        icon:'📊', color:'#0284c7',
                 modules:['chamados','registro','orcamento','relatorios','laudo','preventiva','contratos','patrimonio','dashboard'],
                 canCreate:false, canEdit:false, canDelete:false, canViewPrices:false,
                 canApprove:false, canManageUsers:false },

  tecnico:     { label:'Técnico',       icon:'🔧', color:'#059669',
                 modules:['chamados','registro','orcamento','preventiva','contratos','patrimonio'],
                 canCreate:true, canEdit:false, canDelete:false, canViewPrices:false,
                 canApprove:false, canManageUsers:false },

  solicitante: { label:'Solicitante',   icon:'📋', color:'#d97706',
                 modules:['chamados'],
                 canCreate:true, canEdit:false, canDelete:false, canViewPrices:false,
                 canApprove:false, canManageUsers:false },
};

// ── HTTP client ───────────────────────────────────────────────────
async function _call(method, path, body, options = {}) {
  const token   = sessionStorage.getItem(SESSION_KEY);
  const headers = { 'Content-Type':'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.operationId) headers['Idempotency-Key'] = options.operationId;
  // Timeout: em rede de campo instável, o fetch pode travar sem resolver
  // nem rejeitar. O AbortController garante que a chamada sempre termina.
  const ctrl = new AbortController();
  const abortExternal=()=>ctrl.abort();
  options.signal?.addEventListener('abort',abortExternal,{once:true});
  if(options.signal?.aborted)ctrl.abort();
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
  let json;
  try {
    json = await res.json();
  } catch(e) {
    // O servidor não devolveu JSON (erro interno, instabilidade do
    // serviço, etc.) — mensagem clara em vez do erro de parse cru.
    if (ctrl.signal.aborted) throw e;
    throw Object.assign(new Error(`O servidor não respondeu corretamente (status ${res.status}). Tente novamente em instantes.`), {status:res.status, code:'INVALID_RESPONSE', transient:res.status >= 500 || res.status === 429});
  }
  if (!res.ok || !json.ok) {
    const e = new Error(json.error || `Erro ${res.status}`);
    e.status = res.status;
    e.code = json.code || 'HTTP_ERROR'; e.ref = json.ref;
    const retry = res.headers.get('Retry-After');
    e.retryAfter = retry ? (Number.isFinite(Number(retry)) ? Number(retry)*1000 : Math.max(0,Date.parse(retry)-Date.now())) : 0;
    e.transient = res.status >= 500 || [408,429].includes(res.status);
    throw e;
  }

  // ── Avisos do servidor ────────────────────────────────────────────
  // Canal genérico: qualquer rota pode devolver `data._avisos` e a
  // mensagem aparece na tela, em QUALQUER módulo, sem que cada um
  // precise tratar. Hoje serve à detecção de foto repetida; amanhã
  // serve a outro aviso sem exigir mexer em cinco arquivos.
  //
  // É aviso, não erro: a gravação já aconteceu e a promessa resolve
  // normalmente. Só informa.
  try {
    const avisos = json.data && json.data._avisos;
    if (Array.isArray(avisos) && avisos.length && typeof showToast === 'function') {
      avisos.forEach((a, i) => {
        // Espaça as mensagens: dois toasts simultâneos se sobrepõem e o
        // segundo apaga o primeiro antes de ser lido.
        setTimeout(() => showToast('⚠️ ' + (a.texto || 'Aviso do servidor'), 9000), i * 600);
      });
      if (console && console.info) console.info('Avisos do servidor:', avisos);
    }
  } catch (e) { /* aviso nunca pode quebrar a chamada que já deu certo */ }

  return options.envelope ? json : json.data;
  } catch (e) {
    if (e.status) throw e;
    const timeout = ctrl.signal.aborted;
    throw Object.assign(new Error(timeout
      ? 'Tempo esgotado ao falar com o servidor. O envio não foi confirmado; tente novamente.'
      : 'Sem conexão com o servidor. Verifique a internet e tente de novo.'),
      {code:timeout?'TIMEOUT':'NETWORK_ERROR',transient:true});
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort',abortExternal); }
}
const API = {
  get:    p     => _call('GET',    p),
  post:   (p,b) => _call('POST',   p, b),
  patch:  (p,b) => _call('PATCH',  p, b),
  delete: p     => _call('DELETE', p),
};

let _outboxReady;
function getOutbox() {
  if (!_outboxReady) _outboxReady = new Promise((resolve,reject)=>{
    const init=()=>resolve(window.SGMOutbox.create({user:getCurrentUser,call:_call,api:SMM_API_URL,notify:showOutboxStatus}));
    if (window.SGMOutbox) {init();return;}
    const script=document.createElement('script'); script.src='outbox.js?v=20260923.1';
    script.onload=init; script.onerror=()=>{_outboxReady=null;reject(new Error('Não foi possível preparar os envios. Recarregue a página.'));};
    document.head.appendChild(script);
  });
  return _outboxReady;
}
function showOutboxStatus(event) {
  if (!getCurrentUser()) return;
  let button=document.getElementById('sgm-outbox-status');
  if (!button) {
    button=document.createElement('button');button.id='sgm-outbox-status';button.type='button';
    button.style.cssText='position:fixed;top:72px;right:8px;z-index:10010;max-width:85vw;padding:8px 12px;border:1px solid #94a3b8;border-radius:12px;background:white;color:#0f172a;font:12px sans-serif;box-shadow:0 2px 8px #0002';
    button.onclick=openPendingSends; document.body.appendChild(button);
  }
  button.hidden=false;
  button.textContent=event.state==='confirmed'?'✓ Confirmado no servidor':'Envios pendentes — '+(event.state==='sending'?'enviando…':'verificar');
  button.title=event.message||'';
  clearTimeout(button._hide);
  if(event.state==='confirmed') button._hide=setTimeout(async()=>{if(!(await (await getOutbox()).list()).length)button.hidden=true;},4000);
}
async function openPendingSends() {
  const outbox=await getOutbox(); const rows=await outbox.list();
  document.getElementById('sgm-pending-panel')?.remove();
  const panel=document.createElement('div');panel.id='sgm-pending-panel';
  panel.style.cssText='position:fixed;inset:10%;z-index:11000;background:white;color:#0f172a;padding:20px;border:2px solid #0369a1;border-radius:12px;overflow:auto;box-shadow:0 0 0 100vmax #0007;font:14px sans-serif';
  const title=document.createElement('h2');title.textContent='Envios pendentes neste aparelho';panel.appendChild(title);
  const help=document.createElement('p');help.textContent='Não limpe os dados do navegador. A pendência só é removida após a confirmação. Conflitos precisam ser comparados com a versão atual do servidor.';panel.appendChild(help);
  for (const row of rows) {
    const item=document.createElement('div');item.style.cssText='border-top:1px solid #ddd;padding:12px 0';
    const label=document.createElement('p'); label.textContent=row.entity+' — '+(row.error||row.state);item.appendChild(label);
    const exportButton=document.createElement('button');exportButton.textContent='Baixar cópia para revisão';exportButton.onclick=()=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify(row.body,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='pendencia-'+row.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
    }; item.appendChild(exportButton);
    if(row.state==='review' && row.entity.startsWith('preventiva:')) {
      const compare=document.createElement('button');compare.textContent='Comparar com servidor';
      compare.onclick=async()=>{
        compare.disabled=true;
        try {
          const current=await DB.getPreventiva(row.entity.slice('preventiva:'.length));
          const report={operacao:row.id,erro:row.error,pendencia:row.body,servidor:current};
          const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
          const a=document.createElement('a');a.href=url;a.download='comparacao-'+row.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
          label.textContent=row.entity+' — Versão local: '+(row.body?.record?._version??'operação incremental')+'; servidor: '+(current._version??0)+'. Cópias baixadas para revisão. Nada foi sobrescrito.';
        } catch(e){label.textContent='Não foi possível consultar o servidor: '+e.message;}
        finally {compare.disabled=false;}
      };
      item.appendChild(compare);
    }
    const remove=document.createElement('button');remove.textContent='Descartar pendência';remove.onclick=async()=>{
      if(confirm('Descartar definitivamente o trabalho não sincronizado deste item? Não pode ser desfeito. Isso não desfaz algo já gravado no servidor. Baixe uma cópia antes.')) {
        try {await outbox.discard(row.id);item.remove();} catch(e){label.textContent=e.message;}
      }
    };item.appendChild(remove);panel.appendChild(item);
  }
  const retry=document.createElement('button');retry.textContent='Reenviar itens sem conflito';retry.onclick=async()=>{retry.disabled=true;try{await outbox.retry(true);await openPendingSends();}finally{retry.disabled=false;}};
  const close=document.createElement('button');close.textContent='Fechar';close.onclick=()=>panel.remove();panel.append(retry,close);document.body.appendChild(panel);
}
async function reliableWrite(method,path,body,entity) {
  return (await getOutbox()).submit(method,path,body,entity);
}
function restoreLocalBytes(remote, local) {
  if (!remote || typeof remote!=='object') return remote;
  if (Array.isArray(remote)) return remote.map((item,i)=>restoreLocalBytes(item,local?.find?.(x=>x?.id && x.id===item?.id)||local?.[i]));
  const result={...remote};
  if (!result.dataUrl && local?.dataUrl && (!remote.id || remote.id===local.id)) result.dataUrl=local.dataUrl;
  for(const key of Object.keys(result)) if(result[key] && typeof result[key]==='object')result[key]=restoreLocalBytes(result[key],local?.[key]);
  return result;
}
async function retryPendingSends() {
  if(!getCurrentUser())return;
  try {const box=await getOutbox();const rows=await box.list();if(rows.length){showOutboxStatus({state:'pending'});await box.retry();}}
  catch(e){console.warn('Pendências:',e.message);}
}
window.addEventListener('online',retryPendingSends);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')retryPendingSends();});
setTimeout(retryPendingSends,1500);
setInterval(retryPendingSends,30000);

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
  } catch (e) {
    if ([401,403].includes(e.status)) { window.location.href = destino; return null; }
  }
  if (!u || !(ROLES[u.role]?.modules || []).includes(modulo)) {
    window.location.href = destino; return null;
  }
  return u;
}
window.guardaDeModulo = guardaDeModulo;


async function refreshCurrentUser() {
  try {
    const fresh = await API.get('/auth/me');
    if (fresh && _currentUser) {
      _currentUser = { ..._currentUser, role: fresh.role, contract: fresh.contract, active: fresh.active };
    }
    return _currentUser;
  } catch(e) {
    if ([401,403].includes(e.status)) { _currentUser = null; sessionStorage.removeItem(SESSION_KEY); throw e; }
    return _currentUser;
  }
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
  try {
    const pending=await (await getOutbox()).list();
    if(pending.length && !confirm(`Existem ${pending.length} envios pendentes. Eles continuarão neste aparelho e só serão reenviados ao entrar com esta mesma conta. Deseja sair?`))return;
  } catch(e) { if(!confirm('Não foi possível verificar os envios pendentes. Sair mesmo assim?'))return; }
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
async function getCollectionPages(col, query = '') {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  // Chamadas explicitamente paginadas continuam devolvendo somente aquela página.
  if (params.has('limit') || params.has('offset') || !['chamados','registros','orcamentos','preventiva'].includes(col))
    return API.get(`/${col}${query || ''}`);
  params.set('limit', '100');
  const records = [], seen = new Set();
  let offset = 0, revision;
  for (;;) {
    params.set('offset', String(offset));
    const response = await _call('GET', `/${col}?${params}`, undefined, {envelope:true});
    if (!Array.isArray(response.data)) throw new Error('Lista inválida recebida do servidor.');
    if (offset === 0) revision = response.pagination?.revision;
    else if (revision !== undefined && revision !== response.pagination?.revision)
      throw new Error('Os dados foram atualizados durante a consulta. Recarregue a lista para obter todos os registros.');
    for (const record of response.data) {
      if (!seen.has(record.id)) { records.push(record); seen.add(record.id); }
    }
    const next = response.pagination?.nextOffset;
    if (response.pagination && next === null) return records;
    // Compatível com o backend anterior, que oferece limit/offset sem envelope.
    if (!response.pagination && response.data.length < 100) return records;
    const nextOffset = response.pagination ? next : offset + response.data.length;
    if (!Number.isInteger(nextOffset) || nextOffset <= offset || !response.data.length)
      throw new Error('Paginação inválida. Recarregue a lista.');
    offset = nextOffset;
  }
}
const DB = {
  // Coleções
  getAll:    (col, query='') => getCollectionPages(col, query),
  getRecord: (col, id) => API.get(`/${col}/${encodeURIComponent(id)}`),
  getPreventiva: id => API.get(`/preventiva/${encodeURIComponent(id)}`),
  setPreventivaCheck: (id,change) => reliableWrite('POST',`/preventiva/${encodeURIComponent(id)}/check`,change,'preventiva:'+id),
  save: async (col,r,effects) => {
    const response=await reliableWrite('POST',`/${col}?compact=1`,{record:r,...(effects?{effects}:{})},col+':'+r.id);
    if(response?.record) response.record=restoreLocalBytes(response.record,r);
    return response;
  },
  updateChamadoStatus: (id, status) => API.patch(`/chamados/${id}/status`, { status }),

  // Importação de pedido de orçamento em PDF. O servidor lê o arquivo com
  // IA e devolve um RASCUNHO conciliado com o catálogo do contrato — nada
  // é gravado nesta chamada.
  importarPedidoPdf: (contrato, pdf, respostas) =>
    API.post('/orcamentos/importar-pdf', { contrato, pdf, respostas }),
  // `itensAprovados` são os ÍNDICES dos itens aprovados, usados apenas na
  // aprovação parcial. Quem marca quais itens ficaram aprovados é o
  // servidor, a partir desses índices.
  updateOrcamentoStatus: (id, status, itensAprovados) =>
    API.patch(`/orcamentos/${id}/status`, { status, itensAprovados }),

  // Equivalências de termo → serviço(s) do catálogo, por contrato.
  // Gravam a decisão do usuário para a IA não repetir a pergunta.
  getEquivalencias:    (c)      => API.get(`/contratos/${encodeURIComponent(c)}/equivalencias`),
  saveEquivalencias:   (c, eq)  => API.post(`/contratos/${encodeURIComponent(c)}/equivalencias`, { equivalencias: eq }),
  removeEquivalencia:  (c, t)   => API.delete(`/contratos/${encodeURIComponent(c)}/equivalencias/${encodeURIComponent(t)}`),
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
  getContratos:       (query='') => API.get(`/contratos${query || ''}`),
  getContrato:        id => API.get(`/contratos/id/${encodeURIComponent(id)}`),
  saveContrato:       c     => reliableWrite('POST','/contratos',{contrato:c},'contratos:'+c.id),
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
  saveLaudo: async l => restoreLocalBytes(await reliableWrite('POST','/laudos?compact=1',{laudo:l},'laudos:'+l.id),l),
  deleteLaudo:        id    => API.delete(`/laudos/${id}`),

  // Movimentações
  getMovimentacoes:   (query='') => API.get(`/movimentacoes${query || ''}`),
  getMovimentacao:    id => API.get('/movimentacoes/' + encodeURIComponent(id)),
  saveMovimentacao: async m => {const r=await reliableWrite('POST','/movimentacoes',{movimentacao:m},'movimentacoes:'+m.id);if(r?.movimentacao)r.movimentacao=restoreLocalBytes(r.movimentacao,m);return r;},
  updateMovimentacao: async m => {const r=await reliableWrite('PATCH','/movimentacoes/'+m.id,{movimentacao:m},'movimentacoes:'+m.id);if(r?.movimentacao)r.movimentacao=restoreLocalBytes(r.movimentacao,m);return r;},
  deleteMovimentacao: id    => API.delete('/movimentacoes/' + id),
  updateMovStatus:    (id, status, motivoRejeicao) =>
                              reliableWrite('PATCH',`/movimentacoes/${id}/status`, { status, motivoRejeicao },'movimentacoes:'+id),

  // Ordens de serviço
  getOrdens:          ()    => API.get('/ordens-servico'),
  getOrdensByChamado: id    => API.get(`/ordens-servico/chamado/${id}`),
  saveOrdem:          o     => API.post('/ordens-servico', { ordem:o }),
  iniciarOrdem:       id    => API.patch(`/ordens-servico/${id}/iniciar`, {}),
  concluirOrdem:      (id, registroId) => reliableWrite('PATCH',`/ordens-servico/${id}/concluir`, { registroId },'ordens-servico:'+id),

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
  addRegistroFoto: async (id,photo,local) => {
    const r=await reliableWrite('POST',`/registros/${id}/foto`,{photo},'registros:'+id);
    if(r?.record)r.record=restoreLocalBytes(r.record,{...(local||{}),photos:[...(local?.photos||[]),photo]});
    return r;
  },

  // Upload incremental de UMA foto de preventiva (por equipamento), sem
  // reenviar o plano inteiro
  addPreventivaFoto: async (id,ei,photo) => {const r=await reliableWrite('POST',`/preventiva/${id}/equip/${ei}/foto`,{photo},'preventiva:'+id);if(r?.photo)r.photo=restoreLocalBytes(r.photo,photo);return r;},

  // Remoção incremental e determinística de UMA foto de preventiva
  delPreventivaFoto: (id, ei, photoId) => reliableWrite('DELETE',`/preventiva/${id}/equip/${ei}/foto/${encodeURIComponent(photoId)}`,null,'preventiva:'+id),

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
    const contracts = safeLocalStorageGetJSON('smm_contracts', []);
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

// ── Ciclo de vida dos equipamentos ────────────────────────────────
// Compatibilidade com inventários antigos: ausência de status equivale a
// operante, exceto quando o legado trazia `_inativo`.
// TAG numérica canônica: zeros à esquerda não criam uma segunda identidade.
// O limite de quatro dígitos também é aplicado no campo de entrada.
function normalizarTagNumero(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '').slice(0, 4);
  return digitos.replace(/^0+(?=\d)/, '');
}
window.normalizarTagNumero = normalizarTagNumero;
function statusEquipamento(equipamento) {
  const informado = String(equipamento?.status || '').trim().toLowerCase();
  if (informado === 'operante') return 'operante';
  if (/^(baixad|inoper|inativ)/.test(informado)) return 'baixado/inoperante';
  if (/^(desmont|desinstal|realoc)/.test(informado)) return 'desmontado/inoperante';
  if (informado) return informado;
  return equipamento?._inativo ? 'baixado/inoperante' : 'operante';
}
function equipamentoOperante(equipamento) {
  return statusEquipamento(equipamento) === 'operante' && equipamento?._inativo !== true;
}
function encontrarEquipamento(contrato, tag) {
  const alvo = normalizarTagNumero(tag);
  if (!alvo) return null;
  return (getEffDB()[contrato] || []).find(e => normalizarTagNumero(e?.tag) === alvo) || null;
}
function textoStatusEquipamento(equipamento) {
  const status = statusEquipamento(equipamento);
  return status === 'operante' ? 'operante' : status;
}
window.statusEquipamento = statusEquipamento;
window.equipamentoOperante = equipamentoOperante;
window.encontrarEquipamento = encontrarEquipamento;
window.textoStatusEquipamento = textoStatusEquipamento;
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
      hash: null,
      offline: true,
    };
  }
}

// Renderiza linha de assinaturas para exibir no card
function renderSignatures(sigs) {
  if (!sigs || !sigs.length) return '';
  return '<div class="sig-trail">' +
    sigs.map(s => {
      if(s.offline) return '<span class="sig-entry">⏳ Assinatura pendente de confirmação no servidor</span>';
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
