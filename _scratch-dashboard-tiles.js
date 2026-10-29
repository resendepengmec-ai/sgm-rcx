'use strict';
// Item 7 da auditoria do Render: _refreshDashboardTiles (index.html) não
// pode mais chamar um endpoint cujo módulo o papel do usuário não alcança
// — antes disparava as 7 chamadas incondicionalmente, gerando 403 em
// rajada pra todo papel restrito (solicitante só tem 'chamados', por
// exemplo). Mesmo padrão de extração por regex+vm de
// _scratch-modulos-usuario-frontend.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const apiClientJs = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

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

function montarSandbox() {
  const chamadas = [];
  function espiao(nome) {
    return (...args) => { chamadas.push(nome); return Promise.resolve([]); };
  }
  const sandbox = {
    DB: {
      getAll: (col, q) => espiao('getAll:' + col)(q),
      getContratos: espiao('getContratos'),
      getMovimentacoes: espiao('getMovimentacoes'),
      getWhitelist: espiao('getWhitelist'),
    },
    safeLocalStorageSetJSON: () => {},
    saveWhitelist: () => {},
    document: { querySelector: () => null },
    _chamadas: chamadas,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extraeConst(apiClientJs, 'ROTULO_MODULO_PLANO') + '\n' +
    'const MODULOS_BASICA_UI = ' + /const MODULOS_BASICA_UI\s*=\s*(\[[^\]]*\])/.exec(apiClientJs)[1] + ';\n' +
    'const MODULOS_AVANCADA_UI = [...MODULOS_BASICA_UI, "laudo", "orcamento", "recebimento"];\n' +
    'const MODULOS_PREMIUM_UI = [...MODULOS_AVANCADA_UI, "dashboard", "qai"];\n' +
    extraeConst(apiClientJs, 'ROLES') + '\n' +
    extraeFuncao(apiClientJs, 'modulosEfetivos') + '\n' +
    extraeFuncao(indexHtml, '_refreshDashboardTiles') + '\n' +
    'this.modulosEfetivos=modulosEfetivos; this._refreshDashboardTiles=_refreshDashboardTiles;',
    sandbox
  );
  return sandbox;
}

(async () => {
  console.log('── _refreshDashboardTiles: solicitante (só módulo "chamados") — só 1 das 7 chamadas é feita ──');
  {
    const sandbox = montarSandbox();
    await vm.runInContext('_refreshDashboardTiles({ role: "solicitante", modulosDoPlano: null, modulosPermitidos: null })', sandbox);
    assert('chama SÓ chamados (único módulo do solicitante)', JSON.stringify(sandbox._chamadas) === JSON.stringify(['getAll:chamados']));
    assert('NUNCA chama whitelist (sem módulo admin)', !sandbox._chamadas.includes('getWhitelist'));
    assert('NUNCA chama orçamentos (sem módulo orcamento)', !sandbox._chamadas.includes('getAll:orcamentos'));
    assert('NUNCA chama movimentações (sem módulo patrimonio)', !sandbox._chamadas.includes('getMovimentacoes'));
  }

  console.log('── _refreshDashboardTiles: técnico (sem módulo admin) — chama tudo, exceto whitelist ──');
  {
    const sandbox = montarSandbox();
    await vm.runInContext('_refreshDashboardTiles({ role: "tecnico", modulosDoPlano: null, modulosPermitidos: null })', sandbox);
    assert('chama chamados/registros/orçamentos/contratos/movimentações/preventiva (6 chamadas)', sandbox._chamadas.length === 6);
    assert('NUNCA chama whitelist (técnico não tem módulo admin)', !sandbox._chamadas.includes('getWhitelist'));
    assert('chama movimentações (técnico tem módulo patrimonio)', sandbox._chamadas.includes('getMovimentacoes'));
  }

  console.log('── _refreshDashboardTiles: admin (todos os módulos) — as 7 chamadas são feitas normalmente ──');
  {
    const sandbox = montarSandbox();
    await vm.runInContext('_refreshDashboardTiles({ role: "admin", modulosDoPlano: null, modulosPermitidos: null })', sandbox);
    assert('faz as 7 chamadas (nenhuma restrição pro admin)', sandbox._chamadas.length === 7);
    assert('inclui whitelist', sandbox._chamadas.includes('getWhitelist'));
    assert('inclui orçamentos', sandbox._chamadas.includes('getAll:orcamentos'));
  }

  console.log('── _refreshDashboardTiles: plano do tenant restringe mesmo pro admin_cliente (3ª camada já existente) ──');
  {
    const sandbox = montarSandbox();
    await vm.runInContext(
      '_refreshDashboardTiles({ role: "admin_cliente", modulosDoPlano: ["contratos","chamados"], modulosPermitidos: null })',
      sandbox
    );
    assert('plano básico sem orçamento/patrimonio/admin: só contratos+chamados chamados', sandbox._chamadas.length === 2 &&
      sandbox._chamadas.includes('getAll:chamados') && sandbox._chamadas.includes('getContratos'));
  }

  console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
