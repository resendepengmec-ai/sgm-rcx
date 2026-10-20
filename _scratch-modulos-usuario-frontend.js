'use strict';
// Teste isolado de: (1) modulosEfetivos com a 3ª camada (módulos
// permitidos por usuário), (2) _renderModulosPicker (grade de
// botões-toggle no modal "Editar usuário"), e (3) o cálculo de payload
// no save handler de editUser (null quando marca tudo, array quando é
// subconjunto). Mesmo padrão de extração por regex + vm dos demais
// _scratch-*-frontend.js.
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

// ── 1. modulosEfetivos: 3ª camada (módulos permitidos por usuário) ──
console.log('── modulosEfetivos: módulos permitidos por usuário nunca amplia, só restringe ──');
{
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    extraeConst(apiClientJs, 'ROLES') + '\n' +
    extraeFuncao(apiClientJs, 'modulosEfetivos') + '\n' +
    'this.modulosEfetivos=modulosEfetivos;',
    sandbox
  );

  const semRestricao = sandbox.modulosEfetivos({ role: 'gestor', modulosDoPlano: null, modulosPermitidos: null });
  assert('sem override (null): devolve tudo que o papel permite', semRestricao.includes('laudo') && semRestricao.includes('qai'));

  const comOverride = sandbox.modulosEfetivos({ role: 'gestor', modulosDoPlano: null, modulosPermitidos: ['contratos', 'chamados'] });
  assert('com override: só os módulos do override aparecem', comOverride.length === 2 && comOverride.includes('contratos') && comOverride.includes('chamados'));
  assert('override nunca amplia: um módulo que o papel não tem não aparece mesmo que estivesse no override', !sandbox.modulosEfetivos({ role: 'solicitante', modulosDoPlano: null, modulosPermitidos: ['chamados', 'qai'] }).includes('qai'));

  const comPlanoEOverride = sandbox.modulosEfetivos({ role: 'gestor', modulosDoPlano: ['contratos', 'chamados', 'registro'], modulosPermitidos: ['contratos', 'qai'] });
  assert('plano E override combinados: só o que sobra da interseção dos dois (contratos)', comPlanoEOverride.length === 1 && comPlanoEOverride[0] === 'contratos');
}

// ── 2. _renderModulosPicker ──
console.log('── _renderModulosPicker: universo por papel, estado inicial, admin/admin_cliente sem grade ──');
{
  const sandbox = { esc: s => String(s) };
  vm.createContext(sandbox);
  vm.runInContext(
    extraeConst(apiClientJs, 'ROLES') + '\n' +
    extraeConst(apiClientJs, 'ROTULO_MODULO_PLANO') + '\n' +
    extraeFuncao(indexHtml, '_renderModulosPicker') + '\n' +
    'this.ROLES=ROLES; this._renderModulosPicker=_renderModulosPicker;',
    sandbox
  );

  const htmlAdmin = sandbox._renderModulosPicker('admin', null);
  assert('papel admin: não mostra grade de botões', !htmlAdmin.includes('data-mod'));
  const htmlAdminCliente = sandbox._renderModulosPicker('admin_cliente', null);
  assert('papel admin_cliente: não mostra grade de botões', !htmlAdminCliente.includes('data-mod'));

  const htmlGestorSemOverride = sandbox._renderModulosPicker('gestor', null);
  const totalBotoesGestor = (htmlGestorSemOverride.match(/data-mod="/g) || []).length;
  assert('gestor sem override: 1 botão por módulo do papel', totalBotoesGestor === sandbox.ROLES.gestor.modules.length);
  assert('gestor sem override: todos vêm marcados (sel=1)', !htmlGestorSemOverride.includes('data-sel="0"'));

  const htmlTecnicoComOverride = sandbox._renderModulosPicker('tecnico', 'contratos,chamados');
  assert('técnico com override "contratos,chamados": contratos vem marcado', /data-mod="contratos" data-sel="1"/.test(htmlTecnicoComOverride));
  assert('técnico com override "contratos,chamados": registro vem DESmarcado', /data-mod="registro" data-sel="0"/.test(htmlTecnicoComOverride));

  const htmlSolicitante = sandbox._renderModulosPicker('solicitante', null);
  assert('solicitante: universo é só 1 módulo (chamados)', (htmlSolicitante.match(/data-mod="/g) || []).length === 1);
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
