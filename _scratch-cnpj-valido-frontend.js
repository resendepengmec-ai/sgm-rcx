'use strict';
// Teste isolado de _cnpjValido/_maskCnpjInput (index.html) — mesmo
// algoritmo do backend (src/validate.js cnpjValido), usado no campo CNPJ
// do formulário de "+ Adicionar" Admin Cliente (multi-empresa). Mesmo
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

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  extraeFuncao(indexHtml, '_cnpjValido') + '\n' +
  extraeFuncao(indexHtml, '_maskCnpjInput') + '\n' +
  'this._cnpjValido=_cnpjValido; this._maskCnpjInput=_maskCnpjInput;',
  sandbox
);

console.log('── _cnpjValido ──');
assert('CNPJ válido conhecido é aceito', sandbox._cnpjValido('11222333000181'));
assert('mesmo CNPJ com máscara é aceito', sandbox._cnpjValido('11.222.333/0001-81'));
assert('dígito verificador errado é rejeitado', !sandbox._cnpjValido('11222333000180'));
assert('sequência repetida (14 iguais) é rejeitada', !sandbox._cnpjValido('11111111111111'));
assert('menos de 14 dígitos é rejeitado', !sandbox._cnpjValido('123456'));
assert('vazio é rejeitado', !sandbox._cnpjValido(''));

console.log('── _maskCnpjInput ──');
function masc(valor) {
  const el = { value: valor };
  sandbox._maskCnpjInput(el);
  return el.value;
}
assert('14 dígitos formata como 00.000.000/0000-00', masc('11222333000181') === '11.222.333/0001-81');
assert('dígitos excedentes (mais de 14) são descartados', masc('112223330001819999') === '11.222.333/0001-81');
assert('entrada parcial (6 dígitos) formata só o que já tem', masc('112223') === '11.222.3');

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
