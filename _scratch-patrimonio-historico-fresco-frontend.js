'use strict';
// Teste isolado da correção do bug de cache obsoleto em openEquipHistory
// (patrimonio.html): o histórico do equipamento lia chamados_list/
// registro_records/prev_plans do localStorage — escritos só pelas
// páginas DONAS de cada um — em vez de buscar fresco. Confere que agora
// busca as 3 coleções do servidor, de forma leve (?resumo=1, já escopado
// por ?contract=<um só>, igual os caches que substitui), e monta o
// histórico com o dado FRESCO, não o cache.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'patrimonio.html'), 'utf8');

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

console.log('── openEquipHistory busca as 3 coleções frescas, escopadas por contrato ──');
{
  const chamadasFeitas = [];
  const sandbox = {
    document: {
      getElementById: id => {
        if (id === 'hist-contrato') return { value: '95' };
        if (id === 'hist-tag') return { value: '0001' };
        return null;
      },
    },
    tagCanonicaPat: v => String(v || '').replace(/\D/g, '').padStart(4, '0'),
    tagTextoPat: e => String(e?.tag || ''),
    getEffDB: () => ({ '95': [{ tag: '0001', marca: 'X', tipo: 'Split' }] }),
    showToast: () => {},
    setActionBusy: () => () => {},
    movimentos: [],
    renderEquipHistoryModal: (equip, contrato, events) => { sandbox._eventosRenderizados = events; },
    DB: {
      getAll: async (col, qs) => {
        chamadasFeitas.push({ col, qs });
        if (col === 'chamados') return [{ client: '95', equip: '0001', createdAt: 1000, desc: 'Chamado fresco' }];
        if (col === 'registros') return [{ client: '95', equip: '0001', createdAt: 2000, items: [{ name: 'Troca fresca' }] }];
        return [];
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extraeFuncao(html, 'openEquipHistory') + '\n' +
    'this.openEquipHistory=openEquipHistory;',
    sandbox
  );

  return sandbox.openEquipHistory().then(() => {
    const porColecao = Object.fromEntries(chamadasFeitas.map(c => [c.col, c.qs]));
    assert('busca chamados com ?resumo=1 e ?contract=95 (escopado, leve)', /resumo=1/.test(porColecao.chamados) && /contract=95/.test(porColecao.chamados));
    assert('busca registros com ?resumo=1 e ?contract=95', /resumo=1/.test(porColecao.registros) && /contract=95/.test(porColecao.registros));
    assert('busca preventiva com ?resumo=1 e ?contract=95', /resumo=1/.test(porColecao.preventiva) && /contract=95/.test(porColecao.preventiva));
    assert('o chamado fresco (não vindo de cache) aparece no histórico', sandbox._eventosRenderizados.some(e => e.type === 'chamado' && e.desc === 'Chamado fresco'));
    assert('o registro fresco aparece no histórico', sandbox._eventosRenderizados.some(e => e.type === 'registro' && e.desc === 'Troca fresca'));

    console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
    process.exitCode = falhas === 0 ? 0 : 1;
  });
}
