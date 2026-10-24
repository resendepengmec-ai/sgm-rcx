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

// Um elemento FALSO por id (não um único compartilhado) — senão escrever
// em 'dash-grandezas' e depois ler 'dash-historico' devolveria o mesmo
// conteúdo, e um teste que inspeciona innerHTML por id não vale nada.
const ELEMENTOS = new Map();
function elementoFalso(id) {
  if (!ELEMENTOS.has(id)) ELEMENTOS.set(id, { style: {}, innerHTML: '', classList: { add() {}, remove() {}, toggle() {} } });
  return ELEMENTOS.get(id);
}
const sandbox = {
  console,
  document: { getElementById: id => elementoFalso(id), querySelector: () => null },
  guardaDeModulo: async () => null,
  // Mesma implementação de api-client.js:esc — um stub que não escapasse
  // deixaria passar um teste de XSS que não testa nada de verdade.
  esc: s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
  withActionBusy: async (btn, label, task) => task(),
  Chart: function (ctx, cfg) { this.cfg = cfg; this.destroy = () => {}; (sandbox.__charts = sandbox.__charts || []).push(this); },
  // getComparacaoQai (Fase 5): default seguro — buscarEstatisticas sempre
  // chama os dois em paralelo; testes que só querem exercitar as
  // estatísticas (Fase 2/3) não precisam redefinir este também.
  DB: { getComparacaoQai: () => Promise.resolve({ disponivel: false, motivo: 'não testado neste bloco' }) },
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

console.log('── exibição é configuração do SENSOR, não da sessão ──');
assert('sensor sem exibicao cai no padrão (cartões, agrupado)', JSON.stringify(sandbox.exibicaoDoSensor({})) === JSON.stringify({ modoValor: 'cartoes', agrupar: true }));
assert('sensor com exibicao explícita respeita o que foi salvo', JSON.stringify(sandbox.exibicaoDoSensor({ exibicao: { modoValor: 'gauge', agrupar: false } })) === JSON.stringify({ modoValor: 'gauge', agrupar: false }));

console.log('── montarGrupos: agrupar=false separa cada grandeza no próprio gráfico ──');
{
  const s10 = {
    grandezasAtivas: {
      temp_current: { tipo: 'temperatura', rotulo: 'Temperatura', unidade: '°C' },
      temp_current_external: { tipo: null, rotulo: 'Temperatura externa', unidade: '°C' },
      humidity_value: { tipo: 'umidade', rotulo: 'Umidade relativa', unidade: '%' },
    },
  };
  const codigos = Object.keys(s10.grandezasAtivas);
  const individuais = sandbox.montarGrupos(s10, codigos, false);
  assert('agrupar=false: 3 grandezas -> 3 grupos (um gráfico cada)', individuais.length === 3);
  assert('cada grupo individual tem só 1 bucket com 1 código', individuais.every(g => g.length === 1 && g[0].codigos.length === 1));
  const agrupados = sandbox.montarGrupos(s10, codigos, true);
  assert('agrupar=true: as 2 de °C compartilham bucket (comportamento anterior preservado)', agrupados[0][0].codigos.length === 2);

  console.log('── renderGraficosDashboard respeita exibicao.agrupar=false ──');
  vm.runInContext(`
    SENSOR_ABERTO = ${JSON.stringify({ ...s10, exibicao: { modoValor: 'cartoes', agrupar: false } })};
    LEITURAS_DIA = [
      { criadoEm: ${new Date(2026, 9, 5, 8, 0).getTime()}, valores: { temp_current: 22, temp_current_external: 19, humidity_value: 60 } },
    ];
    renderGraficosDashboard(SENSOR_ABERTO);
  `, sandbox);
  const ultimosGraficos = sandbox.__charts.slice(-3);
  assert('3 grandezas (2 de °C + 1 de %) viram 3 gráficos quando individual', ultimosGraficos.length === 3);
  assert('nenhum gráfico individual tem eixo direito (y1)', ultimosGraficos.every(g => !g.cfg.options.scales.y1));
}

console.log('── renderDashboard usa exibicao.modoValor do sensor (não mais um botão de sessão) ──');
{
  vm.runInContext(`
    DASH_LINHA = { telemetriaAoVivo: { valores: { temp_current: 24 }, recebidoEm: Date.now() } };
    LEITURAS_ABERTO = [];
    SENSOR_ABERTO = {
      grandezasAtivas: { temp_current: { tipo: 'temperatura', rotulo: 'Temperatura', unidade: '°C' } },
      limites: {}, exibicao: { modoValor: 'gauge', agrupar: true },
    };
    renderDashboard(SENSOR_ABERTO);
  `, sandbox);
  const dashGrandezas = elementoFalso('dash-grandezas').innerHTML;
  assert('exibicao.modoValor=gauge: dash-grandezas renderiza o gauge (classe qai-gauge-item)', dashGrandezas.includes('qai-gauge-item'));
  assert('não renderiza mais o botão de alternância (virou configuração do sensor)', !dashGrandezas.includes('qai-visual-toggle'));

  vm.runInContext(`SENSOR_ABERTO.exibicao = { modoValor: 'cartoes', agrupar: true }; renderDashboard(SENSOR_ABERTO);`, sandbox);
  assert('exibicao.modoValor=cartoes: dash-grandezas volta a renderizar o cartão (classe qai-kpi)', elementoFalso('dash-grandezas').innerHTML.includes('qai-kpi'));
}

// ── Abas Ativos/Inativos/Excluídos + restaurar sensor (auditoria 2026-10) ──
// Sensor excluído "se perdia" no servidor: nenhuma rota devolvia/editava
// de novo. Aqui, o que é testável sem servidor: o bucket client-side
// (linhasDaAba), o card somente-leitura com botão Restaurar (nunca
// clicável pra abrir o dashboard — abrirSensor chama GET /sensores/:id,
// que 404 pra excluído), e a reconciliação da exclusão (não assustar o
// usuário com erro quando a resposta se perdeu mas o servidor já tinha
// aplicado).
sandbox.selectTab = () => {};
let _toasts = [];
sandbox.showToast = msg => { _toasts.push(msg); };
sandbox.confirm = () => true;
sandbox.fecharModal = () => {};

const linha = (id, { ativo = false, excluido = null } = {}) => ({
  sensor: { id, estabelecimento: 'E' + id, recinto: 'R' + id, sensorAtivo: ativo, excluidoEm: excluido },
  telemetriaAoVivo: null, ultimaLeitura: null,
});

console.log('── linhasDaAba: separa ativos/inativos/excluídos corretamente ──');
{
  vm.runInContext(`LINHAS = [
    ${JSON.stringify(linha('a1', { ativo: true }))},
    ${JSON.stringify(linha('i1', { ativo: false }))},
    ${JSON.stringify(linha('x1', { excluido: 1700000000000 }))},
  ];`, sandbox);
  const ativos = sandbox.linhasDaAba('ativos');
  const inativos = sandbox.linhasDaAba('inativos');
  const excluidos = sandbox.linhasDaAba('excluidos');
  assert('aba ativos: só o sensor ativo e não excluído', ativos.length === 1 && ativos[0].sensor.id === 'a1');
  assert('aba inativos: só o sensor inativo e não excluído', inativos.length === 1 && inativos[0].sensor.id === 'i1');
  assert('aba excluidos: só o sensor com excluidoEm', excluidos.length === 1 && excluidos[0].sensor.id === 'x1');
  assert('um sensor excluído NUNCA aparece em ativos/inativos, mesmo marcado sensorAtivo:true', !ativos.some(l => l.sensor.id === 'x1') && !inativos.some(l => l.sensor.id === 'x1'));
}

console.log('── renderCard (excluído): somente leitura, com Restaurar, nunca abre o dashboard ──');
{
  const html = sandbox.renderCard(linha('x2', { excluido: Date.now() }));
  assert('mostra o botão Restaurar', html.includes('restaurarSensor(') && html.includes('Restaurar'));
  assert('badge indica que foi excluído', /Exclu[ií]do/.test(html));
  assert('NUNCA é clicável pra abrir o dashboard (sem onclick="abrirSensor)', !html.includes('onclick="abrirSensor('));
}
console.log('── renderCard (ativo/inativo): continua clicável, sem botão Restaurar ──');
{
  const htmlAtivo = sandbox.renderCard(linha('a2', { ativo: true }));
  assert('card ativo continua abrindo o dashboard ao clicar', htmlAtivo.includes("onclick=\"abrirSensor('a2')\""));
  assert('card ativo nunca mostra Restaurar', !htmlAtivo.includes('restaurarSensor('));
}

console.log('── renderCard: botão "📊 Estatísticas" só em sensor ATIVO (pedido explícito), nunca inativo/excluído ──');
{
  const htmlAtivo = sandbox.renderCard(linha('a3', { ativo: true }));
  assert('card ativo mostra o botão de Estatísticas', htmlAtivo.includes("abrirEstatisticas('a3')"));
  assert('botão usa stopPropagation (mesmo padrão do Restaurar) — não deve também abrir o dashboard', htmlAtivo.includes('event.stopPropagation();abrirEstatisticas('));
  const htmlInativo = sandbox.renderCard(linha('a4', { ativo: false }));
  assert('card inativo NÃO mostra o botão de Estatísticas', !htmlInativo.includes('abrirEstatisticas('));
  const htmlExcluido = sandbox.renderCard(linha('a5', { excluido: Date.now() }));
  assert('card excluído NÃO mostra o botão de Estatísticas', !htmlExcluido.includes('abrirEstatisticas('));
}

// Resto do arquivo é síncrono (node file.js, CommonJS — sem top-level
// await) — os testes async de restaurarSensor/excluirSensorAtual ficam
// numa IIFE, que só imprime o resumo final e sai depois de resolvida.
(async () => {

console.log('── restaurarSensor: chama a API, troca pra aba Inativos ──');
{
  vm.runInContext(`DB.restaurarSensorQai = (id) => { __idRestaurado = id; return Promise.resolve({}); };
    DB.getDashboardQai = () => Promise.resolve([]);`, sandbox);
  await sandbox.restaurarSensor('x3', {});
  const idRestaurado = vm.runInContext('__idRestaurado', sandbox);
  assert('chama DB.restaurarSensorQai com o id certo', idRestaurado === 'x3');
  assert('troca a aba atual pra Inativos (onde um sensor recém-restaurado aparece)', vm.runInContext('ABA_STATUS', sandbox) === 'inativos');
}

console.log('── excluirSensorAtual: resposta perdida depois de excluir no servidor NÃO assusta o usuário ──');
{
  _toasts = [];
  vm.runInContext(`SENSOR_ABERTO = { id: 'x4', contrato: '1020' };`, sandbox);
  vm.runInContext(`
    DB.deleteSensorQai = () => Promise.reject(Object.assign(new Error('timeout'), { transient: true }));
    DB.getDashboardQai = () => Promise.resolve([${JSON.stringify(linha('x4', { excluido: Date.now() }))}]);
  `, sandbox);
  await sandbox.excluirSensorAtual({});
  assert('NÃO mostra "Erro ao excluir" quando a reconciliação confirma que já foi excluído', !_toasts.some(t => t.startsWith('Erro ao excluir')));
  assert('mostra confirmação de sucesso (exclusão confirmada após verificar)', _toasts.some(t => t.includes('confirmado')));
}
console.log('── excluirSensorAtual: erro de verdade (não transient) continua mostrando erro ──');
{
  _toasts = [];
  vm.runInContext(`SENSOR_ABERTO = { id: 'x5', contrato: '1020' };`, sandbox);
  vm.runInContext(`DB.deleteSensorQai = () => Promise.reject(Object.assign(new Error('Sem permissão'), { transient: false }));`, sandbox);
  await sandbox.excluirSensorAtual({});
  assert('erro não-transient mostra "Erro ao excluir" normalmente', _toasts.some(t => t.startsWith('Erro ao excluir')));
}
console.log('── excluirSensorAtual: erro transient SEM confirmação de que foi excluído continua mostrando erro ──');
{
  _toasts = [];
  vm.runInContext(`SENSOR_ABERTO = { id: 'x6', contrato: '1020' };`, sandbox);
  vm.runInContext(`
    DB.deleteSensorQai = () => Promise.reject(Object.assign(new Error('timeout'), { transient: true }));
    DB.getDashboardQai = () => Promise.resolve([]);
  `, sandbox);
  await sandbox.excluirSensorAtual({});
  assert('sem confirmação (sensor não aparece como excluído): mostra erro, não finge sucesso', _toasts.some(t => t.startsWith('Erro ao excluir')));
}

console.log('── podeConfigurarLocalQai: mesma faixa de papel que edita contrato (authz.SUPERVISOR_ACIMA) ──');
['admin', 'admin_cliente', 'diretor', 'supervisor'].forEach(r =>
  assert(`${r} pode configurar local`, sandbox.podeConfigurarLocalQai(r)));
['gestor', 'tecnico', 'solicitante', undefined, null].forEach(r =>
  assert(`${JSON.stringify(r)} NÃO pode configurar local`, !sandbox.podeConfigurarLocalQai(r)));

console.log('── renderConfigLocal: lista mostra "Configurar" pra quem não tem config e "Editar" + resumo pra quem tem ──');
{
  vm.runInContext(`
    CONFIG_LOCAL_EDITANDO = null;
    LOCAIS = [{ estabelecimento: 'Unidade A', recintos: [] }, { estabelecimento: 'Unidade B', recintos: [] }];
    CONFIGS_LOCAL = new Map([['unidade a', { estabelecimento: 'Unidade A', latitude: -16.68, longitude: -49.25, timezone: 'America/Sao_Paulo', diurnoInicio: '06:00', diurnoFim: '18:00' }]]);
  `, sandbox);
  sandbox.renderConfigLocal();
  const html = elementoFalso('config-local-conteudo').innerHTML;
  assert('Unidade A (tem config) mostra "Editar" e o resumo', html.includes('Editar') && html.includes('America/Sao_Paulo') && html.includes('-16.68'));
  assert('Unidade B (sem config) mostra "Configurar" e avisa que falta', html.includes('Configurar') && html.includes('indisponível para estatística'));
}

console.log('── renderConfigLocal: tela de edição carrega os valores já salvos (ou os defaults, pra quem nunca configurou) ──');
{
  vm.runInContext(`CONFIG_LOCAL_EDITANDO = 'Unidade A';`, sandbox);
  sandbox.renderConfigLocal();
  assert('campo latitude vem preenchido com o valor salvo', elementoFalso('config-local-conteudo').innerHTML.includes('value="-16.68"'));

  vm.runInContext(`CONFIG_LOCAL_EDITANDO = 'Unidade B';`, sandbox);
  sandbox.renderConfigLocal();
  const htmlSemConfig = elementoFalso('config-local-conteudo').innerHTML;
  assert('Unidade B (nunca configurada) usa os defaults de diurno 06:00–18:00, nunca um valor inventado de lat/long', htmlSemConfig.includes('value="06:00"') && htmlSemConfig.includes('value="18:00"') && !htmlSemConfig.includes('value="-16.68"'));
}

console.log('── salvarConfigLocal: envia os campos do formulário e atualiza o estado local após salvar ──');
{
  elementoFalso('f-contrato').value = '1020';
  elementoFalso('cfgl-lat').value = '-16.68';
  elementoFalso('cfgl-lon').value = '-49.25';
  elementoFalso('cfgl-tz').value = ' America/Sao_Paulo ';
  elementoFalso('cfgl-diurno-inicio').value = '07:00';
  elementoFalso('cfgl-diurno-fim').value = '19:00';
  vm.runInContext(`CONFIG_LOCAL_EDITANDO = 'Unidade B';`, sandbox);
  let payloadEnviado = null;
  vm.runInContext(`DB.salvarConfigLocalQai = (dados) => { __payload = dados; return Promise.resolve({ ...dados, estabelecimento: 'Unidade B' }); };`, sandbox);
  await sandbox.salvarConfigLocal({});
  payloadEnviado = vm.runInContext('__payload', sandbox);
  assert('envia contrato, estabelecimento em edição e os 5 campos do formulário', payloadEnviado.contrato === '1020' && payloadEnviado.estabelecimento === 'Unidade B'
    && payloadEnviado.latitude === '-16.68' && payloadEnviado.longitude === '-49.25' && payloadEnviado.diurnoInicio === '07:00' && payloadEnviado.diurnoFim === '19:00');
  assert('volta pra lista após salvar (CONFIG_LOCAL_EDITANDO vira null)', vm.runInContext('CONFIG_LOCAL_EDITANDO', sandbox) === null);
  const configs = vm.runInContext('CONFIGS_LOCAL', sandbox);
  assert('CONFIGS_LOCAL é atualizado com a resposta do servidor, sem precisar recarregar a lista inteira', configs.get('unidade b')?.diurnoInicio === '07:00');
}

console.log('── alternarColetaAnalitica: liga/desliga e reverte o checkbox se o servidor rejeitar ──');
{
  vm.runInContext(`SENSOR_ABERTO = { id: 's1', contrato: '1020', _version: 1 };`, sandbox);
  vm.runInContext(`DB.updateSensorQai = (id, dados) => { __patchEnviado = dados; return Promise.resolve({ id, contrato: '1020', coletaAnalitica: dados.coletaAnalitica }); };
    DB.getDashboardQai = () => Promise.resolve([]);`, sandbox);
  const checkboxLigando = { checked: true };
  await sandbox.alternarColetaAnalitica(checkboxLigando);
  const patchEnviado = vm.runInContext('__patchEnviado', sandbox);
  assert('envia coletaAnalitica:true no PATCH do sensor', patchEnviado.coletaAnalitica === true);
  assert('checkbox continua marcado após sucesso', checkboxLigando.checked === true);

  vm.runInContext(`DB.updateSensorQai = () => Promise.reject(new Error('Sem permissão'));`, sandbox);
  const checkboxFalhando = { checked: true };
  await sandbox.alternarColetaAnalitica(checkboxFalhando);
  assert('em erro, o checkbox é revertido (volta a desmarcado, já que a intenção era ligar)', checkboxFalhando.checked === false);
}

console.log('── renderModalSensor (estatisticas): abre com datas padrão (últimos 7 dias), nunca sem filtro nenhum ──');
{
  elementoFalso('sensor-modal-conteudo').innerHTML = '';
  vm.runInContext(`SENSOR_ABERTO = { id: 's-estat-default', estabelecimento: 'Unidade A', recinto: 'Sala 1', grandezasAtivas: {}, limites: {}, exibicao: { agrupar: true } };
    MODO_MODAL = 'estatisticas'; ESTAT_INICIO = ''; ESTAT_FIM = '';`, sandbox);
  let erro = null;
  try { sandbox.renderModalSensor(); } catch (e) { erro = e; }
  assert('renderiza sem erro', erro === null);
  const html = elementoFalso('sensor-modal-conteudo').innerHTML;
  assert('campo de data inicial vem preenchido (nunca abre sem filtro nenhum)', /id="estat-inicio" value="\d{4}-\d{2}-\d{2}"/.test(html));
  assert('campo de data final vem preenchido', /id="estat-fim" value="\d{4}-\d{2}-\d{2}"/.test(html));
  assert('tem o botão "← Voltar"', html.includes('← Voltar') && html.includes("irParaModo('dashboard')"));
}

console.log('── ordenarGrandezasEstatistica: temperatura e umidade vêm primeiro quando existem, sem presumir que todo sensor as tem ──');
{
  const entrada = [{ code: 'co2_value' }, { code: 'humidity_value' }, { code: 'temp_current' }];
  const ordenado = sandbox.ordenarGrandezasEstatistica(entrada).map(g => g.code);
  assert('temperatura primeiro, depois umidade, depois o resto', JSON.stringify(ordenado) === JSON.stringify(['temp_current', 'humidity_value', 'co2_value']));
  const soOutras = sandbox.ordenarGrandezasEstatistica([{ code: 'co2_value' }, { code: 'pm25_value' }]).map(g => g.code);
  assert('sensor sem temp/umidade não quebra, só mantém a ordem entre as que existem', JSON.stringify(soOutras) === JSON.stringify(['co2_value', 'pm25_value']));
}

console.log('── kpiCardEstatistica: "Dados insuficientes" quando não há amostra, nunca inventa número ──');
{
  const html = sandbox.kpiCardEstatistica({ code: 'temp_current', rotulo: 'Temperatura', unidade: '°C', amostrasValidas: 0, media: null, minimo: null, maximo: null, desvioPadrao: null, meta: null, desvioDaMeta: null, amostrasComLimiteAplicavel: 0, amostrasForaDoLimite: 0, proporcaoForaDoLimite: null });
  assert('mostra "Dados insuficientes" quando amostrasValidas é 0', html.includes('Dados insuficientes'));
  assert('card sem amostra fica na classe neutra "sem"', html.includes('qai-kpi sem'));
}

console.log('── kpiCardEstatistica: card completo (média, desvio, meta, limite) ──');
{
  const g = { code: 'temp_current', rotulo: 'Temperatura', unidade: '°C', amostrasValidas: 10, media: 24.5, minimo: 20, maximo: 28, desvioPadrao: 1.8, meta: 22, desvioDaMeta: 2.5, amostrasComLimiteAplicavel: 10, amostrasForaDoLimite: 3, proporcaoForaDoLimite: 0.3 };
  const html = sandbox.kpiCardEstatistica(g);
  assert('mostra a média formatada', html.includes('24.5'));
  assert('mostra mínimo e máximo', html.includes('20') && html.includes('28'));
  assert('mostra o desvio-padrão', html.includes('1.8'));
  assert('mostra o desvio da meta e a própria meta', html.includes('desvio da meta') && html.includes('meta 22'));
  assert('mostra a proporção fora do limite como % de AMOSTRAS, nunca "percentual do tempo"', html.includes('30%') && !html.toLowerCase().includes('percentual do tempo'));
  assert('card com amostras fora do limite fica na classe "fora"', html.includes('qai-kpi fora'));
}
{
  const gSemMeta = { code: 'co2_value', rotulo: 'CO₂', unidade: 'ppm', amostrasValidas: 1, media: 800, minimo: 800, maximo: 800, desvioPadrao: null, meta: null, desvioDaMeta: null, amostrasComLimiteAplicavel: 0, amostrasForaDoLimite: 0, proporcaoForaDoLimite: null };
  const html = sandbox.kpiCardEstatistica(gSemMeta);
  assert('sem meta configurada, não menciona "desvio da meta"', !html.includes('desvio da meta'));
  assert('com 1 amostra só, desvio-padrão é anunciado como dados insuficientes, nunca um número', html.includes('dados insuficientes'));
  assert('sem limite aplicável, explica isso em vez de mostrar 0%', html.includes('sem limite histórico aplicável'));
}

console.log('── renderResultadoEstatisticas: disponivel:false mostra "Dados insuficientes" com o motivo, nunca tenta montar cartão nenhum ──');
{
  elementoFalso('estat-conteudo').innerHTML = '';
  sandbox.renderResultadoEstatisticas({ grandezasAtivas: {} }, { disponivel: false, motivo: 'Configure latitude/longitude/fuso.' });
  const html = elementoFalso('estat-conteudo').innerHTML;
  assert('mostra "Dados insuficientes"', html.includes('Dados insuficientes'));
  assert('mostra o motivo explicando por quê', html.includes('Configure latitude/longitude/fuso.'));
}

console.log('── renderResultadoEstatisticas: resultado normal monta os cartões, o aviso de cobertura e o(s) gráfico(s) ──');
{
  elementoFalso('estat-conteudo').innerHTML = '';
  const sensor = { grandezasAtivas: { temp_current: { code: 'temp_current', rotulo: 'Temperatura', unidade: '°C' } }, limites: {}, exibicao: { agrupar: true } };
  const resultado = {
    disponivel: true, periodo: '24h', truncado: false,
    cobertura: { amostrasNoPeriodo: 5, intervaloMedioMin: 60, desvioIntervaloMin: 5 },
    grandezas: [{ code: 'temp_current', rotulo: 'Temperatura', unidade: '°C', amostrasValidas: 5, media: 24, minimo: 22, maximo: 26, desvioPadrao: 1, meta: null, desvioDaMeta: null, amostrasComLimiteAplicavel: 0, amostrasForaDoLimite: 0, proporcaoForaDoLimite: null }],
    serieTemporal: [{ criadoEm: Date.now() - 3600000, valores: { temp_current: 22 } }, { criadoEm: Date.now(), valores: { temp_current: 26 } }],
    serieTemporalTruncada: false,
  };
  sandbox.renderResultadoEstatisticas(sensor, resultado);
  const html = elementoFalso('estat-conteudo').innerHTML;
  assert('monta o cartão da grandeza', html.includes('Temperatura'));
  assert('mostra a quantidade de amostras no período', html.includes('5 amostra'));
  assert('mostra o intervalo médio entre amostras', html.includes('60 min'));
  assert('cria um gráfico (via Chart falso stubado no sandbox)', sandbox.__charts.length > 0);
}

console.log('── renderResultadoEstatisticas: 0 amostras no período avisa "Dados insuficientes" mesmo com disponivel:true (período sem leitura nenhuma) ──');
{
  elementoFalso('estat-conteudo').innerHTML = '';
  const sensor = { grandezasAtivas: { temp_current: { code: 'temp_current' } }, limites: {}, exibicao: { agrupar: true } };
  sandbox.renderResultadoEstatisticas(sensor, {
    disponivel: true, periodo: '24h', truncado: false,
    cobertura: { amostrasNoPeriodo: 0, intervaloMedioMin: null, desvioIntervaloMin: null },
    grandezas: [{ code: 'temp_current', rotulo: 'Temperatura', unidade: '°C', amostrasValidas: 0, media: null, minimo: null, maximo: null, desvioPadrao: null, meta: null, desvioDaMeta: null, amostrasComLimiteAplicavel: 0, amostrasForaDoLimite: 0, proporcaoForaDoLimite: null }],
    serieTemporal: [], serieTemporalTruncada: false,
  });
  assert('avisa "Dados insuficientes" quando não há nenhuma amostra no período, mesmo a config estando ok', elementoFalso('estat-conteudo').innerHTML.includes('Dados insuficientes'));
}

console.log('── buscarEstatisticas: ignora resposta de um filtro antigo depois de trocar o filtro de novo ──');
{
  vm.runInContext(`SENSOR_ABERTO = { id: 'sx', contrato: '1020', grandezasAtivas: {}, limites: {}, exibicao: { agrupar: true } };`, sandbox);
  elementoFalso('estat-inicio').value = '2026-03-01';
  elementoFalso('estat-fim').value = '2026-03-07';
  elementoFalso('estat-periodo').value = '24h';
  elementoFalso('estat-conteudo').innerHTML = '';

  let resolverPrimeira;
  vm.runInContext(`DB.getEstatisticasQai = (id, q) => new Promise(r => { __resolverPrimeira = r; });`, sandbox);
  const primeiraBusca = sandbox.buscarEstatisticas(); // fica pendente de propósito

  // Troca o filtro ANTES da 1ª resposta voltar — simula o usuário mudando
  // de ideia rápido. A 2ª busca resolve na hora.
  elementoFalso('estat-periodo').value = 'diurno';
  vm.runInContext(`DB.getEstatisticasQai = (id, q) => Promise.resolve({ disponivel: true, periodo: 'diurno', truncado: false, cobertura: { amostrasNoPeriodo: 1, intervaloMedioMin: null, desvioIntervaloMin: null }, grandezas: [{ code: 'temp_current', rotulo: 'Temperatura', unidade: '°C', amostrasValidas: 1, media: 24, minimo: 24, maximo: 24, desvioPadrao: null, meta: null, desvioDaMeta: null, amostrasComLimiteAplicavel: 0, amostrasForaDoLimite: 0, proporcaoForaDoLimite: null }], serieTemporal: [], serieTemporalTruncada: false });`, sandbox);
  await sandbox.buscarEstatisticas();
  const htmlAposSegunda = elementoFalso('estat-conteudo').innerHTML;

  // Só agora a 1ª promessa (do filtro velho) resolve, com um resultado
  // BEM diferente — se não fosse ignorada, sobrescreveria a tela.
  vm.runInContext(`__resolverPrimeira({ disponivel: true, periodo: '24h', truncado: false, cobertura: { amostrasNoPeriodo: 999, intervaloMedioMin: null, desvioIntervaloMin: null }, grandezas: [{ code: 'temp_current', rotulo: 'Temperatura', unidade: '°C', amostrasValidas: 999, media: 24, minimo: 24, maximo: 24, desvioPadrao: null, meta: null, desvioDaMeta: null, amostrasComLimiteAplicavel: 0, amostrasForaDoLimite: 0, proporcaoForaDoLimite: null }], serieTemporal: [], serieTemporalTruncada: false });`, sandbox);
  await primeiraBusca; // espera a função async inteira (inclusive o render) terminar — sem precisar de outro tick de verdade
  assert('a resposta do filtro velho (24h, 999 amostras) NUNCA chega a sobrescrever a tela', !elementoFalso('estat-conteudo').innerHTML.includes('999 amostra'));
  assert('a tela continua mostrando o resultado do filtro mais recente (diurno, 1 amostra)', elementoFalso('estat-conteudo').innerHTML.includes('1 amostra'));
}

console.log('── buscarEstatisticas: datas ausentes ou invertidas nunca chegam a chamar o servidor ──');
{
  vm.runInContext(`SENSOR_ABERTO = { id: 'sy', contrato: '1020', grandezasAtivas: {}, limites: {}, exibicao: { agrupar: true } };`, sandbox);
  let chamouServidor = false;
  vm.runInContext(`DB.getEstatisticasQai = () => { __chamou = true; return Promise.resolve({}); };`, sandbox);

  vm.runInContext(`__chamou = false;`, sandbox);
  elementoFalso('estat-inicio').value = '';
  elementoFalso('estat-fim').value = '2026-03-07';
  await sandbox.buscarEstatisticas();
  assert('sem data inicial, nunca chama o servidor', vm.runInContext('__chamou', sandbox) === false);
  assert('avisa que falta selecionar a data', elementoFalso('estat-conteudo').innerHTML.includes('Selecione'));

  vm.runInContext(`__chamou = false;`, sandbox);
  elementoFalso('estat-inicio').value = '2026-03-10';
  elementoFalso('estat-fim').value = '2026-03-01';
  await sandbox.buscarEstatisticas();
  assert('data inicial depois da final nunca chama o servidor', vm.runInContext('__chamou', sandbox) === false);
  assert('avisa que o período é inválido', elementoFalso('estat-conteudo').innerHTML.includes('não pode ser depois'));
}

console.log('── renderComparacao (Fase 5): indisponível mostra motivo, sem aparentar erro grave ──');
{
  elementoFalso('estat-comparacao').innerHTML = '';
  sandbox.renderComparacao({ disponivel: false, motivo: 'Integração climática não configurada.' });
  const html = elementoFalso('estat-comparacao').innerHTML;
  assert('mostra o título do bloco', html.includes('Comparação com o clima externo'));
  assert('mostra o motivo', html.includes('Integração climática não configurada.'));
}

console.log('── renderComparacao: disponível mas sem pares válidos — "Dados insuficientes", nunca um cartão com número inventado ──');
{
  elementoFalso('estat-comparacao').innerHTML = '';
  sandbox.renderComparacao({
    disponivel: true, toleranciaMin: 35,
    cobertura: { totalInterno: 3, totalExterno: 0, paresTemperatura: 0, paresUmidade: 0 },
    temperatura: { pares: [], diferencaMedia: null, correlacao: null, correlacaoIndisponivel: null },
    umidade: { pares: [] },
    avisos: { correlacaoNaoEhCausalidade: 'x', dependenciaTemporal: 'y', umidadeRelativa: 'z' },
  });
  assert('mostra "Dados insuficientes" quando não há pares válidos', elementoFalso('estat-comparacao').innerHTML.includes('Dados insuficientes'));
}

console.log('── renderComparacao: resultado completo — diferença de temperatura, correlação e os 3 avisos sempre presentes ──');
{
  elementoFalso('estat-comparacao').innerHTML = '';
  sandbox.renderComparacao({
    disponivel: true, toleranciaMin: 35,
    cobertura: { totalInterno: 20, totalExterno: 24, paresTemperatura: 18, paresUmidade: 18 },
    temperatura: { pares: [], diferencaMedia: 3.2, correlacao: 0.87, correlacaoIndisponivel: null },
    umidade: { pares: [{}] },
    avisos: {
      correlacaoNaoEhCausalidade: 'Correlação não implica causa.',
      dependenciaTemporal: 'Autocorrelação temporal presente.',
      umidadeRelativa: 'Umidade é relativa, não absoluta.',
    },
  });
  const html = elementoFalso('estat-comparacao').innerHTML;
  assert('mostra a diferença média de temperatura', html.includes('3.2'));
  assert('mostra a correlação calculada', html.includes('0.87'));
  assert('mostra o aviso de correlação não é causa', html.includes('Correlação não implica causa.'));
  assert('mostra o aviso de dependência temporal', html.includes('Autocorrelação temporal presente.'));
  assert('mostra o aviso de umidade relativa', html.includes('Umidade é relativa, não absoluta.'));
  assert('sem serieTemporalTruncada, não mostra o aviso de recorte parcial', !html.includes('não o período inteiro'));
}

console.log('── renderComparacao: serieTemporalTruncada:true avisa que a comparação usou um recorte, não o período inteiro ──');
{
  elementoFalso('estat-comparacao').innerHTML = '';
  sandbox.renderComparacao({
    disponivel: true, toleranciaMin: 35, serieTemporalTruncada: true,
    cobertura: { totalInterno: 300, totalExterno: 2160, paresTemperatura: 290, paresUmidade: 290 },
    temperatura: { pares: [], diferencaMedia: 2, correlacao: 0.5, correlacaoIndisponivel: null },
    umidade: { pares: [{}] },
    avisos: { correlacaoNaoEhCausalidade: 'a', dependenciaTemporal: 'b', umidadeRelativa: 'c' },
  });
  assert('mostra o aviso de recorte parcial quando serieTemporalTruncada é true', elementoFalso('estat-comparacao').innerHTML.includes('não o período inteiro'));
}

console.log('── buscarEstatisticas: busca estatísticas e comparação em paralelo, e repassa a comparação pro render ──');
{
  vm.runInContext(`SENSOR_ABERTO = { id: 'sz', contrato: '1020', grandezasAtivas: { temp_current: { code: 'temp_current', rotulo: 'Temperatura', unidade: '°C' } }, limites: {}, exibicao: { agrupar: true } };`, sandbox);
  elementoFalso('estat-inicio').value = '2026-03-01';
  elementoFalso('estat-fim').value = '2026-03-07';
  elementoFalso('estat-periodo').value = '24h';
  elementoFalso('estat-conteudo').innerHTML = '';
  elementoFalso('estat-comparacao').innerHTML = '';
  vm.runInContext(`
    DB.getEstatisticasQai = () => Promise.resolve({ disponivel: true, periodo: '24h', truncado: false, cobertura: { amostrasNoPeriodo: 2, intervaloMedioMin: null, desvioIntervaloMin: null }, grandezas: [{ code: 'temp_current', rotulo: 'Temperatura', unidade: '°C', amostrasValidas: 2, media: 24, minimo: 23, maximo: 25, desvioPadrao: 1, meta: null, desvioDaMeta: null, amostrasComLimiteAplicavel: 0, amostrasForaDoLimite: 0, proporcaoForaDoLimite: null }], serieTemporal: [], serieTemporalTruncada: false });
    DB.getComparacaoQai = () => Promise.resolve({ disponivel: true, toleranciaMin: 35, cobertura: { totalInterno: 2, totalExterno: 2, paresTemperatura: 1, paresUmidade: 0 }, temperatura: { pares: [], diferencaMedia: 1.5, correlacao: null, correlacaoIndisponivel: 'amostra insuficiente' }, umidade: { pares: [] }, avisos: { correlacaoNaoEhCausalidade: 'a', dependenciaTemporal: 'b', umidadeRelativa: 'c' } });
  `, sandbox);
  await sandbox.buscarEstatisticas();
  assert('estatísticas renderizadas normalmente', elementoFalso('estat-conteudo').innerHTML.includes('Temperatura'));
  assert('comparação também renderizada na mesma busca', elementoFalso('estat-comparacao').innerHTML.includes('1.5'));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
// process.exit() (não só exitCode) de propósito, igual ao fim de linha
// único que este arquivo sempre teve: sai na hora, sem deixar nenhum
// timer pendente (de uma renderização síncrona anterior) dar a chance de
// disparar — mesma garantia de sempre, agora atrás de um IIFE async.
process.exit(falhas === 0 ? 0 : 1);
})();
