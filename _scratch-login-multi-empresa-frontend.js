'use strict';
// Teste isolado de loginWithGoogleToken (api-client.js): quando o
// servidor responde escolherEmpresa:true (e-mail com mais de uma
// empresa admin_cliente), a função devolve a lista pro front mostrar o
// seletor, SEM chamar saveSession (nenhum token ainda). Escolhendo uma
// empresa (2º parâmetro empresaCnpj), a chamada deve incluir esse campo
// no corpo do POST. Mesmo padrão de extração por regex + vm dos demais
// _scratch-*-frontend.js.
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

function novoSandbox(respostaPost) {
  let corpoEnviado = null;
  let saveSessionChamado = null;
  const sandbox = {
    API: { post: async (path, body) => { corpoEnviado = body; return respostaPost; } },
    saveSession: (token, user) => { saveSessionChamado = { token, user }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extraeFuncao(apiClientJs, 'loginWithGoogleToken') + '\nthis.loginWithGoogleToken=loginWithGoogleToken;',
    sandbox
  );
  return { sandbox, corpoEnviado: () => corpoEnviado, saveSessionChamado: () => saveSessionChamado };
}

(async () => {
console.log('── 1ª chamada, e-mail com 2 empresas: devolve a lista, NUNCA chama saveSession ──');
{
  const { sandbox, corpoEnviado, saveSessionChamado } = novoSandbox({
    escolherEmpresa: true, empresas: [{ cnpj: '111', company: 'Empresa A' }, { cnpj: '222', company: 'Empresa B' }],
  });
  const r = await sandbox.loginWithGoogleToken('tok-google');
  assert('devolve escolherEmpresa:true', r.escolherEmpresa === true);
  assert('devolve as 2 empresas', r.empresas.length === 2);
  assert('saveSession NUNCA foi chamado (nenhum token ainda)', saveSessionChamado() === null);
  assert('corpo do POST não tinha empresaCnpj (1ª tentativa)', !('empresaCnpj' in corpoEnviado()));
}

console.log('── 2ª chamada, com empresaCnpj: manda no corpo e segue o fluxo normal de login ──');
{
  const { sandbox, corpoEnviado, saveSessionChamado } = novoSandbox({
    token: 'jwt-valido', user: { email: 'dono@teste.com', name: 'Dono Teste', cnpj: '111' },
  });
  const user = await sandbox.loginWithGoogleToken('tok-google', '111');
  assert('corpo do POST inclui empresaCnpj escolhido', corpoEnviado().empresaCnpj === '111');
  assert('saveSession foi chamado com o token e o user', saveSessionChamado()?.token === 'jwt-valido' && saveSessionChamado()?.user?.email === 'dono@teste.com');
  assert('devolve o user (fluxo normal)', user.email === 'dono@teste.com');
}

console.log('── Login comum (1 empresa só, sem escolha): comportamento de sempre ──');
{
  const { sandbox, corpoEnviado, saveSessionChamado } = novoSandbox({
    token: 'jwt-valido2', user: { email: 'staff@teste.com', name: 'Staff' },
  });
  const user = await sandbox.loginWithGoogleToken('tok-google');
  assert('corpo do POST não tem empresaCnpj (nem undefined vazando)', !('empresaCnpj' in corpoEnviado()));
  assert('saveSession chamado normalmente', saveSessionChamado()?.token === 'jwt-valido2');
  assert('devolve o user', user.email === 'staff@teste.com');
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
})();
