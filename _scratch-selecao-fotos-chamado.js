'use strict';
// Etapa 5: seleção de fotos (clique, arrastar, colar) pra chamado — função
// pura que decide o que entra, sem tocar DOM/FileReader.
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'chamados.html'), 'utf8');
const m = src.match(/function selecionarFotosParaAdicionar\([\s\S]*?\n\}/);
if (!m) throw new Error('selecionarFotosParaAdicionar não encontrada — extração do teste ficou desatualizada');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(m[0] + '\nthis.selecionarFotosParaAdicionar = selecionarFotosParaAdicionar;', sandbox);
const sel = sandbox.selecionarFotosParaAdicionar;

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

const img = (nome) => ({ type: 'image/png', name: nome });
const naoImg = (nome) => ({ type: 'application/pdf', name: nome });

console.log('── Caso 1: cabe tudo (0 atuais, 2 novas, máx 3) ──');
{
  const r = sel([img('a'), img('b')], 0, 3);
  assert('aceita as 2', r.aceitas.length === 2);
  assert('nenhuma ignorada', r.ignoradas === 0);
}

console.log('── Caso 2: já no máximo — nada entra ──');
{
  const r = sel([img('a')], 3, 3);
  assert('aceita 0', r.aceitas.length === 0);
  assert('1 ignorada', r.ignoradas === 1);
}

console.log('── Caso 3: cabe só parte (1 atual, 3 novas, máx 3) ──');
{
  const r = sel([img('a'), img('b'), img('c')], 1, 3);
  assert('aceita só 2 (as 2 primeiras)', r.aceitas.length === 2 && r.aceitas[0].name === 'a' && r.aceitas[1].name === 'b');
  assert('1 ignorada', r.ignoradas === 1);
}

console.log('── Caso 4: arquivo que não é imagem é descartado (não entra nem conta como ignorada por limite) ──');
{
  const r = sel([naoImg('doc.pdf'), img('a')], 0, 3);
  assert('só a imagem é aceita', r.aceitas.length === 1 && r.aceitas[0].name === 'a');
  assert('o PDF não aparece em ignoradas (nunca foi candidato, não é imagem)', r.ignoradas === 0);
}

console.log('── Caso 5: lista vazia (ex.: paste de texto puro) não quebra ──');
{
  const r = sel([], 0, 3);
  assert('nada aceito, nada ignorado', r.aceitas.length === 0 && r.ignoradas === 0);
}

console.log('── Caso 6: null/undefined na lista não quebra ──');
{
  const r = sel(null, 1, 3);
  assert('trata null como lista vazia', r.aceitas.length === 0 && r.ignoradas === 0);
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou');
process.exitCode = falhas ? 1 : 0;
