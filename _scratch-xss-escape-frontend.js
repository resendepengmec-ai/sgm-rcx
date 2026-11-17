'use strict';
// Regressão de XSS armazenado (auditoria de segurança 2026-11): texto
// digitado por usuários (endereço, observação, dados do equipamento vindos
// da planilha, perfil Google) não pode entrar cru no HTML.
const fs = require('fs'), path = require('path'), vm = require('vm');
let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }
const ler = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

const ctx = {};
vm.createContext(ctx);
const api = ler('api-client.js');
vm.runInContext(api.slice(api.indexOf('function esc(str)'), api.indexOf('}', api.indexOf("replace(/'/g")) + 2) + '\nthis.esc = esc;', ctx);
const ataque = '</textarea><img src=x onerror=alert(1)>';
assert('esc neutraliza fechamento de tag e atributo', !/[<>"']/.test(ctx.esc(ataque + '"\'')));

const cru = {
  'orcamento.html': [/">\$\{m\.(marca|recinto)\}/, / · \$\{m\.estabelecimento\}<\/div>/, /\$\{q\.machine\.(marca|tipo|estabelecimento|recinto)\}/, /📍 \$\{q\.address\}/],
  'preventiva.html': [/\$\{e\.estabelecimento\} · \$\{e\.recinto\}/, />\$\{plan\.obs\}</],
  'patrimonio.html': [/\$\{equip\.(marca|tipo|capacidade|estabelecimento|recinto)(\|\|[^}]*)?\}/, /🟢 '\}\$\{equip\.tag\}/],
  'registro.html': [/>\$\{it\.obs\|\|''\}<\/textarea>/, /\$\{it\.desc\|\|(INVIAVEL_NOTE|'')\}/],
  'index.html': [/value="\$\{cfg\.(address|company|cnpj)/, /src="\$\{(user|u)\.picture\}"/, /\$\{l\.(user_email|user_role|action|module)(\|\|[^}]*)?\}/],
};
for (const [arquivo, padroes] of Object.entries(cru)) {
  const src = ler(arquivo);
  padroes.forEach(re => assert(`${arquivo}: sem ${re.source.slice(0, 50)}`, !re.test(src)));
}
for (const f of ['chamados.html', 'orcamento.html', 'preventiva.html', 'recebimento.html', 'registro.html', 'index.html'])
  assert(`${f}: nome/e-mail do perfil escapados`, !/>\$\{user\.(name|email)\}</.test(ler(f)));

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
