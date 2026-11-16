'use strict';
// Prévia da importação de equipamentos (contratos.html) e checklist do
// plano (preventiva.html): apelidos novos, avisos e decisões.
const fs = require('fs'), path = require('path'), vm = require('vm');
let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

const apiClient = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');
const familias = apiClient.match(/\/\/ <familias>([\s\S]*?)\/\/ <\/familias>/)[1];
const contratos = fs.readFileSync(path.join(__dirname, 'contratos.html'), 'utf8');
const ini = contratos.indexOf('// ── Importação de equipamentos: apelidos de cabeçalho');
const fim = contratos.indexOf('let _importEquipPendente = null;');
assert('trecho da importação encontrado', ini > 0 && fim > ini);

const ctx = {
  pendingEquip: [{ tag: '1', estabelecimento: 'Escola Municipal Santa Rita', tipo: 'GELADEIRA' }],
  normalizarTagNumero: v => { const t = String(v ?? '').trim(); return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t; },
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
};
vm.createContext(ctx);
vm.runInContext(familias + '\n' + contratos.slice(ini, fim) +
  '\nthis.analisar = analisarImportEquip; this.alias = _resolverAliasesImportEquip; this.avisos = _avisosImportHtml;', ctx);

console.log('── Apelidos novos ──');
const l = ctx.alias({ tag: '5', fabricante: 'Consul', 'tensão': '220V', 'ant/nov': 'NOV', 'patrimônio': 'S/P' });
assert('FABRICANTE → marca', l.marca === 'Consul' && l.fabricante === undefined);
assert('TENSÃO → tensao', l.tensao === '220V');
assert('ANT/NOV → origemCadastro', l.origemCadastro === 'NOV');
assert('patrimônio "S/P" → vazio', l['patrimônio'] === '');
assert('patrimônio "-" → vazio', ctx.alias({ patrimonio: '-' }).patrimonio === '');
assert('patrimônio real preservado', ctx.alias({ patrimonio: '12345' }).patrimonio === '12345');

console.log('── Avisos e decisões ──');
const linhas = [
  { _linha: 2, tag: '10', tipo: 'GELADEIRA', estabelecimento: 'Escola Municipal Santa Rita' },
  { _linha: 3, tag: '010', tipo: 'FREEZER VERTICAL', estabelecimento: 'Escola Municipal Santa Rita' },
  { _linha: 4, tag: '', tipo: 'BEBEDOURO', estabelecimento: 'Escola Municipal Santa Rita' },
  { _linha: 5, tag: '11', tipo: 'TELEVISOR', estabelecimento: 'Esc. Municipal Santa Rita' },
  { _linha: 6, tag: '12', tipo: 'BALANÇA', estabelecimento: 'Creche Nova' },
];
const a = ctx.analisar(linhas);
assert('TAG duplicada na planilha (10 = 010) exige decisão', a.duplicadas.length === 1 && a.duplicadas[0].tag === '10' && a.duplicadas[0].idxs.join() === '0,1');
assert('linha sem TAG listada pelo número da linha', a.semTag.join() === '4');
assert('tipo sem família listado', a.semFamilia.join() === 'TELEVISOR');
const parecido = a.estabNovos.find(e => e.nome === 'Esc. Municipal Santa Rita');
assert('estabelecimento parecido sugere o existente', parecido?.sugestao === 'Escola Municipal Santa Rita');
assert('estabelecimento sem parecido fica sem sugestão', a.estabNovos.find(e => e.nome === 'Creche Nova')?.sugestao === null);
assert('sem coluna DESCRIÇÃO: nada a perguntar', a.descricaoComoMarca === null || a.descricaoComoMarca === undefined);
assert('aviso escapa texto da planilha', !ctx.avisos({ semTag: [], semFamilia: ['<img src=x>'], estabNovos: [] }).includes('<img'));

const soMarcas = ['Consul', 'Electrolux', 'Consul', 'Brastemp', 'Consul', 'Electrolux', 'Consul', 'Brastemp', 'Consul', 'Consul']
  .map((m, i) => ({ _linha: i + 2, tag: String(i + 1), 'descrição': m }));
assert('DESCRIÇÃO só com marcas é detectada', ctx.analisar(soMarcas).descricaoComoMarca === 'descrição');
const descricoes = soMarcas.map((x, i) => ({ ...x, 'descrição': 'Geladeira duplex 4' + i + '0 litros' }));
assert('DESCRIÇÃO com texto descritivo não é marca', !ctx.analisar(descricoes).descricaoComoMarca);
assert('com coluna marca preenchida, não pergunta', !ctx.analisar(soMarcas.map(x => ({ ...x, marca: 'X' }))).descricaoComoMarca);

console.log('── Checklist do plano (preventiva.html) ──');
const prev = fs.readFileSync(path.join(__dirname, 'preventiva.html'), 'utf8');
const pctx = {};
vm.createContext(pctx);
const iniC = prev.indexOf('const CHECKLIST = {');
const fimC = prev.indexOf('const LEVEL_LABEL');
vm.runInContext(prev.slice(iniC, fimC).replace('const CHECKLIST', 'var CHECKLIST'), pctx);
assert('plano sem cópia (contrato split): lista de split de sempre', pctx.itensChecklist({ level: 3 }, 2) === pctx.CHECKLIST[2]);
const copia = { checklist: { padrao: 'generico', itens: ['a', 'b'] } };
assert('plano com cópia: itens da cópia no nível 1', pctx.itensChecklist(copia, 1).join() === 'a,b');
assert('plano com cópia: níveis 2 e 3 sem itens extras', pctx.itensChecklist(copia, 2).length === 0 && pctx.itensChecklist(copia, 3).length === 0);

const rel = fs.readFileSync(path.join(__dirname, 'relatorio.html'), 'utf8');
const rctx = {};
vm.createContext(rctx);
vm.runInContext(rel.slice(rel.indexOf('const CHECKLIST = {'), rel.indexOf('const LEVEL_LABEL')).replace('const CHECKLIST', 'var CHECKLIST'), rctx);
assert('relatório: mesma regra (cópia do plano ou split)', rctx.itensChecklist(copia, 1).join() === 'a,b' && rctx.itensChecklist({}, 3) === rctx.CHECKLIST[3]);
assert('relatório: PDF da preventiva não lê mais CHECKLIST[n] direto', !/items:CHECKLIST\[/.test(rel) && !/items:CHECKLIST\[/.test(prev));

console.log(falhas ? `\n${falhas} falha(s)` : '\nTodos os testes passaram');
process.exit(falhas ? 1 : 0);
