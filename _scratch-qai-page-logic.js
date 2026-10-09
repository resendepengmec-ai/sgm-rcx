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
  // Mesma implementação de api-client.js:esc — um stub que não escapasse
  // deixaria passar um teste de XSS que não testa nada de verdade.
  esc: s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
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

console.log('── agrupar por unidade: duas de °C ficam no mesmo eixo ──');
{
  const s9 = {
    horarios: [],
    grandezasAtivas: {
      temp_current: { tipo: 'temperatura', rotulo: 'Temperatura', unidade: '°C' },
      temp_current_external: { tipo: null, rotulo: 'Temperatura externa', unidade: '°C' },
      humidity_value: { tipo: 'umidade', rotulo: 'Umidade relativa', unidade: '%' },
    },
  };
  const buckets = sandbox.agruparPorUnidade(s9, Object.keys(s9.grandezasAtivas));
  assert('2 unidades distintas (°C e %) viram 2 buckets', buckets.length === 2);
  assert('as duas grandezas de °C ficam no mesmo bucket', buckets[0].unidade === '°C' && buckets[0].codigos.length === 2);
  const grupos = sandbox.paresDeGrandezas(buckets);
  assert('só 2 buckets -> 1 grupo com os 2 eixos', grupos.length === 1 && grupos[0].length === 2);

  vm.runInContext(`
    SENSOR_ABERTO = ${JSON.stringify(s9)};
    LEITURAS_DIA = [
      { criadoEm: ${new Date(2026, 9, 5, 8, 0).getTime()}, valores: { temp_current: 22, temp_current_external: 19, humidity_value: 60 } },
      { criadoEm: ${new Date(2026, 9, 5, 14, 0).getTime()}, valores: { temp_current: 25, temp_current_external: 21, humidity_value: 58 } },
    ];
    renderGraficosDashboard(SENSOR_ABERTO);
  `, sandbox);
  const graf = sandbox.__charts.at(-1).cfg;
  assert('1 gráfico só (as 2 unidades cabem num grupo de até 2 eixos)', graf.data.datasets.length === 3);
  const porLabel = Object.fromEntries(graf.data.datasets.map(d => [d.label, d.yAxisID]));
  assert('as duas grandezas de °C compartilham o eixo y', porLabel['Temperatura'] === 'y' && porLabel['Temperatura externa'] === 'y');
  assert('a grandeza de % vai para o eixo y1 (direito)', porLabel['Umidade relativa'] === 'y1');
}

console.log('── faixasDoLimite: verde entre os limites, vermelho fora ──');
assert('min e máx: verde no meio, vermelho acima e abaixo',
  JSON.stringify(sandbox.faixasDoLimite({ min: 20, max: 26 }, { min: 15, max: 30 })) ===
  JSON.stringify([{ de: 20, para: 26, cor: 'verde' }, { de: 26, para: 30, cor: 'vermelho' }, { de: 15, para: 20, cor: 'vermelho' }]));
assert('só máx (ex.: CO₂): verde até o máx, vermelho acima',
  JSON.stringify(sandbox.faixasDoLimite({ max: 1000 }, { min: 500, max: 1300 })) ===
  JSON.stringify([{ de: 500, para: 1000, cor: 'verde' }, { de: 1000, para: 1300, cor: 'vermelho' }]));
assert('domínio inteiramente dentro do limite: sem faixa vermelha',
  JSON.stringify(sandbox.faixasDoLimite({ min: 20, max: 26 }, { min: 20, max: 26 })) ===
  JSON.stringify([{ de: 20, para: 26, cor: 'verde' }]));
assert('sem limite configurado: nenhuma faixa', sandbox.faixasDoLimite(null, { min: 0, max: 10 }).length === 0);
assert('sem domínio (sem dados nem limite): nenhuma faixa', sandbox.faixasDoLimite({ max: 10 }, null).length === 0);

console.log('── domínio do eixo sempre inclui o limite, mesmo fora da faixa dos dados ──');
{
  const bucket = { unidade: 'ppm', codigos: ['co2_value'] };
  const leituras = [{ valores: { co2_value: 700 } }, { valores: { co2_value: 1300 } }];
  const dom = sandbox.dominioYDoBucket(bucket, leituras, sandbox.pontosDoPeriodo, { max: 1000 });
  assert('excursão acima do limite (1300) fica dentro do domínio', dom.max >= 1300);
  assert('o limite de 1000 também fica dentro do domínio (não só os dados)', dom.min <= 1000 && dom.max >= 1000);
}

console.log('── limiteUniformeDoBucket: só sombreia quando o limite é o mesmo para todas ──');
{
  const limiteIgual = { min: 20, max: 26 };
  const sIgual = { limites: { a: limiteIgual, b: { min: 20, max: 26 } } };
  assert('limites iguais (mesmo valor, objetos diferentes) -> usa o limite', JSON.stringify(sandbox.limiteUniformeDoBucket(sIgual, { codigos: ['a', 'b'] })) === JSON.stringify(limiteIgual));
  const sDiferente = { limites: { a: { max: 26 }, b: { max: 30 } } };
  assert('limites diferentes entre as grandezas do bucket -> não sombreia', sandbox.limiteUniformeDoBucket(sDiferente, { codigos: ['a', 'b'] }) === null);
}

console.log('── gauge: geometria (ângulo, ponto, domínio) ──');
assert('valor no mínimo do domínio -> 180° (esquerda)', sandbox.anguloDoValor(0, { min: 0, max: 100 }) === 180);
assert('valor no máximo do domínio -> 0° (direita)', sandbox.anguloDoValor(100, { min: 0, max: 100 }) === 0);
assert('valor no meio -> 90° (topo)', sandbox.anguloDoValor(50, { min: 0, max: 100 }) === 90);
assert('valor abaixo do domínio é grampeado em 180°', sandbox.anguloDoValor(-10, { min: 0, max: 100 }) === 180);
assert('valor acima do domínio é grampeado em 0°', sandbox.anguloDoValor(200, { min: 0, max: 100 }) === 0);
{
  const p0 = sandbox.pontoDoAngulo(50, 50, 40, 180);
  assert('180° fica no ponto mais à esquerda do arco', Math.abs(p0.x - 10) < 1e-6 && Math.abs(p0.y - 50) < 1e-6);
  const p90 = sandbox.pontoDoAngulo(50, 50, 40, 90);
  assert('90° fica no topo do arco (y menor, SVG cresce pra baixo)', Math.abs(p90.x - 50) < 1e-6 && Math.abs(p90.y - 10) < 1e-6);
  const p1 = sandbox.pontoDoAngulo(50, 50, 40, 0);
  assert('0° fica no ponto mais à direita do arco', Math.abs(p1.x - 90) < 1e-6 && Math.abs(p1.y - 50) < 1e-6);
}
assert('domínio do gauge sem valor nem limite é nulo', sandbox.dominioGauge(null, null) === null);
{
  const d = sandbox.dominioGauge(27, { min: 20, max: 26 });
  assert('domínio do gauge inclui o valor acima do limite (excursão visível)', d.max >= 27);
  assert('domínio do gauge inclui o limite mesmo com valor dentro dele', sandbox.dominioGauge(24, { min: 20, max: 26 }).min <= 20);
}

console.log('── gauge: SVG montado (trilhas, agulha, rótulo) ──');
{
  const svgComLimite = sandbox.montarGaugeSvg({ valor: 24, limite: { min: 20, max: 26 }, rotulo: 'Temperatura', unidade: '°C' });
  assert('com min+max: 3 trilhas (verde entre, vermelho acima e abaixo)', (svgComLimite.match(/<path/g) || []).length === 3);
  assert('tem agulha quando há valor', svgComLimite.includes('<line') && svgComLimite.includes('<circle'));
  assert('mostra o valor formatado com unidade', svgComLimite.includes('24 °C'));
  assert('mostra o rótulo', svgComLimite.includes('Temperatura'));

  const svgSemLimite = sandbox.montarGaugeSvg({ valor: 24, limite: null, rotulo: 'X', unidade: '' });
  assert('sem limite: 1 trilha cinza (sem faixa verde/vermelha)', (svgSemLimite.match(/<path/g) || []).length === 1 && svgSemLimite.includes('#cbd5e1'));

  const svgSemValor = sandbox.montarGaugeSvg({ valor: null, limite: { max: 1000 }, rotulo: 'CO₂', unidade: 'ppm' });
  assert('sem valor: mostra travessão, sem agulha', svgSemValor.includes('—') && !svgSemValor.includes('<line'));

  const svgSemNada = sandbox.montarGaugeSvg({ valor: null, limite: null, rotulo: 'Y', unidade: '' });
  assert('sem valor nem limite: arco cinza neutro, sem quebrar', svgSemNada.includes('<svg') && svgSemNada.includes('—'));

  const svgEscapa = sandbox.montarGaugeSvg({ valor: 1, limite: null, rotulo: '<img onerror=x>', unidade: '' });
  assert('rótulo malicioso é escapado', !svgEscapa.includes('<img'));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
