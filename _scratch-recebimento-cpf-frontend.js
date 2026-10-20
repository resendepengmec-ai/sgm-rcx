'use strict';
// Teste isolado da exigência de CPF no cadastro em campo de recebimento.html
// (_asnNovoCheck) — o CPF agora é obrigatório (com dígito verificador
// válido) porque é a base da verificação de identidade em assinar.html.
// Mesmo padrão de extração por regex + vm já usado nos outros
// _scratch-*-frontend.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'recebimento.html'), 'utf8');

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

function campos() {
  return {
    'asn-novo-nome': { value: '' },
    'asn-novo-cpf': { value: '' },
    'asn-gerar': { disabled: false, style: {} },
  };
}

let registrados;
const sandbox = {
  document: { getElementById: id => registrados[id] || null },
  window: {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  extraeFuncao(html, '_cpfValido') + '\n' +
  extraeFuncao(html, '_asnNovoCheck') + '\n' +
  'this._cpfValido=_cpfValido; this._asnNovoCheck=_asnNovoCheck;',
  sandbox
);

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

console.log('── _asnNovoCheck: exige nome E CPF válido (não só nome) ──');
{
  registrados = campos();
  registrados['asn-novo-nome'].value = 'Fulano de Tal';
  registrados['asn-novo-cpf'].value = ''; // sem CPF
  sandbox._asnNovoCheck();
  assert('sem CPF: botão continua desabilitado, mesmo com nome preenchido', registrados['asn-gerar'].disabled === true);
  assert('sem CPF: window._asnResp não é definido', sandbox._asnResp == null);
}
{
  registrados = campos();
  registrados['asn-novo-nome'].value = 'Fulano de Tal';
  registrados['asn-novo-cpf'].value = '529.982.247-24'; // dígito verificador errado
  sandbox._asnNovoCheck();
  assert('CPF com dígito verificador errado: botão continua desabilitado', registrados['asn-gerar'].disabled === true);
}
{
  registrados = campos();
  registrados['asn-novo-nome'].value = 'Fulano de Tal';
  registrados['asn-novo-cpf'].value = '529.982.247-25'; // válido
  sandbox._asnNovoCheck();
  assert('nome + CPF válido: botão habilitado', registrados['asn-gerar'].disabled === false);
}
{
  registrados = campos();
  registrados['asn-novo-nome'].value = 'F'; // nome muito curto
  registrados['asn-novo-cpf'].value = '529.982.247-25';
  sandbox._asnNovoCheck();
  assert('CPF válido mas nome muito curto: botão continua desabilitado', registrados['asn-gerar'].disabled === true);
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
