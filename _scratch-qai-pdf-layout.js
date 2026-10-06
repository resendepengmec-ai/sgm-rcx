'use strict';
// Testes do PDF do sensor e das duas visões do modal, executando o código
// REAL de qai.html com jsPDF vendorizado no Node. Não há navegador: o
// gráfico (canvas) é pulado, e DB.getLeiturasQai é um stub que filtra por
// desde/ate como o servidor faz (mais recente primeiro).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'qai.html'), 'utf8');
const codigo = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

const jspdfMod = require(path.join(__dirname, 'vendor', 'jspdf.umd.min.js'));
const JsPDF = jspdfMod.jsPDF || (jspdfMod.jspdf && jspdfMod.jspdf.jsPDF);

let falhas = 0;
function assert(desc, cond) {
  if (cond) console.log('  ✓', desc);
  else { console.log('  ✗', desc); falhas++; }
}
function textoPdf(doc) { return Buffer.from(doc.output('arraybuffer')).toString('latin1'); }

let docGerado = null;
const apiSave = JsPDF.API || JsPDF.prototype;
apiSave.save = function () { docGerado = this; };

// Base de leituras do stub (cronológica). O stub responde como o servidor:
// filtra por desde/ate e devolve mais recente primeiro.
let LEIT_STUB = [];
const stubEl = { style: {}, innerHTML: '', classList: { add() {}, remove() {}, toggle() {} } };
const sandbox = {
  console,
  document: { getElementById: () => stubEl, querySelector: () => null },
  guardaDeModulo: async () => null,
  esc: s => String(s ?? ''),
  withActionBusy: async (btn, label, task) => task(),
  Chart: function (ctx, cfg) { this.cfg = cfg; this.destroy = () => {}; (sandbox.__charts = sandbox.__charts || []).push(this); },
  DB: {
    getLeiturasQai: async (id, q) => {
      const p = new URLSearchParams(q.replace(/^\?/, ''));
      const desde = Number(p.get('desde') || 0), ate = Number(p.get('ate') || Infinity);
      const limite = Number(p.get('limite') || 1000);
      return LEIT_STUB.filter(l => l.criadoEm >= desde && l.criadoEm <= ate)
        .sort((a, b) => b.criadoEm - a.criadoEm).slice(0, limite);
    },
  },
  setTimeout: () => 0,
};
sandbox.window = sandbox;
sandbox.window.jspdf = { jsPDF: JsPDF };
vm.createContext(sandbox);
vm.runInContext(codigo, sandbox, { filename: 'qai.html-inline-script.js' });

// Leituras em horário LOCAL (como o servidor/navegador veem o dia).
function preparar(numLeituras) {
  LEIT_STUB = Array.from({ length: numLeituras }, (_, i) => ({
    id: 'l' + i,
    criadoEm: new Date(2026, 9, 1, 0, 0).getTime() + i * 3600000,
    valores: { temp_current: 22 + (i % 5), humidity_value: 55 + (i % 7) },
    conforme: (i % 5) < 4,
  }));
  vm.runInContext(`
    user = { name: 'Teste Gestor' };
    CONTRATOS = [{ numero: '1020', razao: 'Cliente A', art: 'ART-123' }];
    PRESTADORA = { company: 'Empresa Teste Ltda', address: 'Rua Exemplo, 100', cnpj: '00.000.000/0001-00' };
    SENSOR_ABERTO = {
      id: 's1', contrato: '1020', estabelecimento: 'Unidade A', recinto: 'Sala 1', sensorAtivo: true,
      horarios: ['08:00', '20:00'],
      limites: { temp_current: { min: 20, max: 26 } },
      grandezasAtivas: {
        temp_current: { tipo: 'temperatura', rotulo: 'Temperatura', unidade: '°C', scale: 1 },
        humidity_value: { tipo: 'umidade', rotulo: 'Umidade relativa', unidade: '%', scale: 0 },
      },
    };
    DASH_LINHA = { telemetriaAoVivo: { valores: { temp_current: 26.2, humidity_value: 62 }, recebidoEm: Date.now() } };
    LEITURAS_ABERTO = [];
  `, sandbox);
}
const PERIODO_TODO = { de: '2026-10-01', ate: '2026-10-06' };

(async () => {
  console.log('── PDF de um dia: cabeçalho, rodapé e avaliação ──');
  preparar(12);
  docGerado = null;
  await sandbox.gerarPdfSensor({}, { de: '2026-10-01', ate: '2026-10-01' });
  assert('gera um documento', docGerado !== null);
  const pequeno = textoPdf(docGerado);
  assert('rodapé com "Gerado em"', pequeno.includes('Gerado em'));
  assert('rodapé com paginação "Página 1 de 1"', pequeno.includes('Página 1 de 1'));
  assert('linha do contratante (razão e ART) no rodapé', pequeno.includes('Cliente A') && pequeno.includes('ART-123'));
  assert('cabeçalho com nome da empresa', pequeno.includes('Empresa Teste Ltda'));
  assert('cabeçalho com o período selecionado', pequeno.includes('Período: 01/10/2026'));
  assert('seção de resumo por grandeza', pequeno.includes('Resumo por grandeza'));
  assert('coluna "Fora do limite" no resumo', pequeno.includes('Fora do limite'));

  console.log('── PDF de período com várias leituras: quebra de página ──');
  preparar(120);
  docGerado = null;
  await sandbox.gerarPdfSensor({}, PERIODO_TODO);
  const paginas = docGerado.internal.getNumberOfPages();
  assert('120 leituras geram várias páginas', paginas >= 3);
  const grande = textoPdf(docGerado);
  assert('paginação correta no total final', grande.includes(`Página ${paginas} de ${paginas}`));
  assert('cabeçalho mostra período de dois dias', grande.includes('Período: 01/10/2026 a 06/10/2026'));

  console.log('── seleção de grandezas: só as escolhidas entram no PDF ──');
  preparar(12);
  docGerado = null;
  await sandbox.gerarPdfSensor({}, { de: '2026-10-01', ate: '2026-10-01', codigos: ['temp_current'] });
  const soTemp = textoPdf(docGerado);
  assert('grandeza escolhida aparece no resumo', soTemp.includes('Temperatura'));
  assert('grandeza não escolhida fica de fora', !soTemp.includes('Umidade relativa'));

  console.log('── período sem leituras: PDF informativo, sem quebrar ──');
  preparar(3);
  docGerado = null;
  await sandbox.gerarPdfSensor({}, { de: '2025-01-01', ate: '2025-01-02' });
  assert('gera PDF mesmo sem leituras no período', docGerado !== null);
  assert('informa que não há leituras', textoPdf(docGerado).includes('Nenhuma leitura registrada'));

  console.log('── eixo X com autoscale nos dados do dia (dashboard) ──');
  preparar(0);
  vm.runInContext(`
    SENSOR_ABERTO.horarios = ['00:00','02:00','04:00','06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00'];
    SENSOR_ABERTO.grandezasAtivas = { temp_current: { tipo: 'temperatura', rotulo: 'Temperatura', unidade: '°C' } };
    LEITURAS_DIA = [
      { criadoEm: ${new Date(2026, 9, 5, 8, 0).getTime()}, valores: { temp_current: 24 } },
      { criadoEm: ${new Date(2026, 9, 5, 14, 0).getTime()}, valores: { temp_current: 27 } },
    ];
    renderGraficosDashboard(SENSOR_ABERTO);
  `, sandbox);
  const eixo = sandbox.__charts.at(-1).cfg.options.scales.x;
  assert('X ajusta o mínimo ao primeiro dado (08:00 = 480)', eixo.min === 480);
  assert('X ajusta o máximo ao último dado, alinhado ao passo de 2h (840 = 14:00)', eixo.max === 840);

  console.log('── resumo de avaliação ──');
  const resumo = vm.runInContext(`resumoGrandeza(
    { limites: { temp_current: { min: 20, max: 26 } } },
    'temp_current',
    [{ valores: { temp_current: 22 } }, { valores: { temp_current: 27 } }, { valores: { temp_current: 24 } }, { valores: {} }]
  )`, sandbox);
  assert('último valor é o da leitura mais recente do período', resumo.ultimo === 24);
  assert('mínimo e máximo no período', resumo.min === 22 && resumo.max === 27);
  assert('média ignora leituras sem a grandeza (22+27+24)/3', Math.abs(resumo.media - 73 / 3) < 1e-9);
  assert('percentual fora do limite (1 de 3)', Math.abs(resumo.pctFora - 1 / 3) < 1e-9);
  assert('sem valores retorna null', vm.runInContext(`resumoGrandeza({}, 'x', [])`, sandbox) === null);

  console.log('── modal: visão dashboard e visão configurações renderizam sem erro ──');
  preparar(5);
  let erroDash = null, erroConfig = null;
  try { vm.runInContext(`MODO_MODAL = 'dashboard'; renderModalSensor();`, sandbox); } catch (e) { erroDash = e; }
  assert('visão dashboard renderiza sem erro', erroDash === null);
  try { vm.runInContext(`MODO_MODAL = 'config'; renderModalSensor();`, sandbox); } catch (e) { erroConfig = e; }
  assert('visão configurações renderiza sem erro', erroConfig === null);
  assert('alternância de modo é preservada no estado', vm.runInContext('MODO_MODAL', sandbox) === 'config');

  console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
