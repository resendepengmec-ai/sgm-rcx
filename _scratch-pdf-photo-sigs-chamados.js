'use strict';
// Etapa 4: _pdfPhotoSigs (chamados.html) deve gerar a mesma legenda HMAC já
// usada em registro.html, com a data fixa em America/Sao_Paulo.
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'chamados.html'), 'utf8');
const m = src.match(/function _pdfPhotoSigs\([\s\S]*?\n\}/);
if (!m) throw new Error('_pdfPhotoSigs não encontrada em chamados.html — extração do teste ficou desatualizada');

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

function novoDocFalso() {
  const linhas = [];
  return {
    linhas,
    _y: 0,
    setFontSize() {}, setFont() {}, setTextColor() {},
    addPage() { this._y = 0; },
    text(s, x, y) { linhas.push({ s, x, y }); },
  };
}

const sandbox = { console, Date };
vm.createContext(sandbox);
vm.runInContext(m[0] + '\nthis._pdfPhotoSigs = _pdfPhotoSigs;', sandbox);

console.log('── Caso 1: foto sem .sig não gera nenhuma linha (y não muda) ──');
{
  const doc = novoDocFalso();
  const y = sandbox._pdfPhotoSigs(doc, [{ id: 'p1' }], 10, 50);
  assert('y inalterado', y === 50);
  assert('nenhuma linha desenhada', doc.linhas.length === 0);
}

console.log('── Caso 2: foto com .sig gera a legenda no formato esperado ──');
{
  const doc = novoDocFalso();
  const instanteUTC = Date.UTC(2026, 10, 1, 15, 0, 0); // 12:00 em São Paulo
  const photos = [{ id: 'p1', sig: { by: 'Fulano', role: 'tecnico', at: instanteUTC, hash: 'abcdef0123456789', keyId: 'k1' } }];
  const y = sandbox._pdfPhotoSigs(doc, photos, 10, 50);
  assert('uma linha desenhada', doc.linhas.length === 1);
  const texto = doc.linhas[0].s;
  assert('contém o nome e o papel', texto.includes('Fulano') && texto.includes('tecnico'));
  assert('horário em America/Sao_Paulo (12:00), não UTC (15:00)', texto.includes('12:00') && !texto.includes('15:00'));
  assert('HMAC truncado em 8 caracteres', texto.includes('HMAC abcdef01'));
  assert('keyId presente', texto.includes('[k1]'));
  assert('y avançou (pelo menos uma linha + respiro)', y > 50);
}

console.log('── Caso 3: foto sem sig.keyId cai no rótulo "legacy" ──');
{
  const doc = novoDocFalso();
  const photos = [{ sig: { by: 'X', role: 'gestor', at: Date.now(), hash: 'aa' } }];
  sandbox._pdfPhotoSigs(doc, photos, 10, 50);
  assert('mostra [legacy] quando não há keyId', doc.linhas[0].s.includes('[legacy]'));
}

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou');
process.exitCode = falhas ? 1 : 0;
