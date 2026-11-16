'use strict';
// sigTrailCardHtml (trilha de assinaturas do card de lista): escapa nome,
// papel e hash, mostra só a última entrada com "+N" e não deixa o clique
// na trilha abrir o card. Extrai só as funções necessárias do api-client.js
// (o arquivo inteiro tem side-effects de topo).
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');
const pega = (re, nome) => { const m = src.match(re); if (!m) throw new Error(nome + ' não encontrada em api-client.js'); return m[0]; };
const codigo = [
  pega(/function esc\([\s\S]*?\n\}/, 'esc'),
  pega(/const _ACAO_FIXA = \{[\s\S]*?\n\};/, '_ACAO_FIXA'),
  pega(/const _ACAO_STATUS = \{[\s\S]*?\n\};/, '_ACAO_STATUS'),
  pega(/function _acaoInfo\([\s\S]*?\n\}/, '_acaoInfo'),
  pega(/function _sigPapel\(.*\}/, '_sigPapel'),
  pega(/function fmtDataHoraBR\([\s\S]*?\n\}/, 'fmtDataHoraBR'),
  pega(/function _aceitesAnulados\([\s\S]*?\n\}/, '_aceitesAnulados'),
  pega(/function sigTrailCardHtml\([\s\S]*?\n\}/, 'sigTrailCardHtml'),
].join('\n');
const sandbox = { console, ROLES: { tecnico: { label: 'Técnico' } } };
vm.createContext(sandbox);
vm.runInContext(codigo + '\nthis.sigTrailCardHtml = sigTrailCardHtml;', sandbox);

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }
const sig = (n, extra = {}) => ({ action: 'criou', by_name: 'Pessoa ' + n, role: 'tecnico', at: Date.UTC(2026, 10, 13, 18, n), hash: 'abcdef12' + n, ...extra });

assert('sem assinaturas: nada', sandbox.sigTrailCardHtml([]) === '' && sandbox.sigTrailCardHtml(null) === '');

const uma = sandbox.sigTrailCardHtml([sig(1)]);
assert('uma assinatura: bloco simples, sem <details>', uma.startsWith('<div class="card-trail">') && !uma.includes('<details'));

const xss = sandbox.sigTrailCardHtml([sig(1, { by_name: '<img src=x onerror=alert(1)>', role: '"><b>', hash: '<scr' })]);
assert('nome, papel e hash são escapados', !xss.includes('<img') && !xss.includes('"><b>') && !xss.includes('<scr') && xss.includes('&lt;img'));

const cinco = sandbox.sigTrailCardHtml([1, 2, 3, 4, 5].map((n) => sig(n)));
const resumo = cinco.slice(cinco.indexOf('<summary'), cinco.indexOf('</summary>'));
assert('várias: <details> com a última no resumo e "+4"', cinco.startsWith('<details class="card-trail"') && resumo.includes('Pessoa 5') && resumo.includes('+4'));
assert('as anteriores ficam fora do resumo, da mais nova para a mais antiga', cinco.indexOf('Pessoa 4') > cinco.indexOf('</summary>') && cinco.indexOf('Pessoa 4') < cinco.indexOf('Pessoa 1'));
assert('clique e teclas na trilha não chegam ao card', /onclick="event\.stopPropagation\(\)"/.test(cinco) && /onkeydown="event\.stopPropagation\(\)"/.test(cinco));
assert('sem "·" literal entre os campos', !cinco.includes('·'));

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
