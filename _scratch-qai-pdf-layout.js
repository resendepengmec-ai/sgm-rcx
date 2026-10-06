'use strict';
// Smoke test do PDF do sensor: executa gerarPdfSensor REAL (qai.html) com
// jsPDF vendorizado no Node. Não há navegador aqui, então o gráfico é
// pulado (sem canvas) — o restante do layout (cabeçalho, grandezas, tabela
// paginada, rodapé) é desenhado de verdade e inspecionado no arquivo gerado.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'qai.html'), 'utf8');
const codigo = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

const jspdfMod = require(path.join(__dirname, 'vendor', 'jspdf.umd.min.js'));
const JsPDF = jspdfMod.jsPDF || (jspdfMod.jspdf && jspdfMod.jspdf.jsPDF);

function textoPdf(doc) { return Buffer.from(doc.output('arraybuffer')).toString('latin1'); }
let falhas = 0;
function assert(desc, cond) {
  if (cond) console.log('  ✓', desc);
  else { console.log('  ✗', desc); falhas++; }
}

let docGerado = null;
const apiSave = JsPDF.API || JsPDF.prototype;
apiSave.save = function () { docGerado = this; };

const stubEl = { style: {}, innerHTML: '', classList: { add() {}, remove() {}, toggle() {} } };
const sandbox = {
  console,
  document: { getElementById: () => stubEl, querySelector: () => null },
  guardaDeModulo: async () => null,
  esc: s => String(s ?? ''),
  withActionBusy: async (btn, label, task) => task(),
  Chart: function () { this.destroy = () => {}; },
  DB: {},
  setTimeout: () => 0,
};
sandbox.window = sandbox;
sandbox.window.jspdf = { jsPDF: JsPDF };
vm.createContext(sandbox);
vm.runInContext(codigo, sandbox, { filename: 'qai.html-inline-script.js' });

function preparar(numLeituras) {
  vm.runInContext(`
    user = { name: 'Teste Gestor' };
    CONTRATOS = [{ numero: '1020', razao: 'Cliente A', art: 'ART-123' }];
    PRESTADORA = { company: 'Empresa Teste Ltda', address: 'Rua Exemplo, 100', cnpj: '00.000.000/0001-00' };
    SENSOR_ABERTO = {
      id: 's1', contrato: '1020', estabelecimento: 'Unidade A', recinto: 'Sala 1', sensorAtivo: true,
      horarios: ['08:00', '20:00'],
      limites: { temp_current: { min: 20, max: 26 } },
      grandezasAtivas: {
        temp_current: { rotulo: 'Temperatura', unidade: '°C', scale: 1 },
        humidity_value: { rotulo: 'Umidade relativa', unidade: '%', scale: 0 },
      },
    };
    DASH_LINHA = { telemetriaAoVivo: { valores: { temp_current: 26.2, humidity_value: 62 }, recebidoEm: Date.now() } };
    LEITURAS_ABERTO = Array.from({ length: ${numLeituras} }, (_, i) => ({
      criadoEm: Date.UTC(2026, 9, 1) + i * 3600000,
      valores: { temp_current: 22 + (i % 5), humidity_value: 55 + (i % 7) },
      conforme: (i % 5) < 4,
    }));
  `, sandbox);
}

(async () => {
  console.log('── PDF com poucas leituras: uma página, cabeçalho e rodapé ──');
  preparar(3);
  docGerado = null;
  await sandbox.gerarPdfSensor({});
  console.log('  [toast]', stubEl.textContent);
  assert('gera um documento', docGerado !== null);
  const pequeno = textoPdf(docGerado);
  assert('rodapé com "Gerado em" presente', pequeno.includes('Gerado em'));
  assert('rodapé com paginação "Página 1 de 1"', pequeno.includes('Página 1 de 1'));
  assert('linha do contratante (razão e ART) no rodapé', pequeno.includes('Cliente A') && pequeno.includes('ART-123'));
  assert('cabeçalho com nome da empresa', pequeno.includes('Empresa Teste Ltda'));
  assert('título do módulo no cabeçalho', pequeno.includes('Qualidade do Ar Interior'));

  console.log('── PDF com muitas leituras: quebra de página e rodapé em todas ──');
  preparar(120);
  docGerado = null;
  await sandbox.gerarPdfSensor({});
  const paginas = docGerado.internal.getNumberOfPages();
  assert('120 leituras geram várias páginas', paginas >= 3);
  const grande = textoPdf(docGerado);
  assert('paginação correta no total final', grande.includes(`Página ${paginas} de ${paginas}`));
  assert('rodapé "Gerado em" repetido (presente)', grande.includes('Gerado em'));

  console.log('── PDF sem grandezas ativas não quebra ──');
  vm.runInContext(`SENSOR_ABERTO.grandezasAtivas = {}; LEITURAS_ABERTO = [];`, sandbox);
  docGerado = null;
  await sandbox.gerarPdfSensor({});
  assert('gera PDF mesmo sem grandezas nem leituras', docGerado !== null && docGerado.internal.getNumberOfPages() >= 1);

  console.log('── modal: visão dashboard e visão configurações renderizam sem erro ──');
  preparar(5);
  let erroDash = null, erroConfig = null;
  try { vm.runInContext(`MODO_MODAL = 'dashboard'; renderModalSensor();`, sandbox); } catch (e) { erroDash = e; }
  assert('visão dashboard renderiza sem erro', erroDash === null);
  try { vm.runInContext(`MODO_MODAL = 'config'; renderModalSensor();`, sandbox); } catch (e) { erroConfig = e; }
  assert('visão configurações renderiza sem erro', erroConfig === null);
  const modoFinal = vm.runInContext('MODO_MODAL', sandbox);
  assert('alternância de modo é preservada no estado', modoFinal === 'config');

  console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error('ERRO:', e); process.exit(1); });
