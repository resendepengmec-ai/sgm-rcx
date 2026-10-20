'use strict';
// Teste isolado de _consultarCnpj/_consultarCnpjDebounced (index.html) —
// consulta à BrasilAPI (pública) pra confirmar o CNPJ e preencher a razão
// social automaticamente no cadastro de Admin Cliente. Nunca bloqueia o
// cadastro: 404/erro de rede só avisam, nunca travam o formulário. Mesmo
// padrão de extração por regex + vm dos demais _scratch-*-frontend.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

function novoSandbox(fetchImpl) {
  const elementos = {
    'wl-cnpj-status': { innerHTML: '' },
    'wl-razao-social': { value: '' },
    'wl-company': { value: '' },
  };
  const sandbox = {
    document: { getElementById: id => elementos[id] || null },
    fetch: fetchImpl,
    esc: s => String(s == null ? '' : s),
    clearTimeout: () => {},
    setTimeout: (fn) => { fn(); return 0; }, // roda a consulta na hora, sem esperar o debounce de verdade
  };
  vm.createContext(sandbox);
  vm.runInContext(
    'let _cnpjConsultaTimer = null;\n' +
    extraeFuncao(indexHtml, '_cnpjValido') + '\n' +
    extraeFuncao(indexHtml, '_consultarCnpjDebounced') + '\n' +
    extraeFuncao(indexHtml, '_consultarCnpj') + '\n' +
    'this._cnpjValido=_cnpjValido; this._consultarCnpjDebounced=_consultarCnpjDebounced; this._consultarCnpj=_consultarCnpj;',
    sandbox
  );
  return { sandbox, elementos };
}

function respostaOk(dados) {
  return async () => ({ ok: true, status: 200, json: async () => dados });
}
function resposta404() {
  return async () => ({ ok: false, status: 404, json: async () => ({ message: 'não encontrado' }) });
}
function respostaFalha() {
  return async () => { throw new Error('rede fora'); };
}

(async () => {
console.log('── _consultarCnpjDebounced: CNPJ inválido/incompleto nunca dispara consulta ──');
{
  // setTimeout nem chega a ser chamado se _cnpjValido falhar antes —
  // sem depender de timer nenhum, essa parte é 100% síncrona.
  const { sandbox, elementos } = novoSandbox(() => { throw new Error('não devia consultar'); });
  sandbox._consultarCnpjDebounced('111');
  assert('status vazio pra CNPJ incompleto (nenhuma consulta disparada)', elementos['wl-cnpj-status'].innerHTML === '');
}

console.log('── _consultarCnpj: CNPJ válido, encontrado e ATIVO — preenche razão social, sugere nome fantasia vazio, status verde ──');
{
  const { sandbox, elementos } = novoSandbox(respostaOk({
    razao_social: 'CAIXA ESCOLAR EXEMPLO', nome_fantasia: 'Escola Exemplo', descricao_situacao_cadastral: 'ATIVA',
  }));
  await sandbox._consultarCnpj('11222333000181');
  assert('razão social preenchida', elementos['wl-razao-social'].value === 'CAIXA ESCOLAR EXEMPLO');
  assert('nome fantasia sugerido (estava vazio)', elementos['wl-company'].value === 'Escola Exemplo');
  assert('status mostra confirmação (verde)', /CAIXA ESCOLAR EXEMPLO/.test(elementos['wl-cnpj-status'].innerHTML));
}

console.log('── Nome fantasia já preenchido pelo admin NÃO é sobrescrito pela sugestão ──');
{
  const { sandbox, elementos } = novoSandbox(respostaOk({
    razao_social: 'OUTRA EMPRESA LTDA', nome_fantasia: 'Sugestão Da API', descricao_situacao_cadastral: 'ATIVA',
  }));
  elementos['wl-company'].value = 'Nome Que O Admin Já Escolheu';
  await sandbox._consultarCnpj('11222333000181');
  assert('nome fantasia do admin preservado', elementos['wl-company'].value === 'Nome Que O Admin Já Escolheu');
  assert('razão social ainda sincroniza (sempre)', elementos['wl-razao-social'].value === 'OUTRA EMPRESA LTDA');
}

console.log('── CNPJ válido mas com situação diferente de ATIVA: avisa, não bloqueia ──');
{
  const { sandbox, elementos } = novoSandbox(respostaOk({
    razao_social: 'EMPRESA BAIXADA LTDA', descricao_situacao_cadastral: 'BAIXADA',
  }));
  await sandbox._consultarCnpj('11222333000181');
  assert('razão social preenchida mesmo assim', elementos['wl-razao-social'].value === 'EMPRESA BAIXADA LTDA');
  assert('status avisa a situação (não trava nada — é só texto)', /BAIXADA/.test(elementos['wl-cnpj-status'].innerHTML));
}

console.log('── CNPJ não encontrado na Receita (404): avisa, não preenche nada ──');
{
  const { sandbox, elementos } = novoSandbox(resposta404());
  await sandbox._consultarCnpj('11222333000181');
  assert('razão social continua vazia', elementos['wl-razao-social'].value === '');
  assert('status avisa "não encontrado"', /não encontrado/i.test(elementos['wl-cnpj-status'].innerHTML));
}

console.log('── Falha de rede/BrasilAPI fora do ar: avisa, nunca lança erro pro resto do formulário ──');
{
  const { sandbox, elementos } = novoSandbox(respostaFalha());
  let lancou = false;
  try { await sandbox._consultarCnpj('11222333000181'); } catch(e) { lancou = true; }
  assert('não lança (formulário continua usável)', !lancou);
  assert('status avisa que não deu pra consultar', /não foi possível consultar/i.test(elementos['wl-cnpj-status'].innerHTML));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
})();
