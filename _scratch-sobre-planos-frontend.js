'use strict';
// Teste isolado do esquema interativo de módulos por plano em sobre.html.
// Garante duas coisas: (1) a lógica de filtragem por tier funciona
// (cumulativa: avançada = básica + avançada, premium = tudo); (2)
// "recebimento" está marcado como 'avancada' aqui — se um dia isto
// divergir do authz.js/api-client.js reais (fonte de verdade da
// restrição), a vitrine mentiria sobre o que cada plano libera.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sobreHtml = fs.readFileSync(path.join(__dirname, 'sobre.html'), 'utf8');
const apiClientJs = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');

// Casa parênteses/chaves/colchetes por profundidade (não por regex de
// fim de linha) — funciona tanto pra declaração numa linha só
// (MODULOS_AVANCADA_UI = [...]) quanto pra array multilinha (MODULOS em
// sobre.html).
function extraeConst(src, nome) {
  const re = new RegExp(`const ${nome}\\s*=\\s*`);
  const m = re.exec(src);
  if (!m) throw new Error('const não encontrada: ' + nome);
  const abre = src[m.index + m[0].length];
  if (abre !== '[' && abre !== '{') throw new Error('const não é array/objeto: ' + nome);
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
function extraeFuncao(src, nome) {
  const re = new RegExp(`function ${nome}\\([^)]*\\)\\s*\\{`);
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

// ── 1. Consistência com a fonte de verdade real (api-client.js) ──
console.log('── sobre.html não diverge do tier real definido em api-client.js ──');
{
  const sandboxReal = {};
  vm.createContext(sandboxReal);
  vm.runInContext(
    extraeConst(apiClientJs, 'MODULOS_BASICA_UI') + '\n' +
    extraeConst(apiClientJs, 'MODULOS_AVANCADA_UI') + '\n' +
    extraeConst(apiClientJs, 'MODULOS_PREMIUM_UI') + '\n' +
    'this.MODULOS_BASICA_UI=MODULOS_BASICA_UI; this.MODULOS_AVANCADA_UI=MODULOS_AVANCADA_UI; this.MODULOS_PREMIUM_UI=MODULOS_PREMIUM_UI;',
    sandboxReal
  );

  const sandboxVitrine = {};
  vm.createContext(sandboxVitrine);
  vm.runInContext(extraeConst(sobreHtml, 'MODULOS') + '\nthis.MODULOS=MODULOS;', sandboxVitrine);
  const porId = {}; sandboxVitrine.MODULOS.forEach(m => porId[m.id] = m.tier);

  assert('"recebimento" está em avancada na vitrine (mesmo tier do real)',
    porId.recebimento === 'avancada' && sandboxReal.MODULOS_AVANCADA_UI.includes('recebimento') && !sandboxReal.MODULOS_BASICA_UI.includes('recebimento'));
  assert('"laudo" está em avancada na vitrine, batendo com o real',
    porId.laudo === 'avancada' && sandboxReal.MODULOS_AVANCADA_UI.includes('laudo'));
  assert('"qai" está em premium na vitrine, batendo com o real',
    porId.qai === 'premium' && sandboxReal.MODULOS_PREMIUM_UI.includes('qai') && !sandboxReal.MODULOS_AVANCADA_UI.includes('qai'));
  assert('"contratos" está em basica na vitrine, batendo com o real',
    porId.contratos === 'basica' && sandboxReal.MODULOS_BASICA_UI.includes('contratos'));
  // Nenhum módulo da vitrine pode estar num tier MAIS BAIXO do que o real
  // (isso prometeria algo que o plano não entrega) — básica não pode
  // "ganhar" um módulo que o real só libera depois.
  const todosOk = sandboxVitrine.MODULOS.every(m => {
    if (m.id === 'admin') return true; // sempre incluso, fora da lista real de módulos restringíveis
    if (m.tier === 'basica')   return sandboxReal.MODULOS_BASICA_UI.includes(m.id);
    if (m.tier === 'avancada') return sandboxReal.MODULOS_AVANCADA_UI.includes(m.id) && !sandboxReal.MODULOS_BASICA_UI.includes(m.id);
    if (m.tier === 'premium')  return sandboxReal.MODULOS_PREMIUM_UI.includes(m.id) && !sandboxReal.MODULOS_AVANCADA_UI.includes(m.id);
    return false;
  });
  assert('todo módulo da vitrine está exatamente no mesmo tier do real', todosOk);
}

// ── 2. Lógica de filtragem (cumulativa) ──
console.log('── Filtragem por plano é cumulativa (avançada = básica + avançada) ──');
{
  const sandbox = { document: { getElementById: () => ({ innerHTML: '' }) } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    "const TIERS=['basica','avancada','premium'];" +
    extraeConst(sobreHtml, 'TIER_LABEL') + '\n' +
    extraeConst(sobreHtml, 'MODULOS') + '\n' +
    'let planoSelecionado;\n' +
    extraeFuncao(sobreHtml, 'renderModulesGrid') + '\n' +
    'this.TIERS=TIERS; this.MODULOS=MODULOS; this.renderModulesGrid=renderModulesGrid; ' +
    'this.setPlano=function(p){ planoSelecionado=p; };',
    sandbox
  );

  // Checagem via regex no HTML gerado: um módulo aparece "bloqueado" se o
  // bloco .module-item que o envolve tem a classe "locked".
  function statusDoModulo(plano, nome) {
    sandbox.setPlano(plano);
    const grid = { innerHTML: '' };
    sandbox.document.getElementById = () => grid;
    sandbox.renderModulesGrid();
    const i = grid.innerHTML.indexOf(nome);
    const blocoAntes = grid.innerHTML.lastIndexOf('<div class="module-item', i);
    const bloco = grid.innerHTML.slice(blocoAntes, i);
    return bloco.includes('locked') ? 'bloqueado' : 'incluso';
  }

  assert('plano básica: Contratos incluso', statusDoModulo('basica', 'Contratos') === 'incluso');
  assert('plano básica: Recebimento de Serviços bloqueado', statusDoModulo('basica', 'Recebimento de Serviços') === 'bloqueado');
  assert('plano básica: QAI bloqueado', statusDoModulo('basica', 'QAI') === 'bloqueado');
  assert('plano avançada: Contratos continua incluso (cumulativo)', statusDoModulo('avancada', 'Contratos') === 'incluso');
  assert('plano avançada: Recebimento de Serviços incluso', statusDoModulo('avancada', 'Recebimento de Serviços') === 'incluso');
  assert('plano avançada: QAI ainda bloqueado', statusDoModulo('avancada', 'QAI') === 'bloqueado');
  assert('plano premium: QAI incluso', statusDoModulo('premium', 'QAI') === 'incluso');
  assert('plano premium: Recebimento de Serviços incluso', statusDoModulo('premium', 'Recebimento de Serviços') === 'incluso');
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
