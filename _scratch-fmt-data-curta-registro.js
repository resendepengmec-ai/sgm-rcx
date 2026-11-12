'use strict';
// Etapa 2: fmtDataCurta (registro.html) não pode cair no dia anterior em
// fuso atrás de UTC — bug clássico de new Date('YYYY-MM-DD') sozinho.
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'registro.html'), 'utf8');
const m = src.match(/const fmtDataCurta = [^\n]+/);
if (!m) throw new Error('fmtDataCurta não encontrada em registro.html — extração do teste ficou desatualizada');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(m[0] + '\nthis.fmtDataCurta = fmtDataCurta;', sandbox);

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

assert('data-só (YYYY-MM-DD) exibe o mesmo dia, não o anterior', sandbox.fmtDataCurta('2026-11-01') === '01/11/2026');
assert('vazio/undefined cai no placeholder', sandbox.fmtDataCurta('') === '—' && sandbox.fmtDataCurta(undefined) === '—');
assert('virada de ano funciona', sandbox.fmtDataCurta('2026-12-31') === '31/12/2026');

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou');
process.exit(falhas ? 1 : 0);
