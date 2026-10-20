'use strict';
// Seletor de empresa no app (sem logout) + campos de franquia puramente
// numéricos + edição de franquia multi-empresa dentro de Usuários — teste
// isolado por extração de função (regex) + vm, mesmo padrão dos demais
// _scratch-*-frontend.js (sem depender de nenhuma lib de DOM).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const apiClient = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');

function extraeFuncao(src, nome) {
  const re = new RegExp(`(?:async\\s+)?function ${nome}\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error('função não encontrada: ' + nome);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

console.log('── _onlyDigitsInput: campos de franquia rejeitam caractere não-dígito ao digitar ──');
{
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(extraeFuncao(html, '_onlyDigitsInput') + '\nthis._onlyDigitsInput=_onlyDigitsInput;', sandbox);
  const el1 = { value: '12e+-.34' };
  sandbox._onlyDigitsInput(el1);
  assert('letras/sinais de número parcial são removidos, só dígitos ficam', el1.value === '1234');
  const el2 = { value: '' };
  sandbox._onlyDigitsInput(el2);
  assert('campo vazio continua vazio (não quebra)', el2.value === '');
}

console.log('── #wl-limite-contratos / #wl-franquia-fotos / #edit-ac-limite / #edit-ac-franquia: nenhum é mais type="number" ──');
{
  assert('wl-limite-contratos é text+inputmode numeric', /id="wl-limite-contratos"[^>]*type="text"/.test(html) || /type="text"[^>]*id="wl-limite-contratos"/.test(html));
  assert('wl-franquia-fotos é text+inputmode numeric', /id="wl-franquia-fotos"[^>]*type="text"/.test(html) || /type="text"[^>]*id="wl-franquia-fotos"/.test(html));
  assert('nenhum dos 4 campos de franquia continua type="number"', !/type="number" id="(wl-limite-contratos|wl-franquia-fotos|edit-ac-limite|edit-ac-franquia)"/.test(html));
}

console.log('── _renderCamposFranquiaAdminCliente: renderiza vigência/plano/franquia pra UMA empresa dada ──');
{
  const planosMatch = /const ROTULO_MODULO_PLANO[\s\S]*?p\.modulosTexto = p\.modulos\.map\(m => ROTULO_MODULO_PLANO\[m\]\)\.join\(', '\);/.exec(apiClient);
  if (!planosMatch) throw new Error('PLANOS não encontrado em api-client.js');
  const sandbox = { document: { getElementById: () => null } };
  vm.createContext(sandbox);
  vm.runInContext(
    planosMatch[0] + '\n' +
    'function esc(s){return String(s??"");}\n' +
    'function _avisarDowngradePlano(){}\n' +
    extraeFuncao(html, '_renderCamposFranquiaAdminCliente') + '\n' +
    'this.PLANOS=PLANOS; this._renderCamposFranquiaAdminCliente=_renderCamposFranquiaAdminCliente;',
    sandbox
  );
  const entryA = { added_at: Date.UTC(2026, 0, 10), expires_at: null, plano: 'basica', limite_contratos: 3, franquia_fotos_mes: 50, contract: 'DA1,DA2' };
  const h = sandbox._renderCamposFranquiaAdminCliente(entryA);
  assert('mostra o limite de contratos da empresa informada (3)', /id="edit-ac-limite"[^>]*value="3"/.test(h));
  assert('mostra a franquia de fotos da empresa informada (50)', /id="edit-ac-franquia"[^>]*value="50"/.test(h));
  assert('plano selecionado é o da empresa informada (basica)', /<option value="basica"[^>]*selected/.test(h));
  assert('conta os contratos já cadastrados NESTA empresa (2)', /Contratos cadastrados hoje: 2/.test(h));
  assert('campos de franquia são text+inputmode numeric, com _onlyDigitsInput', /id="edit-ac-limite"[^>]*oninput="_onlyDigitsInput\(this\)"/.test(h));

  const entryB = { added_at: Date.UTC(2026, 1, 1), expires_at: null, plano: 'premium', limite_contratos: 1, franquia_fotos_mes: 5, contract: null };
  const h2 = sandbox._renderCamposFranquiaAdminCliente(entryB);
  assert('empresa DIFERENTE mostra os PRÓPRIOS valores (1), não os da anterior', /id="edit-ac-limite"[^>]*value="1"/.test(h2));
  assert('empresa sem contrato nenhum: contador em 0', /Contratos cadastrados hoje: 0/.test(h2));

  const hVazio = sandbox._renderCamposFranquiaAdminCliente(undefined);
  assert('entry undefined não quebra (campos em branco)', /id="edit-ac-limite"[^>]*value=""/.test(hVazio));
}

console.log('── _onChangeEditAcEmpresa: troca de empresa no <select> re-renderiza os campos da NOVA empresa escolhida ──');
{
  const planosMatch = /const ROTULO_MODULO_PLANO[\s\S]*?p\.modulosTexto = p\.modulos\.map\(m => ROTULO_MODULO_PLANO\[m\]\)\.join\(', '\);/.exec(apiClient);
  const containers = { 'edit-ac-empresa-fields': { innerHTML: '' } };
  const sandbox = { document: { getElementById: id => containers[id] || null } };
  vm.createContext(sandbox);
  vm.runInContext(
    planosMatch[0] + '\n' +
    'function esc(s){return String(s??"");}\n' +
    'function _avisarDowngradePlano(){}\n' +
    extraeFuncao(html, '_renderCamposFranquiaAdminCliente') + '\n' +
    'let _editAcEmpresasDoEmail = [];\n' +
    extraeFuncao(html, '_onChangeEditAcEmpresa') + '\n' +
    'this._renderCamposFranquiaAdminCliente=_renderCamposFranquiaAdminCliente; ' +
    'this._onChangeEditAcEmpresa=_onChangeEditAcEmpresa; ' +
    'this.setEmpresas = (l) => { _editAcEmpresasDoEmail = l; };',
    sandbox
  );
  sandbox.setEmpresas([
    { cnpj: '11122233000183', company: 'Empresa A', limite_contratos: 3, franquia_fotos_mes: 50, contract: 'DA1' },
    { cnpj: '22233344000183', company: 'Empresa B', limite_contratos: 9, franquia_fotos_mes: 900, contract: null },
  ]);
  sandbox._onChangeEditAcEmpresa({ value: '22233344000183' });
  assert('ao escolher a empresa B no select, os campos passam a refletir a franquia da B (9)', /id="edit-ac-limite"[^>]*value="9"/.test(containers['edit-ac-empresa-fields'].innerHTML));
  sandbox._onChangeEditAcEmpresa({ value: '11122233000183' });
  assert('voltando pra A, os campos voltam a refletir a franquia da A (3)', /id="edit-ac-limite"[^>]*value="3"/.test(containers['edit-ac-empresa-fields'].innerHTML));
}

console.log('── trocarEmpresaNoApp: chama trocar, limpa caches e recarrega — NUNCA mistura estado entre empresas ──');
{
  const chamadas = [];
  const sandbox = {
    DB: { trocarEmpresa: async (cnpj) => { chamadas.push('trocarEmpresa:' + cnpj); } },
    limparCachesLocais: () => chamadas.push('limparCachesLocais'),
    showToast: (msg) => chamadas.push('showToast:' + msg),
    window: { location: {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(extraeFuncao(html, 'trocarEmpresaNoApp') + '\nthis.trocarEmpresaNoApp=trocarEmpresaNoApp;', sandbox);
  return sandbox.trocarEmpresaNoApp('22233344000183').then(() => {
    assert('chama trocarEmpresa com o cnpj escolhido', chamadas[0] === 'trocarEmpresa:22233344000183');
    assert('limpa os caches locais ANTES de navegar (nunca reaproveita estado da empresa anterior)', chamadas[1] === 'limparCachesLocais');
    assert('recarrega o app do zero (index.html)', sandbox.window.location.href === 'index.html');

    console.log('── trocarEmpresaNoApp: falha no backend avisa, nunca limpa cache nem navega às cegas ──');
    const chamadas2 = [];
    const sandbox2 = {
      DB: { trocarEmpresa: async () => { throw new Error('empresa não encontrada'); } },
      limparCachesLocais: () => chamadas2.push('limparCachesLocais'),
      showToast: (msg) => chamadas2.push('showToast:' + msg),
      window: { location: {} },
    };
    vm.createContext(sandbox2);
    vm.runInContext(extraeFuncao(html, 'trocarEmpresaNoApp') + '\nthis.trocarEmpresaNoApp=trocarEmpresaNoApp;', sandbox2);
    return sandbox2.trocarEmpresaNoApp('00000000000000').then(() => {
      assert('avisa o erro (showToast)', chamadas2.some(c => c.startsWith('showToast:')));
      assert('NUNCA limpou cache numa troca que falhou', !chamadas2.includes('limparCachesLocais'));
      assert('NUNCA navegou numa troca que falhou', sandbox2.window.location.href === undefined);

      rodarRenderDashboard();
    });
  });
}

function rodarRenderDashboard() {
console.log('── renderDashboard: seletor de empresa no menu só aparece com MAIS de 1 empresa ──');
{
  const rolesMatch = /const ROLES = \{[\s\S]*?\n\};/.exec(apiClient);
  if (!rolesMatch) throw new Error('ROLES não encontrado em api-client.js');
  const app = { innerHTML: '' };
  const sandbox = {
    app,
    localStorage: { getItem: () => null },
    modulosEfetivos: () => ['admin'],
    getUsers: () => [],
    getWhitelist: () => [],
    safeLocalStorageGetJSON: (k, def) => def,
    esc: s => String(s ?? ''),
    timeAgo: () => '',
  };
  vm.createContext(sandbox);
  vm.runInContext(
    rolesMatch[0] + '\n' +
    extraeFuncao(html, 'renderDashboard') + '\n' +
    'this.ROLES=ROLES; this.renderDashboard=renderDashboard;',
    sandbox
  );

  const userUmaEmpresa = { role: 'admin_cliente', name: 'Dono', email: 'dono@teste.com', empresasDisponiveis: [{ cnpj: '11122233000183', company: 'Empresa A' }] };
  sandbox.renderDashboard(userUmaEmpresa);
  assert('1 empresa só: NUNCA mostra o seletor no menu', !app.innerHTML.includes('Empresa ativa'));

  const userDuasEmpresas = {
    role: 'admin_cliente', name: 'Dono', email: 'dono@teste.com', empresaAtivaCnpj: '22233344000183',
    empresasDisponiveis: [
      { cnpj: '11122233000183', company: 'Empresa A' },
      { cnpj: '22233344000183', company: 'Empresa B' },
    ],
  };
  sandbox.renderDashboard(userDuasEmpresas);
  const h = app.innerHTML;
  assert('2+ empresas: mostra a seção "Empresa ativa"', h.includes('Empresa ativa'));
  assert('lista as 2 empresas pelo nome', h.includes('Empresa A') && h.includes('Empresa B'));
  assert('cada item chama trocarEmpresaNoApp com o CNPJ certo', h.includes("trocarEmpresaNoApp('11122233000183')") && h.includes("trocarEmpresaNoApp('22233344000183')"));
  assert('a empresa ATIVA (B) aparece destacada com ✓', /✓ Empresa B/.test(h));
  assert('a empresa NÃO ativa (A) não leva o ✓', !/✓ Empresa A/.test(h));

  const userAdmin = { role: 'admin', name: 'Master', email: 'master@teste.com', empresasDisponiveis: [] };
  sandbox.renderDashboard(userAdmin);
  assert('admin master (sempre irrestrito): nunca mostra o seletor', !app.innerHTML.includes('Empresa ativa'));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
}
