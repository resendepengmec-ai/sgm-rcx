'use strict';
// Mesmo bug do módulo "registros" (ver _scratch-pdf-fotos-registro-
// frontend.js), encontrado por extensão da auditoria no módulo
// "chamados": `chamados` vem de GET /chamados?resumo=1, que o backend
// devolve SEMPRE com photos:[] (só photoCount — resumirRegistro em
// api.js). printFilteredPDF/printPDF mediam c.photos.length direto nessa
// lista leve, então o relatório e o PDF individual nunca incluíam foto
// nenhuma. Mesma correção aplicada: hidrata via DB.getRecord (mesmo
// mecanismo de _hidratarChamado) antes de montar o PDF.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'chamados.html'), 'utf8');

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

function montarSandbox({ dbRecords, chamadosFixture }) {
  const chamadasGetRecord = [];
  const chamadasProcessarFoto = [];
  const estado = { totalFotosSessao: null, cancelarNaIteracao: -1, iterAtual: 0, finalizou: false, toasts: [] };

  const sandbox = {
    console,
    chamados: chamadosFixture,
    filterMonth: '', filterContract: '', filterEstab: '', filterStatus: '',
    window: {},
    showToast: (msg) => { estado.toasts.push(msg); },
    safeLocalStorageGetJSON: () => [],
    safeLocalStorageSetJSON: () => { estado.salvou = true; },
    esc: s => String(s ?? ''),
    fmtDate: s => String(s ?? ''),
    PRIORITY_MAP: { normal: { label: 'Normal' }, urgente: { label: 'Urgente' }, alta: { label: 'Alta' }, baixa: { label: 'Baixa' } },
    STATUS_MAP: { aberto: { label: 'Aberto' }, resolvido: { label: 'Resolvido' } },
    sigTrailPdfLines: () => [],
    drawPdfHeader: () => 30,
    drawPdfFooters: () => {},
    closeDetailModal: () => {},
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
    extraeFuncao(html, 'getFiltered') + '\n' +
    extraeFuncao(html, 'printFilteredPDF') + '\n' +
    extraeFuncao(html, 'printPDF') + '\n' +
    'this.getFiltered=getFiltered; this.printFilteredPDF=printFilteredPDF; this.printPDF=printPDF;',
    sandbox
  );
  return { sandbox, chamadasGetRecord, chamadasProcessarFoto, estado };
}

(async () => {
  console.log('── printFilteredPDF (chamados): hidrata fotos vindas da lista leve (?resumo=1) antes de montar o relatório ──');
  {
    const lista = [
      { id: 'c1', date: '2026-10-01', createdAt: 1, client: 'C1', priority: 'normal', photos: [], photoCount: 2 },
      { id: 'c2', date: '2026-10-02', createdAt: 2, client: 'C1', priority: 'normal', photos: [], photoCount: 0 },
      { id: 'c3', date: '2026-10-03', createdAt: 3, client: 'C1', priority: 'normal', photos: [{ ref: 'foto-ja-carregada' }], photoCount: 1, _detailLoaded: true },
    ];
    const dbRecords = { c1: { id: 'c1', photos: [{ ref: 'foto-real-1' }, { ref: 'foto-real-2' }] } };
    const { sandbox, chamadasGetRecord, chamadasProcessarFoto, estado } =
      montarSandbox({ dbRecords, chamadosFixture: lista });

    await sandbox.printFilteredPDF();

    assert('hidrata só o c1 (único com photoCount>0 e photos vazio)',
      chamadasGetRecord.length === 1 && chamadasGetRecord[0].id === 'c1' && chamadasGetRecord[0].col === 'chamados');
    assert('totalFotos da sessão soma photoCount de todos (2+0+1=3)', estado.totalFotosSessao === 3);
    assert('chamado c1 na lista `chamados` fica com as 2 fotos reais após a hidratação',
      sandbox.chamados.find(c => c.id === 'c1').photos.length === 2);
    assert('monta 3 fotos no PDF (2 recém-hidratadas de c1 + 1 de c3)', chamadasProcessarFoto.length === 3);
    assert('persiste a hidratação localmente', estado.salvou === true);
    assert('a sessão pdf-seguro é finalizada ao final', estado.finalizou === true);
  }

  console.log('── printFilteredPDF (chamados): cancelamento durante a hidratação interrompe sem montar o PDF ──');
  {
    const lista = [
      { id: 'c1', date: '2026-10-01', createdAt: 1, client: 'C1', priority: 'normal', photos: [], photoCount: 1 },
      { id: 'c2', date: '2026-10-02', createdAt: 2, client: 'C1', priority: 'normal', photos: [], photoCount: 1 },
    ];
    const dbRecords = { c1: { id: 'c1', photos: [{ ref: 'foto-1' }] }, c2: { id: 'c2', photos: [{ ref: 'foto-2' }] } };
    const { sandbox, chamadasGetRecord, chamadasProcessarFoto, estado } =
      montarSandbox({ dbRecords, chamadosFixture: lista });
    estado.cancelarNaIteracao = 0;
    await sandbox.printFilteredPDF();
    assert('cancela antes de hidratar todos', chamadasGetRecord.length < lista.length);
    assert('nunca monta fotos após cancelar', chamadasProcessarFoto.length === 0);
    assert('mostra o toast de geração cancelada', estado.toasts.some(t => /cancelad/i.test(t)));
  }

  console.log('── printPDF individual (chamados): rede de segurança hidrata se _hidratarChamado ainda não tinha carregado ──');
  {
    const lista = [{ id: 'c1', date: '2026-10-01', client: 'C1', priority: 'normal', photos: [], photoCount: 3 }];
    const dbRecords = { c1: { id: 'c1', photos: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }] } };
    const { sandbox, chamadasGetRecord, chamadasProcessarFoto } =
      montarSandbox({ dbRecords, chamadosFixture: lista });

    await sandbox.printPDF('c1');

    assert('busca o detalhe completo antes de montar o PDF individual', chamadasGetRecord.length === 1 && chamadasGetRecord[0].id === 'c1');
    assert('atualiza `chamados` com as fotos reais', sandbox.chamados.find(c => c.id === 'c1').photos.length === 3);
    assert('monta as 3 fotos reais no PDF individual (não 0)', chamadasProcessarFoto.length === 3);
  }

  console.log('── printPDF individual (chamados): chamado já hidratado não refaz a chamada ──');
  {
    const lista = [{ id: 'c1', date: '2026-10-01', client: 'C1', priority: 'normal', photos: [{ ref: 'já-tinha' }], photoCount: 1, _detailLoaded: true }];
    const { sandbox, chamadasGetRecord, chamadasProcessarFoto } =
      montarSandbox({ dbRecords: {}, chamadosFixture: lista });

    await sandbox.printPDF('c1');

    assert('não chama DB.getRecord de novo', chamadasGetRecord.length === 0);
    assert('ainda monta a foto que já tinha', chamadasProcessarFoto.length === 1);
  }

  console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
  process.exitCode = falhas === 0 ? 0 : 1;
})().catch(e => { console.error('ERRO:', e); process.exitCode = 1; });
