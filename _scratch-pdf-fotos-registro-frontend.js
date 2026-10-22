'use strict';
// Bug corrigido: PDFs do módulo "registros" (relatório consolidado e PDF
// individual) não levavam as fotos dos registros. Causa raiz: a lista
// `records` vem de GET /registros?resumo=1, que o backend devolve SEMPRE
// com photos:[] (só photoCount — resumirRegistro em api.js, leve de
// propósito pra lista). printFilteredPDF/printPDF mediam r.photos.length
// direto nessa lista leve, então o relatório nunca incluía foto nenhuma.
// Este teste roda as funções REAIS extraídas de registro.html (não uma
// reimplementação) com um DB.getRecord mockado, pra provar que agora elas
// hidratam cada registro (via DB.getRecord, mesmo mecanismo já usado por
// _hidratarRegistro ao abrir o detalhe de UM registro) antes de montar o
// PDF, e que as fotos reais chegam até a seção de montagem.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'registro.html'), 'utf8');

function extraeFuncao(src, nome) {
  const reInicio = new RegExp(`(?:async\\s+)?function ${nome}\\s*\\(`);
  const mInicio = reInicio.exec(src);
  if (!mInicio) throw new Error('função não encontrada: ' + nome);
  let i = mInicio.index + mInicio[0].length, profParen = 1;
  while (profParen > 0) {
    if (src[i] === '(') profParen++;
    else if (src[i] === ')') profParen--;
    i++;
  }
  while (src[i] !== '{') i++;
  let depth = 1; i++;
  while (depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(mInicio.index, i);
}

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

// jsPDF falso: só precisa não quebrar e devolver valores plausíveis pros
// poucos métodos cujo RETORNO a função real usa (getTextWidth,
// splitTextToSize, internal.getNumberOfPages) — o resto (rect/text/
// setFont/addImage/addPage/…) é desenho puro, irrelevante pra este teste.
function criarFakeJsPDF() {
  return function FakeJsPDF() {
    return new Proxy({
      internal: { getNumberOfPages: () => 1 },
      getTextWidth: t => String(t).length * 2,
      splitTextToSize: t => [String(t)],
      output: () => new ArrayBuffer(0),
      save: () => {},
    }, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => target;
      },
    });
  };
}

function montarSandbox({ dbRecords, registrosFixture }) {
  const chamadasGetRecord = [];
  const chamadasProcessarFoto = [];
  const estado = { totalFotosSessao: null, cancelarNaIteracao: -1, iterAtual: 0, finalizou: false, toasts: [] };

  const sandbox = {
    console,
    records: registrosFixture,
    filterMonth: '', filterContract: '', filterEstab: '',
    window: {},
    showToast: (msg) => { estado.toasts.push(msg); },
    safeLocalStorageGetJSON: () => [],
    saveRegistrosLocal: () => { estado.salvou = true; },
    esc: s => String(s ?? ''),
    resolveEstab: r => (r.machine && r.machine.estabelecimento) || '',
    prazoDias: () => null,
    fmtDias: () => '',
    fmtPrazo: () => '—',
    prazoStats: () => ({}),
    _pdfRecordSigs: (doc, sigs, M, y) => y,
    _pdfPhotoSigs: (doc, photos, M, y) => y,
    drawPdfHeader: () => 30,
    drawPdfFooters: () => {},
    closeDetailModal: () => {},
    INVIAVEL_NOTE: 'inviável',
    DB: {
      getRecord: async (col, id) => {
        chamadasGetRecord.push({ col, id });
        return dbRecords[id] || null;
      },
    },
    iniciarSessaoPdf: ({ totalFotos }) => {
      estado.totalFotosSessao = totalFotos;
      estado.iterAtual = 0;
      return {
        get cancelada() { return estado.cancelarNaIteracao >= 0 && estado.iterAtual > estado.cancelarNaIteracao; },
        abrir: async () => {},
        etapaPrecalculo: () => { estado.iterAtual++; },
        etapaRegistros: () => {},
        etapaMontagem: () => {},
        etapaSaida: () => {},
        finalizar: async () => { estado.finalizou = true; },
        desenharFotoIndisponivel: () => {},
        processarFoto: async (ref) => {
          chamadasProcessarFoto.push(ref);
          return { bytes: 'FAKE', w: 100, h: 75, falhou: false };
        },
      };
    },
  };
  sandbox.window.jspdf = { jsPDF: criarFakeJsPDF() };
  vm.createContext(sandbox);
  vm.runInContext(
    extraeFuncao(html, 'getFilteredRecords') + '\n' +
    extraeFuncao(html, 'printFilteredPDF') + '\n' +
    extraeFuncao(html, 'printPDF') + '\n' +
    'this.getFilteredRecords=getFilteredRecords; this.printFilteredPDF=printFilteredPDF; this.printPDF=printPDF;',
    sandbox
  );
  return { sandbox, chamadasGetRecord, chamadasProcessarFoto, estado };
}

(async () => {
  console.log('── printFilteredPDF: hidrata fotos de registros vindos da lista leve (?resumo=1) antes de montar o relatório ──');
  {
    // r1: lista leve típica (photoCount>0, photos:[] — exatamente o shape
    // que vem de GET /registros?resumo=1). r2: sem foto nenhuma
    // (photoCount 0) — não deve gerar chamada de hidratação. r3: já tinha
    // sido aberto no detalhe antes (_detailLoaded, fotos reais já
    // carregadas) — não deve re-hidratar.
    const registros = [
      { id: 'r1', date: '2026-10-01', createdAt: 1, client: 'C1', items: [], photos: [], photoCount: 2 },
      { id: 'r2', date: '2026-10-02', createdAt: 2, client: 'C1', items: [], photos: [], photoCount: 0 },
      { id: 'r3', date: '2026-10-03', createdAt: 3, client: 'C1', items: [], photos: [{ ref: 'foto-ja-carregada' }], photoCount: 1, _detailLoaded: true },
    ];
    const dbRecords = {
      r1: { id: 'r1', photos: [{ ref: 'foto-real-1' }, { ref: 'foto-real-2' }] },
    };
    const { sandbox, chamadasGetRecord, chamadasProcessarFoto, estado } =
      montarSandbox({ dbRecords, registrosFixture: registros });

    await sandbox.printFilteredPDF();

    assert('hidrata só o r1 (único com photoCount>0 e photos vazio)',
      chamadasGetRecord.length === 1 && chamadasGetRecord[0].id === 'r1' && chamadasGetRecord[0].col === 'registros');
    assert('totalFotos da sessão soma photoCount de todos (2+0+1=3), não photos.length da lista leve (seria 1)',
      estado.totalFotosSessao === 3);
    assert('registro r1 na lista `records` fica com as 2 fotos reais após a hidratação',
      sandbox.records.find(r => r.id === 'r1').photos.length === 2);
    assert('r1 marcado como _detailLoaded após hidratar (mesmo padrão de _hidratarRegistro)',
      sandbox.records.find(r => r.id === 'r1')._detailLoaded === true);
    assert('monta as fotos de TODOS os registros no PDF: 2 (r1, recém-hidratadas) + 1 (r3, já tinha) = 3 chamadas a processarFoto',
      chamadasProcessarFoto.length === 3);
    assert('as fotos processadas são as reais vindas do DB.getRecord, não um array vazio',
      chamadasProcessarFoto.some(p => p.ref === 'foto-real-1') && chamadasProcessarFoto.some(p => p.ref === 'foto-real-2'));
    assert('persiste a hidratação localmente (saveRegistrosLocal chamado)', estado.salvou === true);
    assert('a sessão pdf-seguro é finalizada ao final (finally)', estado.finalizou === true);
  }

  console.log('── printFilteredPDF: registro sem foto nenhuma não gera chamada ao servidor ──');
  {
    const registros = [
      { id: 'r1', date: '2026-10-01', createdAt: 1, client: 'C1', items: [], photos: [], photoCount: 0 },
    ];
    const { sandbox, chamadasGetRecord, chamadasProcessarFoto } =
      montarSandbox({ dbRecords: {}, registrosFixture: registros });
    await sandbox.printFilteredPDF();
    assert('nenhuma chamada de hidratação quando nenhum registro tem foto', chamadasGetRecord.length === 0);
    assert('nenhuma chamada a processarFoto', chamadasProcessarFoto.length === 0);
  }

  console.log('── printFilteredPDF: cancelamento durante a hidratação interrompe sem montar o PDF ──');
  {
    const registros = [
      { id: 'r1', date: '2026-10-01', createdAt: 1, client: 'C1', items: [], photos: [], photoCount: 1 },
      { id: 'r2', date: '2026-10-02', createdAt: 2, client: 'C1', items: [], photos: [], photoCount: 1 },
    ];
    const dbRecords = {
      r1: { id: 'r1', photos: [{ ref: 'foto-1' }] },
      r2: { id: 'r2', photos: [{ ref: 'foto-2' }] },
    };
    const { sandbox, chamadasGetRecord, chamadasProcessarFoto, estado } =
      montarSandbox({ dbRecords, registrosFixture: registros });
    estado.cancelarNaIteracao = 0; // cancela logo após processar a 1ª iteração
    await sandbox.printFilteredPDF();
    assert('cancela antes de hidratar todos (não chega no r2)', chamadasGetRecord.length < registros.length);
    assert('nunca monta fotos no PDF após cancelar', chamadasProcessarFoto.length === 0);
    assert('mostra o toast de geração cancelada', estado.toasts.some(t => /cancelad/i.test(t)));
  }

  console.log('── printPDF (individual): rede de segurança hidrata se _hidratarRegistro (fire-and-forget) ainda não tinha carregado ──');
  {
    const registros = [
      { id: 'r1', date: '2026-10-01', client: 'C1', items: [], photos: [], photoCount: 3 },
    ];
    const dbRecords = {
      r1: { id: 'r1', photos: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }] },
    };
    const { sandbox, chamadasGetRecord, chamadasProcessarFoto } =
      montarSandbox({ dbRecords, registrosFixture: registros });

    await sandbox.printPDF('r1');

    assert('busca o detalhe completo antes de montar o PDF individual', chamadasGetRecord.length === 1 && chamadasGetRecord[0].id === 'r1');
    assert('atualiza `records` com as fotos reais', sandbox.records.find(r => r.id === 'r1').photos.length === 3);
    assert('monta as 3 fotos reais no PDF individual (não 0)', chamadasProcessarFoto.length === 3);
  }

  console.log('── printPDF (individual): registro já hidratado não refaz a chamada ao servidor ──');
  {
    const registros = [
      { id: 'r1', date: '2026-10-01', client: 'C1', items: [], photos: [{ ref: 'já-tinha' }], photoCount: 1, _detailLoaded: true },
    ];
    const { sandbox, chamadasGetRecord, chamadasProcessarFoto } =
      montarSandbox({ dbRecords: {}, registrosFixture: registros });

    await sandbox.printPDF('r1');

    assert('não chama DB.getRecord de novo (já tinha fotos reais)', chamadasGetRecord.length === 0);
    assert('ainda monta a foto que já tinha', chamadasProcessarFoto.length === 1);
  }

  console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
  process.exitCode = falhas === 0 ? 0 : 1;
})().catch(e => { console.error('ERRO:', e); process.exitCode = 1; });
