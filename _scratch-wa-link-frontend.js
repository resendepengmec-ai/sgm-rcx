'use strict';
// Teste isolado de _waLinkAssinatura (recebimento.html — a coleta de
// assinatura do cliente foi extraída de registro.html/preventiva.html pra
// este módulo próprio, pra não poluir os dois com UI que não é da
// natureza deles). Botão "Enviar pelo WhatsApp" na tela de link gerado.
// Mesmo padrão de extração por regex + vm já usado nos outros
// _scratch-*-frontend.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

for (const arquivo of ['recebimento.html']) {
  console.log(`── ${arquivo}: _waLinkAssinatura ──`);
  const src = fs.readFileSync(path.join(__dirname, arquivo), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(extraeFuncao(src, '_waLinkAssinatura') + '\nthis._waLinkAssinatura=_waLinkAssinatura;', sandbox);

  const link = 'https://sgm.eng.br/assinar.html?t=abc123';
  const url = sandbox._waLinkAssinatura('(62) 99999-8888', 'Unidade Central', link);

  assert('usa o host oficial wa.me', url.startsWith('https://wa.me/'));
  assert('número vem só com dígitos, prefixado com 55 (Brasil)', url.startsWith('https://wa.me/5562999998888?'));
  assert('a máscara do celular (parênteses/espaço/traço) não sobra na URL', !/[()\s-]/.test(url.split('?')[0]));
  const texto = decodeURIComponent(url.split('?text=')[1]);
  assert('o link de assinatura está no texto da mensagem', texto.includes(link));
  assert('menciona o estabelecimento', texto.includes('Unidade Central'));
  assert('não menciona mais o código de verificação (removido do template)', !/código de verifica/i.test(texto));

  // Celular com caracteres inesperados (ex: veio de um campo não mascarado) —
  // só os dígitos devem sobrar no número de destino.
  const url2 = sandbox._waLinkAssinatura('62 99999-8888 ', 'Outra Unidade', link);
  assert('tolera espaços/sujeira no celular de entrada', url2.startsWith('https://wa.me/5562999998888?'));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
