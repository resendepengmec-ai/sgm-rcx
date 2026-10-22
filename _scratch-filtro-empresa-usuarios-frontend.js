'use strict';
// Teste end-to-end (não só a lógica isolada) do filtro "por empresa" na
// aba Usuários — extrai as funções REAIS de index.html/api-client.js
// (_renderUsersList, filterUsersByCompany, getWhitelist/getUsers via
// localStorage) e roda num DOM/localStorage falsos, clicando o filtro de
// verdade e inspecionando o HTML final. _scratch-filtro-empresa-frontend.js
// já cobre a lógica pura (empresaPorContrato/empresas) com uma
// reimplementação; este arquivo cobre a parte que aquele não cobre: o
// pipeline completo de render + filtro + re-render.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const apiClient = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');

function extraeFuncao(src, nome) {
  // Conta profundidade de parênteses pra lidar com parâmetro default que
  // tem a própria chamada (ex.: `seen = new WeakSet()`), em vez de um
  // regex ingênuo `\([^)]*\)` que já pararia no 1º `)` interno.
  const reInicio = new RegExp(`(?:async\\s+)?function ${nome}\\s*\\(`);
  const mInicio = reInicio.exec(src);
  if (!mInicio) throw new Error('função não encontrada: ' + nome);
  let i = mInicio.index + mInicio[0].length, profParen = 1;
  while (profParen > 0) {
    if (src[i] === '(') profParen++;
    else if (src[i] === ')') profParen--;
    i++;
  }
  while (src[i] !== '{') i++;
  const inicioCorpo = i;
  let depth = 1; i++;
  while (depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(mInicio.index, i);
}
function extraeConst(src, nome) {
  const re = new RegExp(`const ${nome}\\s*=\\s*`);
  const m = re.exec(src);
  if (!m) throw new Error('const não encontrada: ' + nome);
  const abre = src[m.index + m[0].length];
  const fecha = abre === '[' ? ']' : '}';
  let i = m.index + m[0].length, depth = 0;
  do {
    if (src[i] === abre) depth++;
    else if (src[i] === fecha) depth--;
    i++;
  } while (depth > 0);
  if (src[i] === ';') i++;
  return src.slice(m.index, i);
}

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

// localStorage falso de verdade (Map por trás) — getWhitelist/getUsers/
// saveWhitelist/filterUsersByCompany passam TODOS por ele, exatamente
// como no navegador.
function criarLocalStorageFalso() {
  const dados = new Map();
  return {
    getItem: k => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    removeItem: k => dados.delete(k),
  };
}

function montarSandbox() {
  const localStorage = criarLocalStorageFalso();
  const elementos = new Map();
  function elementoFalso(id) {
    if (!elementos.has(id)) elementos.set(id, { innerHTML: '' });
    return elementos.get(id);
  }
  const sandbox = {
    console,
    localStorage,
    document: { getElementById: id => elementoFalso(id) },
    // filterUsersByCompany/Contract (reais) leem _usersCache e chamam
    // getCurrentUser() pra re-renderizar — mesma dupla de toda aba admin.
    getCurrentUser: () => ({ role: 'admin' }),
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extraeFuncao(apiClient, 'esc') + '\n' +
    extraeConst(apiClient, 'ROLES') + '\n' +
    extraeFuncao(apiClient, 'safeLocalStorageGet') + '\n' +
    extraeFuncao(apiClient, 'safeLocalStorageGetJSON') + '\n' +
    extraeFuncao(apiClient, '_cacheSemBinarios') + '\n' +
    extraeFuncao(apiClient, 'safeLocalStorageSet') + '\n' +
    extraeFuncao(apiClient, 'safeLocalStorageSetJSON') + '\n' +
    extraeFuncao(html, 'jsAttr') + '\n' +
    extraeFuncao(html, 'podeAdministrar') + '\n' +
    extraeFuncao(html, 'getUsers') + '\n' +
    extraeFuncao(html, 'getWhitelist') + '\n' +
    extraeFuncao(html, 'saveWhitelist') + '\n' +
    'let _usersCache = [];\n' +
    'let _usersContractFilter = "";\n' +
    'let _usersCompanyFilter = "";\n' +
    extraeFuncao(html, '_renderUsersList') + '\n' +
    extraeFuncao(html, 'filterUsersByCompany') + '\n' +
    extraeFuncao(html, 'filterUsersByContract') + '\n' +
    'this.esc=esc; this.ROLES=ROLES; this.jsAttr=jsAttr; this.podeAdministrar=podeAdministrar; ' +
    'this.getUsers=getUsers; this.getWhitelist=getWhitelist; this.saveWhitelist=saveWhitelist; ' +
    'this._renderUsersList=_renderUsersList; this.filterUsersByCompany=filterUsersByCompany; ' +
    'this.filterUsersByContract=filterUsersByContract;',
    sandbox
  );
  return { sandbox, localStorage, elementoFalso };
}

console.log('── Filtro por empresa na aba Usuários: pipeline completo (render → escolher → re-render) ──');
{
  const { sandbox, localStorage, elementoFalso } = montarSandbox();

  const wl = [
    { email: 'acA@teste.com', role: 'admin_cliente', company: 'Empresa A', cnpj: 'A', contract: '10' },
    { email: 'acB@teste.com', role: 'admin_cliente', company: 'Empresa B', cnpj: 'B', contract: '20' },
    { email: 'tecA@teste.com', role: 'tecnico', contract: '10' },
    { email: 'tecB@teste.com', role: 'tecnico', contract: '20' },
  ];
  const users = [
    { id: 'u-acA', email: 'acA@teste.com', name: 'Dono A', role: 'admin_cliente', active: 1 },
    { id: 'u-acB', email: 'acB@teste.com', name: 'Dono B', role: 'admin_cliente', active: 1 },
    { id: 'u-tecA', email: 'tecA@teste.com', name: 'Tec A', role: 'tecnico', active: 1 },
    { id: 'u-tecB', email: 'tecB@teste.com', name: 'Tec B', role: 'tecnico', active: 1 },
  ];
  localStorage.setItem('smm_whitelist_cache', JSON.stringify(wl));
  localStorage.setItem('smm_users_cache', JSON.stringify(users));
  // filterUsersByCompany (real) relê de _usersCache, não do array local
  // `users` — precisa estar presente no mesmo escopo léxico do vm.
  vm.runInContext('_usersCache = ' + JSON.stringify(users) + ';', sandbox);

  const el = elementoFalso('admin-tab-content');
  sandbox._renderUsersList(el, users, { role: 'admin' });

  assert('sem filtro: mostra os 4 usuários', /4 de 4 usuário/.test(el.innerHTML));
  assert('dropdown de empresa lista Empresa A e Empresa B', el.innerHTML.includes('>Empresa A<') && el.innerHTML.includes('>Empresa B<'));

  console.log('── Escolhendo "Empresa A" no filtro (simulando o onchange de verdade) ──');
  sandbox.filterUsersByCompany('Empresa A');
  const htmlFiltrado = elementoFalso('admin-tab-content').innerHTML;
  assert('mostra só os 2 da Empresa A (dono + técnico)', /2 de 4 usuário/.test(htmlFiltrado));
  assert('inclui o Dono A', htmlFiltrado.includes('Dono A'));
  assert('inclui o Tec A', htmlFiltrado.includes('Tec A'));
  assert('NÃO inclui o Dono B', !htmlFiltrado.includes('Dono B'));
  assert('NÃO inclui o Tec B', !htmlFiltrado.includes('Tec B'));
  assert('a opção "Empresa A" fica marcada como selected', /<option value="Empresa A" selected>/.test(htmlFiltrado));

  console.log('── Voltando para "Todas as empresas" ──');
  sandbox.filterUsersByCompany('');
  const htmlTodos = elementoFalso('admin-tab-content').innerHTML;
  assert('volta a mostrar os 4', /4 de 4 usuário/.test(htmlTodos));
}

console.log('── Regressão: empresa com caractere especial (& / acentos) no nome continua filtrável ──');
{
  const { sandbox, localStorage, elementoFalso } = montarSandbox();
  const wl = [
    { email: 'ac@teste.com', role: 'admin_cliente', company: 'Climatiza & Refrigeração Ltda', cnpj: 'X', contract: '30' },
  ];
  const users = [{ id: 'u-ac', email: 'ac@teste.com', name: 'Dono', role: 'admin_cliente', active: 1 }];
  localStorage.setItem('smm_whitelist_cache', JSON.stringify(wl));
  localStorage.setItem('smm_users_cache', JSON.stringify(users));
  vm.runInContext('_usersCache = ' + JSON.stringify(users) + ';', sandbox);
  const el = elementoFalso('admin-tab-content');
  sandbox._renderUsersList(el, users, { role: 'admin' });
  // O browser decodifica a entidade HTML do atributo value de volta pro
  // texto original ao ler .value — aqui simulamos exatamente esse texto
  // (não a forma escapada) sendo repassado pelo onchange.
  sandbox.filterUsersByCompany('Climatiza & Refrigeração Ltda');
  assert('filtra corretamente mesmo com "&" no nome da empresa', /1 de 1 usuário/.test(elementoFalso('admin-tab-content').innerHTML));
}

console.log('── Bug corrigido: Admin Cliente recém-criado (SEM contrato nenhum ainda) aparece no dropdown e é filtrável ──');
{
  const { sandbox, localStorage, elementoFalso } = montarSandbox();
  const wl = [
    // Dono A: já tem contrato. Dono B: nome fantasia definido, mas
    // contract:null — cenário exato do bug (empresa só aparecia no
    // dropdown depois de cadastrar o 1º contrato).
    { email: 'acA@teste.com', role: 'admin_cliente', company: 'Empresa Com Contrato', cnpj: 'A', contract: '10' },
    { email: 'acB@teste.com', role: 'admin_cliente', company: 'Empresa Recem Criada', cnpj: 'B', contract: null },
  ];
  const users = [
    { id: 'u-acA', email: 'acA@teste.com', name: 'Dono A', role: 'admin_cliente', active: 1 },
    { id: 'u-acB', email: 'acB@teste.com', name: 'Dono B', role: 'admin_cliente', active: 1 },
  ];
  localStorage.setItem('smm_whitelist_cache', JSON.stringify(wl));
  localStorage.setItem('smm_users_cache', JSON.stringify(users));
  vm.runInContext('_usersCache = ' + JSON.stringify(users) + ';', sandbox);
  const el = elementoFalso('admin-tab-content');
  sandbox._renderUsersList(el, users, { role: 'admin' });
  assert('dropdown lista a empresa SEM contrato nenhum ainda', el.innerHTML.includes('>Empresa Recem Criada<'));

  sandbox.filterUsersByCompany('Empresa Recem Criada');
  const htmlFiltrado = elementoFalso('admin-tab-content').innerHTML;
  assert('filtrar por ela mostra só o próprio dono (1 de 2)', /1 de 2 usuário/.test(htmlFiltrado) && htmlFiltrado.includes('Dono B'));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
