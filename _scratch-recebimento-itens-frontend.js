'use strict';
// Teste isolado da lógica de agrupamento de recebimento.html —
// _itensAssinaveis() precisa unificar O.S. (registros) e equipamentos de
// preventiva concluídos, SEM NUNCA misturar os dois tipos num mesmo grupo
// (o backend rejeita uma solicitação com osIds e preventivaRefs juntos).
// Mesmo padrão de extração por regex + vm já usado nos outros
// _scratch-*-frontend.js, com um stub mínimo de localStorage/getEffDB.
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
function extraeConst(src, nome) {
  const re = new RegExp(`const ${nome}\\s*=\\s*\\{[\\s\\S]*?\\};`);
  const m = re.exec(src);
  if (!m) throw new Error('const não encontrada: ' + nome);
  return m[0];
}

// localStorage mínimo — só getItem, igual ao que safeLocalStorageGetJSON
// (api-client.js, não extraída aqui) precisaria; aqui é substituída por
// uma versão simplificada equivalente.
function safeLocalStorageGetJSON(key, fallback) {
  try { const v = sandbox.localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}

const sandbox = {
  localStorage: { _d: {}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; } },
  safeLocalStorageGetJSON,
  getEffDB: () => ({}),
  normalizarTagNumero: v => String(v||''),
};
sandbox.window = sandbox; // _itensAssinaveis lê window._ordensCache/window._plansCache
vm.createContext(sandbox);
vm.runInContext(
  extraeConst(html, 'LEVEL_LABEL') + '\n' +
  extraeFuncao(html, '_contratoAssinaturaOn') + '\n' +
  extraeFuncao(html, '_resolveEstab') + '\n' +
  extraeFuncao(html, '_getLevelsFor') + '\n' +
  extraeFuncao(html, '_isEquipDone') + '\n' +
  extraeFuncao(html, '_itensAssinaveis') + '\n' +
  'this._itensAssinaveis=_itensAssinaveis;',
  sandbox
);

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

function contratosComAssinatura(numeros) {
  sandbox.localStorage.setItem('smm_contracts', JSON.stringify(
    numeros.map(n => ({ numero: n, assinaturaClientePorEstab: true }))));
}

console.log('── _itensAssinaveis: unifica O.S. e equipamentos de preventiva ──');
{
  contratosComAssinatura(['95']);
  sandbox._ordensCache = [
    { id:'os-1', numero:'1001', status:'concluida', contrato:'95', machine:{estabelecimento:'Unidade Central'} },
    { id:'os-2', numero:'1002', status:'aberta',    contrato:'95', machine:{estabelecimento:'Unidade Central'} }, // não concluída
  ];
  sandbox._plansCache = [
    { id:'plan-1', client:'95', level:1, equipments:[
      { tag:'TAG-A', estabelecimento:'Unidade Central', checks:{1:true} },  // concluído
      { tag:'TAG-B', estabelecimento:'Unidade Central', checks:{} },         // não concluído
    ]},
  ];
  const itens = sandbox._itensAssinaveis();
  assert('só entra o que está concluído (1 O.S. + 1 equipamento, não 2+2)', itens.length === 2);
  assert('item de O.S. tem tipo "os"', itens.some(i => i.tipo==='os' && i.id==='os-1'));
  assert('item de preventiva tem tipo "prev"', itens.some(i => i.tipo==='prev' && i.tag==='TAG-A'));
}

console.log('── contrato sem a opção de assinatura ligada: nada aparece ──');
{
  contratosComAssinatura([]); // '95' sem a opção ligada
  sandbox._ordensCache = [{ id:'os-1', numero:'1001', status:'concluida', contrato:'95', machine:{estabelecimento:'X'} }];
  sandbox._plansCache = [{ id:'plan-1', client:'95', level:1, equipments:[{ tag:'T', estabelecimento:'X', checks:{1:true} }] }];
  assert('nenhum item, mesmo com O.S./equipamento concluídos', sandbox._itensAssinaveis().length === 0);
}

console.log('── mesmo estabelecimento com O.S. E preventiva: nunca mistura tipo na mesma chave de grupo ──');
{
  contratosComAssinatura(['95']);
  sandbox._ordensCache = [{ id:'os-1', numero:'1001', status:'concluida', contrato:'95', machine:{estabelecimento:'Unidade Central'} }];
  sandbox._plansCache = [{ id:'plan-1', client:'95', level:1, equipments:[{ tag:'TAG-A', estabelecimento:'Unidade Central', checks:{1:true} }] }];
  const itens = sandbox._itensAssinaveis();
  // Reproduz a mesma lógica de chave usada em abrirEnvioAssinatura().
  const grupos = {};
  itens.forEach(it => { const key = it.tipo+'||'+it.contract+'||'+it.estab; (grupos[key]=grupos[key]||[]).push(it); });
  const chaves = Object.keys(grupos);
  assert('2 itens do mesmo estabelecimento geram 2 grupos (um por tipo), nunca 1 misto', chaves.length === 2);
  assert('nenhum grupo mistura tipos', chaves.every(k => new Set(grupos[k].map(i=>i.tipo)).size === 1));
}

console.log('── nível 2+: só conta "concluído" quando TODOS os níveis até ele estão marcados ──');
{
  contratosComAssinatura(['95']);
  sandbox._ordensCache = [];
  sandbox._plansCache = [{ id:'plan-2', client:'95', level:2, equipments:[
    { tag:'TAG-C', estabelecimento:'Unidade Central', checks:{1:true} },        // só nível 1, plano é nível 2 → não concluído
    { tag:'TAG-D', estabelecimento:'Unidade Central', checks:{1:true,2:true} }, // concluído
  ]}];
  const itens = sandbox._itensAssinaveis();
  assert('equipamento com só o nível 1 marcado, em plano de nível 2, não entra', !itens.some(i=>i.tag==='TAG-C'));
  assert('equipamento com todos os níveis marcados entra', itens.some(i=>i.tag==='TAG-D'));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
