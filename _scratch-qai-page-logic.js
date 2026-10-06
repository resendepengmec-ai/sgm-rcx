'use strict';
// Teste isolado da lógica PURA do qai.html (sem navegador/jsdom nesta
// máquina) — extrai o <script> inline e roda num contexto vm com stubs
// mínimos. Só cobre funções que não dependem de elementos reais.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'qai.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length !== 1) throw new Error('esperado 1 bloco <script> inline em qai.html, achei ' + scripts.length);

let falhas = 0;
function assert(desc, cond) {
  if (cond) console.log('  ✓', desc);
  else { console.log('  ✗', desc); falhas++; }
}

const stubEl = { style: {}, innerHTML: '', classList: { add() {}, remove() {}, toggle() {} } };
const sandbox = {
  console,
  document: { getElementById: () => stubEl, querySelector: () => null },
  guardaDeModulo: async () => null,
  esc: s => String(s ?? ''),
  withActionBusy: async (btn, label, task) => task(),
  Chart: function (ctx, cfg) { this.cfg = cfg; this.destroy = () => {}; (sandbox.__charts = sandbox.__charts || []).push(this); },
  DB: {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(scripts[0], sandbox, { filename: 'qai.html-inline-script.js' });

console.log('── coresParaChaves: determinística e sem colisão dentro do gráfico ──');
const codigos = ['temp_current', 'humidity_value', 'co2_value', 'ch2o_value', 'pm25_value', 'pm10_value', 'tvoc_value'];
const m1 = sandbox.coresParaChaves(codigos);
const m2 = sandbox.coresParaChaves([...codigos].reverse());
assert('todas as chaves recebem uma cor da paleta', codigos.every(c => /^#[0-9a-f]{6}$/i.test(m1.get(c))));
assert('nenhuma colisão entre as 7 chaves do gráfico', new Set(codigos.map(c => m1.get(c))).size === codigos.length);
assert('mesma atribuição independente da ordem de entrada', codigos.every(c => m1.get(c) === m2.get(c)));
assert('código novo (grandeza genérica) também recebe cor', /^#[0-9a-f]{6}$/i.test(m1.get('ch2o_value')));

console.log('── distribuirHorariosLocal: espelho de qai-schedule.js ──');
assert('x=2, 08:00 -> [08:00,20:00]', JSON.stringify(sandbox.distribuirHorariosLocal(2, '08:00')) === JSON.stringify(['08:00', '20:00']));
assert('x=3, 06:00 -> passo de 8h', JSON.stringify(sandbox.distribuirHorariosLocal(3, '06:00')) === JSON.stringify(['06:00', '14:00', '22:00']));
assert('x=2, 20:00 normaliza a virada do dia', JSON.stringify(sandbox.distribuirHorariosLocal(2, '20:00')) === JSON.stringify(['20:00', '08:00']));

console.log('── fmtValor / infoGrandeza / tempoRelativo ──');
assert('fmtValor usa a unidade recebida, sem depender de lista fixa', sandbox.fmtValor(24.5, '°C') === '24.5 °C');
assert('fmtValor de grandeza genérica com unidade própria', sandbox.fmtValor(0.25, 'mg/m³') === '0.25 mg/m³');
assert('fmtValor sem valor é travessão', sandbox.fmtValor(null, 'ppm') === '—');
const sensorTeste = {
  grandezasAtivas: { ch2o_value: { rotulo: 'ch2o_value', unidade: 'mg/m³' } },
  grandezasDisponiveis: [{ code: 'temp_current', rotulo: 'Temperatura', unidade: '°C' }],
};
assert('infoGrandeza pega rótulo de grandeza ativa', sandbox.infoGrandeza(sensorTeste, 'ch2o_value').unidade === 'mg/m³');
assert('infoGrandeza cai em grandezasDisponiveis quando não está ativa', sandbox.infoGrandeza(sensorTeste, 'temp_current').rotulo === 'Temperatura');
assert('infoGrandeza de código desconhecido usa o próprio code', sandbox.infoGrandeza(sensorTeste, 'xyz').rotulo === 'xyz');
assert('tempoRelativo "agora mesmo"', sandbox.tempoRelativo(Date.now() - 5000) === 'agora mesmo');
assert('tempoRelativo em minutos', sandbox.tempoRelativo(Date.now() - 5 * 60000) === 'há 5 min');

console.log('── recintosDe: autocomplete de recinto depende do estabelecimento ──');
const locaisTeste = [
  { estabelecimento: 'Unidade A', recintos: ['Sala 1', 'Sala 2'] },
  { estabelecimento: 'Escola B', recintos: ['Lab'] },
];
assert('recintos do estabelecimento exato', JSON.stringify(sandbox.recintosDe(locaisTeste, 'Unidade A')) === JSON.stringify(['Sala 1', 'Sala 2']));
assert('ignora caixa e espaços ao comparar estabelecimento', JSON.stringify(sandbox.recintosDe(locaisTeste, '  unidade a ')) === JSON.stringify(['Sala 1', 'Sala 2']));
assert('estabelecimento desconhecido (texto livre) não sugere recinto', sandbox.recintosDe(locaisTeste, 'Novo Prédio').length === 0);
assert('sem locais carregados não quebra', sandbox.recintosDe(null, 'Unidade A').length === 0);

console.log('── situacaoGrandeza / textoLimite: tiles do dashboard ──');
assert('valor dentro dos limites', sandbox.situacaoGrandeza(24, { min: 20, max: 26 }).classe === 'ok');
assert('valor acima do máximo fica fora', sandbox.situacaoGrandeza(27, { min: 20, max: 26 }).classe === 'fora');
assert('valor abaixo do mínimo fica fora', sandbox.situacaoGrandeza(18, { min: 20, max: 26 }).classe === 'fora');
assert('sem limite definido não avalia', sandbox.situacaoGrandeza(24, undefined).classe === 'sem');
assert('sem leitura não avalia', sandbox.situacaoGrandeza(null, { max: 26 }).texto === 'sem leitura');
assert('textoLimite com mínimo e máximo', sandbox.textoLimite({ min: 20, max: 26 }, '°C') === 'mín 20 °C · máx 26 °C');
assert('textoLimite sem limite', sandbox.textoLimite(undefined, '°C') === 'sem limite definido');

console.log('── histórico do dia: grupos de 2, eixos e passo do X ──');
{
  const dia = new Date(2026, 9, 5).getTime();
  const h = (hh) => new Date(2026, 9, 5, hh, 0).getTime();
  vm.runInContext(`
    SENSOR_ABERTO = {
      id: 's9', horarios: ['00:00','02:00','04:00','06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00'],
      grandezasAtivas: {
        temp_current: { tipo: 'temperatura', rotulo: 'Temperatura', unidade: '°C' },
        humidity_value: { tipo: 'umidade', rotulo: 'Umidade relativa', unidade: '%' },
        co2_value: { tipo: 'co2', rotulo: 'CO₂', unidade: 'ppm' },
      },
    };
    LEITURAS_DIA = [
      { criadoEm: ${h(8)}, valores: { temp_current: 24, humidity_value: 60, co2_value: 700 } },
      { criadoEm: ${h(14)}, valores: { temp_current: 27, humidity_value: 55, co2_value: 900 } },
    ];
    renderGraficosDashboard(SENSOR_ABERTO);
  `, sandbox);
  const charts = sandbox.__charts;
  assert('3 grandezas viram 2 gráficos (grupos de no máximo 2)', charts.length === 2);
  const g1 = charts[0].cfg, g2 = charts[1].cfg;
  assert('grupo com unidades diferentes usa eixo esquerdo e direito', !!g1.options.scales.y1 && g1.options.scales.y1.position === 'right' && g1.options.scales.y.position === 'left');
  assert('2ª grandeza do grupo está no eixo y1 (direito)', g1.data.datasets[1].yAxisID === 'y1' && g1.data.datasets[0].yAxisID === 'y');
  assert('título do eixo esquerdo traz abreviação e unidade', g1.options.scales.y.title.text === 'Temp (°C)');
  assert('título do eixo direito traz abreviação e unidade', g1.options.scales.y1.title.text === 'UR (%)');
  assert('grupo com uma grandeza não tem eixo direito', !g2.options.scales.y1 && g2.options.scales.y.title.text === 'CO₂ (ppm)');
  assert('eixo X: 12 horários/dia -> passo de 2h (stepSize 120 min)', g1.options.scales.x.ticks.stepSize === 120);
  assert('rótulo do eixo X a cada 2h (02:00)', g1.options.scales.x.ticks.callback(120) === '02:00');
  assert('rótulo do fim do dia é 24:00', g1.options.scales.x.ticks.callback(1440) === '24:00');
  vm.runInContext(`
    SENSOR_ABERTO.horarios = ['08:00', '20:00'];
    renderGraficosDashboard(SENSOR_ABERTO);
  `, sandbox);
  const c2 = sandbox.__charts.slice(2)[0].cfg;
  assert('2 horários/dia -> passo de 12h (stepSize 720 min)', c2.options.scales.x.ticks.stepSize === 720);
  assert('ponto de 08:00 posicionado no eixo em minutos (480)', c2.data.datasets[0].data[0].x === 480);
  assert('sem horários configurados (contínuo) usa passo de 2h', sandbox.passoHoras({ horarios: [] }) === 2);
  assert('paresDeGrandezas agrupa de dois em dois', JSON.stringify(sandbox.paresDeGrandezas(['a','b','c','d','e'])) === JSON.stringify([['a','b'],['c','d'],['e']]));
  assert('abreviação conhecida por tipo', sandbox.abreviacaoGrandeza({ grandezasAtivas: { x: { tipo: 'pm25' } } }, 'x') === 'MP2,5');
  assert('dia local e deslocamento de dia', sandbox.diaLocalDe(dia) === '2026-10-05' && sandbox.deslocarDia('2026-10-31', 1) === '2026-11-01');
  assert('limites do dia cobrem 24h', sandbox.limitesDoDia('2026-10-05').ate - sandbox.limitesDoDia('2026-10-05').desde === 86399999);
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
