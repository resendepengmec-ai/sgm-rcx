'use strict';
// Teste isolado da correção do bug de cache obsoleto em
// renderResponsaveisTab (index.html, aba Administração > Tomadores de
// Serviço): a aba nunca buscava contratos frescos do servidor, só lia
// smm_contracts no localStorage — deixado por outra página numa visita
// anterior. Confere que agora busca DB.getContratos() (completo, não
// ?resumo=1 — que descartaria "equipamentos") e usa o resultado FRESCO
// pra decidir quais contratos aparecem, não o cache velho.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

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

console.log('── renderResponsaveisTab busca contratos frescos, não só o cache ──');
{
  const ls = { _d: {}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; } };
  function safeLocalStorageGetJSON(key, fallback) { try { const v = ls.getItem(key); return v ? JSON.parse(v) : fallback; } catch(e){ return fallback; } }
  function safeLocalStorageSetJSON(key, value) { ls.setItem(key, JSON.stringify(value)); }

  // Cache ANTIGO (obsoleto): diz que o contrato 95 tem a opção LIGADA.
  ls.setItem('smm_contracts', JSON.stringify([{ numero:'95', razao:'Cliente X', assinaturaClientePorEstab:true }]));

  let chamouGetContratos = false, chamouGetResponsaveis = false;
  const sandbox = {
    document: { getElementById: () => null },
    safeLocalStorageGetJSON, safeLocalStorageSetJSON,
    DB: {
      // Dado FRESCO do servidor: a opção já foi desligada.
      getContratos: async () => { chamouGetContratos = true; return [{ numero:'95', razao:'Cliente X', assinaturaClientePorEstab:false }]; },
      getResponsaveis: async () => { chamouGetResponsaveis = true; return []; },
    },
    esc: s => String(s),
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extraeFuncao(html, 'renderResponsaveisTab') + '\n' +
    'this.renderResponsaveisTab=renderResponsaveisTab;',
    sandbox
  );

  const el = { set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } };

  return sandbox.renderResponsaveisTab(el).then(() => {
    assert('chama DB.getContratos() (não só lê o cache)', chamouGetContratos);
    assert('chama DB.getResponsaveis()', chamouGetResponsaveis);
    assert('grava o resultado fresco em smm_contracts', JSON.parse(ls.getItem('smm_contracts'))[0].assinaturaClientePorEstab === false);
    // A prova real do bug corrigido: a aba usa o dado FRESCO (desligado),
    // não o cache antigo (ligado) — então não oferece mais o contrato 95
    // como opção de "tomador de serviço".
    assert('a aba NÃO lista mais o contrato 95 (opção já desligada no servidor)', !el.innerHTML.includes('Cliente X'));

    console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
    process.exitCode = falhas === 0 ? 0 : 1;
  });
}
