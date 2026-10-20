'use strict';
// Teste isolado do filtro por contrato e da correção do bug de cache
// obsoleto em recebimento.html: a página nunca buscava contratos frescos
// do servidor, só lia o que já estivesse em smm_contracts (deixado por
// OUTRA página numa visita anterior) — em produção, o botão "Pegar
// assinatura" ficava disponível pra contrato que já tinha a opção
// desligada, porque _contratoAssinaturaOn lia o cache velho.
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
  const re = new RegExp(`const ${nome}\\s*=\\s*`);
  const m = re.exec(src);
  if (!m) throw new Error('const não encontrada: ' + nome);
  const abre = src[m.index + m[0].length];
  const fecha = abre === '[' ? ']' : '}';
  let i = m.index + m[0].length, depth = 0;
  do {
    if (src[i] === abre) depth++;
    else if (src[i] === fecha) depth--;
    i++;
  } while (depth > 0);
  if (src[i] === ';') i++;
  return src.slice(m.index, i);
}

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

console.log('── 1. A página busca contratos FRESCOS do servidor no carregamento ──');
{
  // Mesma checagem de regressão que garante que registro.html/
  // preventiva.html já fazem — e que faltava aqui.
  const temBusca = /DB\.getContratos\(\)/.test(html) && /safeLocalStorageSetJSON\('smm_contracts'/.test(html);
  assert('chama DB.getContratos() e grava em smm_contracts (não só lê o cache)', temBusca);
}

console.log('── 2. Filtro por contrato: _itensAssinaveis respeita _fContract ──');
{
  const ls = { _d: {}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; } };
  function safeLocalStorageGetJSON(key, fallback) {
    try { const v = ls.getItem(key); return v ? JSON.parse(v) : fallback; } catch(e) { return fallback; }
  }
  const sandbox = { localStorage: ls, safeLocalStorageGetJSON, getEffDB: () => ({}), normalizarTagNumero: v => String(v||'') };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    extraeConst(html, 'LEVEL_LABEL') + '\n' +
    extraeFuncao(html, '_contratoAssinaturaOn') + '\n' +
    extraeFuncao(html, '_resolveEstab') + '\n' +
    extraeFuncao(html, '_getLevelsFor') + '\n' +
    extraeFuncao(html, '_isEquipDone') + '\n' +
    extraeFuncao(html, '_itensAssinaveis') + '\n' +
    'this._itensAssinaveis=_itensAssinaveis; this.setFContract=v=>{_fContract=v;};',
    sandbox
  );

  sandbox.localStorage.setItem('smm_contracts', JSON.stringify([
    { numero: '95', assinaturaClientePorEstab: true },
    { numero: '96', assinaturaClientePorEstab: true },
  ]));
  sandbox._ordensCache = [
    { id:'os-95', numero:'1', status:'concluida', contrato:'95', machine:{estabelecimento:'A'} },
    { id:'os-96', numero:'2', status:'concluida', contrato:'96', machine:{estabelecimento:'B'} },
  ];
  sandbox._plansCache = [];

  sandbox.setFContract('');
  assert('sem filtro: vê os 2 contratos', sandbox._itensAssinaveis().length === 2);

  sandbox.setFContract('95');
  const so95 = sandbox._itensAssinaveis();
  assert('filtro "95": só o item do contrato 95', so95.length === 1 && so95[0].contract === '95');

  sandbox.setFContract('96');
  const so96 = sandbox._itensAssinaveis();
  assert('filtro "96": só o item do contrato 96', so96.length === 1 && so96[0].contract === '96');
}

console.log('── 3. Bug do cache obsoleto: sem o fetch fresco, a opção desligada recentemente ainda passaria ──');
{
  // Simula exatamente o cenário do bug: smm_contracts no localStorage
  // ainda tem a opção LIGADA (cache de uma visita anterior a OUTRA
  // página), mas o servidor (não consultado aqui de propósito, pra
  // isolar o teste) já teria a opção desligada. _contratoAssinaturaOn
  // sempre confia no que está no localStorage — por isso o fetch fresco
  // no carregamento da página (item 1 acima) é o que fecha o bug, não
  // uma mudança nesta função.
  const ls = { _d: {}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; } };
  function safeLocalStorageGetJSON(key, fallback) {
    try { const v = ls.getItem(key); return v ? JSON.parse(v) : fallback; } catch(e) { return fallback; }
  }
  const sandbox = { localStorage: ls, safeLocalStorageGetJSON };
  vm.createContext(sandbox);
  vm.runInContext(extraeFuncao(html, '_contratoAssinaturaOn') + '\nthis._contratoAssinaturaOn=_contratoAssinaturaOn;', sandbox);

  sandbox.localStorage.setItem('smm_contracts', JSON.stringify([{ numero:'95', assinaturaClientePorEstab:true }]));
  assert('com cache desatualizado (opção ainda ligada), a função confia nele — por isso o fetch fresco é obrigatório', sandbox._contratoAssinaturaOn('95') === true);

  sandbox.localStorage.setItem('smm_contracts', JSON.stringify([{ numero:'95', assinaturaClientePorEstab:false }]));
  assert('com o cache atualizado (opção desligada), a função já reflete corretamente', sandbox._contratoAssinaturaOn('95') === false);
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
