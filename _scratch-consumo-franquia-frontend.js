'use strict';
// Consumo dos contratos com franquia no relatório (relatorio.html) e linha
// do item de franquia no PDF/detalhe do registro (registro.html).
const fs = require('fs'), path = require('path'), vm = require('vm');
let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

const rel = fs.readFileSync(path.join(__dirname, 'relatorio.html'), 'utf8');
const ini = rel.indexOf('const FAMILIA_ROTULO');
const fim = rel.indexOf('// `photoCount`');
assert('trecho do consumo encontrado', ini > 0 && fim > ini);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(rel.slice(ini, fim) + '\nthis.consumo = consumoFranquia; this.fmt = fmtQtdRel;', ctx);

const PUX = 'b:refrigeracao:SUB.PUXADOR', ALCA = 'c:cf:refrigeracao:SUB.ALCA_LATERAL', GAS = 'b:refrigeracao:REC.GAS_REFRIGERANTE_R600A';
const vocab = { termos: [
  { i: PUX, f: 'refrigeracao', a: 'SUB', k: 'Puxador' },
  { i: GAS, f: 'refrigeracao', a: 'REC', k: 'Gás refrigerante R600a' },
], mesclados: { [ALCA]: PUX } };
const m = { estabelecimento: 'Escola A', familia: 'refrigeracao' };
const regs = [
  { id: 'R1', client: '7777', equip: '5', machine: m, modeloCorretiva: 'franquia', items: [{ qtd: 2, unidade: 'un', termoId: ALCA, componente: 'Alça lateral' }, { qtd: 0.25, unidade: 'kg', termoId: GAS }] },
  { id: 'R2', client: '7777', equip: '5', machine: m, modeloCorretiva: 'franquia', items: [{ qtd: 1, unidade: 'un', termoId: PUX }, { inviavel: true, name: 'Inviável' }] },
  { id: 'R3', client: '7777', equip: '6', machine: { estabelecimento: 'Escola B', familia: 'refrigeracao' }, modeloCorretiva: 'franquia', items: [{ qtd: 0.5, unidade: 'kg', termoId: GAS }, { qtd: 1, unidade: 'un', termoId: 'c:cf:outros:SUB.X', componente: 'Peça avulsa' }] },
];
const c = ctx.consumo(regs, new Map([['7777', vocab]]));
const comp = k => c.porComponente.find(x => x.chave === k);
assert('mescla resolvida: Alça (2) + Puxador (1) somam 3 un em Puxador', comp('Puxador')?.qtd === 3 && !comp('Alça lateral'));
assert('gás soma em kg (0,25 + 0,5)', comp('Gás refrigerante R600a')?.qtd === 0.75 && comp('Gás refrigerante R600a')?.unidade === 'kg');
assert('termo sem vocabulário usa o componente gravado no item', comp('Peça avulsa')?.qtd === 1);
assert('inviável não entra no consumo', !c.porComponente.some(x => /Invi/.test(x.chave)));
assert('por família, separado por unidade', c.porFamilia.find(x => x.chave === 'Refrigeração' && x.unidade === 'un')?.qtd === 4 && c.porFamilia.find(x => x.unidade === 'kg')?.qtd === 0.75);
assert('por estabelecimento', c.porEstabelecimento.find(x => x.chave === 'Escola A' && x.unidade === 'un')?.qtd === 3);
assert('por TAG', c.porTag.find(x => x.chave === '6' && x.unidade === 'kg')?.qtd === 0.5);
assert('recorrência TAG × componente: puxador 2× na TAG 5 (mesclado conta junto)', c.recorrencia.length === 1 && c.recorrencia[0].tag === '5' && c.recorrencia[0].componente === 'Puxador' && c.recorrencia[0].registros === 2);
assert('quantidade com vírgula', ctx.fmt(0.75) === '0,75');
assert('sem vocabulário (rede falhou): ainda soma pelo item', ctx.consumo(regs, new Map()).porComponente.some(x => x.chave === 'Alça lateral' && x.qtd === 2));

const reg = fs.readFileSync(path.join(__dirname, 'registro.html'), 'utf8');
const rctx = {};
vm.createContext(rctx);
const i0 = reg.indexOf('function textoItemPdf');
vm.runInContext(reg.slice(i0, reg.indexOf('const _normFq')) + '\nthis.txt = textoItemPdf;', rctx);
assert('PDF: item de lista continua só com o nome', rctx.txt({ name: 'Limpeza', qty: 2, price: 10 }) === 'Limpeza');
assert('PDF: item de franquia com quantidade, unidade e descrição (sem preço)', rctx.txt({ qtd: 0.5, unidade: 'kg', descricao: 'Recarga · Gás R600a' }) === '0,5 kg — Recarga · Gás R600a');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
