'use strict';
// Teste isolado de saveSession: login de uma pessoa DIFERENTE da última
// sessão no mesmo navegador precisa limpar os caches compartilhados
// (chamados_list/registro_records/prev_plans/etc.) ANTES de guardar a
// nova sessão — sem isso, um admin_cliente novo podia herdar por um
// instante o que a pessoa anterior deixou em cache no mesmo dispositivo.
// Mesmo padrão de extração por regex + vm dos demais _scratch-*-frontend.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const apiClientJs = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');

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

function novoSandbox() {
  const store = {};
  let chamadasLimpar = 0;
  const sandbox = {
    SESSION_KEY: 'smm_session',
    _currentUser: null,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    sessionStorage: { setItem: () => {} },
    limparCachesLocais: () => { chamadasLimpar++; },
  };
  const constLine = /const _ULTIMO_EMAIL_KEY = .*?;/.exec(apiClientJs);
  if (!constLine) throw new Error('const _ULTIMO_EMAIL_KEY não encontrada em api-client.js');
  vm.createContext(sandbox);
  vm.runInContext(
    constLine[0] + '\n' +
    extraeFuncao(apiClientJs, 'saveSession') + '\nthis.saveSession=saveSession;',
    sandbox
  );
  return { sandbox, store, contarLimpezas: () => chamadasLimpar };
}

console.log('── saveSession: limpa cache compartilhado ao detectar troca de pessoa ──');
{
  const { sandbox, contarLimpezas } = novoSandbox();
  sandbox.saveSession('tok1', { email: 'tecnico-a@empresa-a.com', role: 'tecnico' });
  assert('1º login neste navegador: nada para limpar ainda (0 chamadas)', contarLimpezas() === 0);

  sandbox.saveSession('tok2', { email: 'tecnico-a@empresa-a.com', role: 'tecnico' });
  assert('mesma pessoa logando de novo: NÃO limpa (preserva o próprio cache)', contarLimpezas() === 0);

  sandbox.saveSession('tok3', { email: 'admin-cliente-b@empresa-b.com', role: 'admin_cliente' });
  assert('pessoa DIFERENTE no mesmo navegador: limpa o cache compartilhado', contarLimpezas() === 1);

  sandbox.saveSession('tok4', { email: 'ADMIN-CLIENTE-B@empresa-b.com', role: 'admin_cliente' });
  assert('mesmo e-mail, maiúsculas diferentes: tratado como a MESMA pessoa (não limpa de novo)', contarLimpezas() === 1);
}

console.log('── saveSession: sempre guarda a sessão, mesmo quando limpa o cache ──');
{
  const { sandbox } = novoSandbox();
  sandbox.saveSession('tokX', { email: 'a@a.com', role: 'tecnico' });
  sandbox.saveSession('tokY', { email: 'b@b.com', role: 'tecnico' });
  assert('_currentUser fica com a pessoa NOVA, não a antiga', sandbox._currentUser.email === 'b@b.com');
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
