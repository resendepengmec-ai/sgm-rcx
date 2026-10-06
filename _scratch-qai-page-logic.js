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
  Chart: function () { this.destroy = () => {}; },
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

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
