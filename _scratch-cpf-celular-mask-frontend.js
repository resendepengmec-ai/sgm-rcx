'use strict';
// Teste isolado das máscaras de CPF/celular do cadastro de tomador de
// serviço (index.html) — extrai as funções reais por regex (mesmo padrão
// de _scratch-admin-saas-frontend.js) e roda num vm limpo, sem o DOM real.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extraeFuncao(src, nome) {
  const re = new RegExp(`function ${nome}\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error('função não encontrada em index.html: ' + nome);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  extraeFuncao(html, '_fmtCpf') + '\n' +
  extraeFuncao(html, '_cpfValido') + '\n' +
  extraeFuncao(html, '_fmtCel') + '\n' +
  extraeFuncao(html, '_maskCpfInput') + '\n' +
  extraeFuncao(html, '_maskCelInput') + '\n' +
  'this._fmtCpf=_fmtCpf; this._cpfValido=_cpfValido; this._fmtCel=_fmtCel; ' +
  'this._maskCpfInput=_maskCpfInput; this._maskCelInput=_maskCelInput;',
  sandbox
);

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }
function campo(valor) { return { value: valor }; }

console.log('── Máscara de CPF (trava em 11 dígitos, formata ao digitar) ──');
{
  const el = campo('529982247');
  sandbox._maskCpfInput(el);
  assert('9 dígitos: só agrupa em 3+3+3, sem traço ainda', el.value === '529.982.247');
}
{
  const el = campo('52998224725');
  sandbox._maskCpfInput(el);
  assert('11 dígitos: formata 000.000.000-00 completo', el.value === '529.982.247-25');
}
{
  const el = campo('529982247259999'); // excedente: dígitos demais colados/digitados
  sandbox._maskCpfInput(el);
  assert('excedente é descartado — nunca passa de 11 dígitos úteis', el.value === '529.982.247-25');
}
{
  const el = campo('ab5c2d9e9f8g2h2i4j7k2l5');
  sandbox._maskCpfInput(el);
  assert('letras coladas são descartadas, só dígitos contam', el.value === '529.982.247-25');
}

console.log('── Validação de CPF (dígito verificador, não só comprimento) ──');
{
  assert('CPF válido (dígitos corretos) passa', sandbox._cpfValido('529.982.247-25') === true);
  assert('CPF com dígito verificador errado é rejeitado', sandbox._cpfValido('529.982.247-24') === false);
  assert('sequência repetida (11111111111) é rejeitada', sandbox._cpfValido('111.111.111-11') === false);
  assert('CPF incompleto (10 dígitos) é rejeitado', sandbox._cpfValido('5299822472') === false);
}

console.log('── Máscara de celular (trava em 11 dígitos, formata ao digitar) ──');
{
  const el = campo('62999998888');
  sandbox._maskCelInput(el);
  assert('11 dígitos (celular): (62) 99999-8888', el.value === '(62) 99999-8888');
}
{
  const el = campo('6232221111');
  sandbox._maskCelInput(el);
  assert('10 dígitos (fixo): (62) 3222-1111', el.value === '(62) 3222-1111');
}
{
  const el = campo('629999988889999'); // excedente
  sandbox._maskCelInput(el);
  assert('excedente é descartado — nunca passa de 11 dígitos', el.value === '(62) 99999-8888');
}
{
  const el = campo('6');
  sandbox._maskCelInput(el);
  assert('1 dígito ainda não fecha o DDD: "(6"', el.value === '(6');
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
