'use strict';
// Etapa 7: filtrarTextosPadrao (chamados.html) — função pura que decide
// quais sugestões aparecem no autocomplete, dado o que foi digitado.
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'chamados.html'), 'utf8');
const m = src.match(/function filtrarTextosPadrao\([\s\S]*?\n\}/);
if (!m) throw new Error('filtrarTextosPadrao não encontrada — extração do teste ficou desatualizada');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(m[0] + '\nthis.filtrarTextosPadrao = filtrarTextosPadrao;', sandbox);
const filtrar = sandbox.filtrarTextosPadrao;

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

const lista = [
  { id: '1', texto: 'Ar-condicionado não gela' },
  { id: '2', texto: 'Ar-condicionado com vazamento de água' },
  { id: '3', texto: 'Elevador travando no 3º andar' },
  { id: '4', texto: 'Painel elétrico desarmando' },
];

console.log('── Caso 1: busca por substring, case-insensitive ──');
{
  const r = filtrar(lista, 'AR-COND');
  assert('encontra os 2 que começam com Ar-condicionado', r.length === 2);
}

console.log('── Caso 2: busca vazia (ainda não digitou nada relevante) devolve vazio ──');
{
  assert('string vazia', filtrar(lista, '').length === 0);
  assert('só espaços', filtrar(lista, '   ').length === 0);
}

console.log('── Caso 3: limite respeitado ──');
{
  const r = filtrar(lista, 'a', 2); // "a" aparece em quase todos
  assert('respeita o limite de 2', r.length === 2);
}

console.log('── Caso 4: sem match devolve vazio, sem quebrar ──');
{
  assert('sem resultado', filtrar(lista, 'motor de elevador quebrado totalmente').length === 0);
}

console.log('── Caso 5: lista nula/undefined não quebra ──');
{
  assert('lista null', filtrar(null, 'ar').length === 0);
  assert('lista undefined', filtrar(undefined, 'ar').length === 0);
}

console.log('── Caso 6: item malformado na lista (sem texto) é ignorado, não quebra ──');
{
  const listaRuim = [{ id: '1', texto: 'Ar-condicionado não gela' }, { id: '5' }, null, { id: '6', texto: 123 }];
  const r = filtrar(listaRuim, 'ar-condicionado');
  assert('não quebra e ainda acha o único válido', r.length === 1 && r[0].id === '1');
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou');
process.exitCode = falhas ? 1 : 0;
