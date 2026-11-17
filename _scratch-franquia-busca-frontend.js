'use strict';
// Busca local do vocabulário no registro (corretiva com franquia).
const fs = require('fs'), path = require('path'), vm = require('vm');
let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

const html = fs.readFileSync(path.join(__dirname, 'registro.html'), 'utf8');
const ini = html.indexOf('const ACOES_FRANQUIA_PADRAO');
const fim = html.indexOf('async function carregarVocabFq');
assert('trecho da busca encontrado', ini > 0 && fim > ini);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(ini, fim) + '\nthis.buscar = buscarTermosFq; this.parecidos = sugerirParecidosFq; this.sim = similaridadeFq; this.top = maisUsadosFq; this.rotulo = rotuloTermo; this.ehItem = ehItemFranquia; this.prox = proximosFq;', ctx);

const v = {
  acoes: [
    { c: 'SUB', n: 'Substituição', s: ['substituicao', 'troca', 'trocar'] },
    { c: 'REP', n: 'Reparo', s: ['reparo', 'conserto'] },
    { c: 'LIM', n: 'Limpeza', s: ['limpeza', 'limpar'] },
  ],
  termos: [
    { i: 'b:refrigeracao:SUB.BORRACHA_VEDACAO', f: 'refrigeracao', a: 'SUB', k: 'Borracha de vedação', u: 'un', s: 'a', y: ['gaxeta', 'borracha da porta'] },
    { i: 'b:refrigeracao:REP.BORRACHA_VEDACAO', f: 'refrigeracao', a: 'REP', k: 'Borracha de vedação', u: 'un', s: 'a', y: ['gaxeta'] },
    { i: 'b:refrigeracao:SUB.TERMOSTATO', f: 'refrigeracao', a: 'SUB', k: 'Termostato', u: 'un', s: 'a' },
    { i: 'c:c1:refrigeracao:SUB.TERMOSTATO_DIGITAL', f: 'refrigeracao', a: 'SUB', k: 'Termostato digital', u: 'un', s: 'n' },
    { i: 'c:c1:refrigeracao:SUB.TERMOSTATO_IA', f: 'refrigeracao', a: 'SUB', k: 'Termostato eletrônico', u: 'un', s: 's' },
    { i: 'b:agua:SUB.REFIL_FILTRO', f: 'agua', a: 'SUB', k: 'Refil/filtro', u: 'un', s: 'a', y: ['vela'] },
    { i: 'b:outros:SUB.CABO_PLUGUE', f: 'outros', a: 'SUB', k: 'Cabo/plugue', u: 'un', s: 'a', y: ['tomada'] },
  ],
  uso: { refrigeracao: { 'b:refrigeracao:REP.BORRACHA_VEDACAO': 5, 'b:refrigeracao:SUB.TERMOSTATO': 2 } },
};

console.log('── Busca ──');
let r = ctx.buscar(v, 'borr porta', 'refrigeracao');
assert('prefixos "borr porta" acham a borracha (sinônimo "borracha da porta")', r.length === 1 && r[0].i === 'b:refrigeracao:SUB.BORRACHA_VEDACAO');
r = ctx.buscar(v, 'troca gaxeta', 'refrigeracao');
assert('sinônimo de ação (troca) + sinônimo de componente (gaxeta)', r.length === 1 && r[0].a === 'SUB');
r = ctx.buscar(v, 'gaxeta', 'refrigeracao');
assert('mais usado no contrato vem primeiro entre aprovados', r[0].i === 'b:refrigeracao:REP.BORRACHA_VEDACAO');
r = ctx.buscar(v, 'termost', 'refrigeracao');
assert('aprovado > sugerido > novo', r.map(t => t.s).join('') === 'asn');
assert('outra família fica de fora; genérico entra', ctx.buscar(v, 'vela', 'refrigeracao').length === 0 && ctx.buscar(v, 'tomada', 'refrigeracao').length === 1);
assert('acento e caixa não importam', ctx.buscar(v, 'VEDAÇÃO', 'refrigeracao').length === 2);
assert('até 6 sugestões', ctx.buscar({ ...v, termos: Array.from({ length: 10 }, (_, i) => ({ i: 'x' + i, f: 'outros', a: 'SUB', k: 'Motor ' + i, s: 'a' })) }, 'motor', 'outros').length === 6);
assert('rótulo Ação · componente', ctx.rotulo(v, v.termos[0]) === 'Substituição · Borracha de vedação');

console.log('── Você quis dizer ──');
r = ctx.parecidos(v, 'termostado', 'refrigeracao');
assert('erro de digitação acha o termostato', r.length >= 1 && r[0].k === 'Termostato');
assert('no máximo 3', ctx.parecidos(v, 'termosta', 'refrigeracao').length <= 3);
assert('nada parecido → vazio', ctx.parecidos(v, 'xyzwq', 'refrigeracao').length === 0);
assert('similaridade: igual = 1, vazio = 0', ctx.sim('Borracha', 'borracha') === 1 && ctx.sim('', 'x') === 0);
assert('similaridade: troca de uma letra fica alta', ctx.sim('termostato', 'termostado') > 0.8);

console.log('── Mais usados e itens ──');
assert('mais usados da família, em ordem de uso', ctx.top(v, 'refrigeracao').map(t => t.i).join() === 'b:refrigeracao:REP.BORRACHA_VEDACAO,b:refrigeracao:SUB.TERMOSTATO');
assert('item de franquia reconhecido; item de lista não', ctx.ehItem({ qtd: 1, termoId: 'x' }) && !ctx.ehItem({ name: 'Limpeza', qty: 1, price: 10 }) && !ctx.ehItem({ inviavel: true, qtd: 1 }));

console.log('── Costuma vir junto ──');
const vp = { ...v, prox: { refrigeracao: { 'b:refrigeracao:SUB.TERMOSTATO': ['b:refrigeracao:SUB.BORRACHA_VEDACAO', 'b:refrigeracao:REP.BORRACHA_VEDACAO'] } } };
assert('sugere depois do último lançado', ctx.prox(vp, 'refrigeracao', [{ termoId: 'b:refrigeracao:SUB.TERMOSTATO' }]).length === 2);
assert('não repete o que já foi lançado', ctx.prox(vp, 'refrigeracao', [{ termoId: 'b:refrigeracao:SUB.BORRACHA_VEDACAO' }, { termoId: 'b:refrigeracao:SUB.TERMOSTATO' }]).map(t => t.i).join() === 'b:refrigeracao:REP.BORRACHA_VEDACAO');
assert('sem item lançado, nada', ctx.prox(vp, 'refrigeracao', []).length === 0);

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
