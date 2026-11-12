'use strict';
// Etapa 2: fmtDataHoraBR deve mostrar o MESMO horário de Brasília pra quem
// olhar a tela, não importa o fuso do dispositivo que está vendo.
// Extrai só a função (é autocontida — só usa Date/toLocaleString, nada do
// DOM) em vez de rodar o api-client.js inteiro, que tem side-effects de
// topo (addEventListener, setInterval) que não interessam aqui.
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');
const m = src.match(/function fmtDataHoraBR\([\s\S]*?\n\}/);
if (!m) throw new Error('fmtDataHoraBR não encontrada em api-client.js — extração do teste ficou desatualizada');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(m[0] + '\nthis.fmtDataHoraBR = fmtDataHoraBR;', sandbox);

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

// 2026-11-01 15:00 UTC = 2026-11-01 12:00 em São Paulo (UTC-3, sem horário de verão).
const instanteUTC = Date.UTC(2026, 10, 1, 15, 0, 0);
const rotulo = sandbox.fmtDataHoraBR(instanteUTC);
assert('horário mostrado é o de Brasília (12:00), não o UTC (15:00)', rotulo.includes('12:00'));
assert('data (01/11) está correta', rotulo.includes('01/11'));

// Virada de dia: 2026-11-01 02:00 UTC = 2026-10-31 23:00 em São Paulo —
// sem timeZone fixo, um dispositivo em UTC mostraria 02:00 do dia 01; o
// rótulo tem que mostrar 31/10 23:00, não 01/11 02:00.
const instanteVirada = Date.UTC(2026, 10, 1, 2, 0, 0);
const rotuloVirada = sandbox.fmtDataHoraBR(instanteVirada);
assert('virada de dia respeita o fuso de Brasília (31/10, não 01/11)', rotuloVirada.includes('31/10') && rotuloVirada.includes('23:00'));

// opts extra (usado por sigTrailPdfLines-style) continuam funcionando.
const comAno = sandbox.fmtDataHoraBR(instanteUTC, { year: 'numeric' });
assert('opts extra (year) são aplicadas por cima do padrão', comAno.includes('2026'));

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou');
process.exit(falhas ? 1 : 0);
