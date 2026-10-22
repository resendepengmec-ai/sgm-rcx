'use strict';
// Bug corrigido: a pré-visualização em tela do módulo "relatório"
// (render() → photoCell) usa _dados.chamados/_dados.registros, que vêm de
// GET ?resumo=1 — SEMPRE photos:[] (só photoCount, resumirRegistro em
// api.js). photoCell(photos) antigo media só `photos.length`, então toda
// linha mostrava "—" mesmo em registros/chamados com fotos reais,
// insinuando que não havia foto nenhuma. O PDF exportado de verdade
// (generatePDF → loadReportDetails) já hidratava corretamente e não tinha
// esse bug — só a pré-visualização. Este teste roda a função REAL
// extraída de relatorio.html (photoCell, agora com o parâmetro
// photoCount) e confere que ela mostra a contagem em vez do "—" falso.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'relatorio.html'), 'utf8');
const apiClient = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');

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

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  extraeFuncao(apiClient, 'fotoAttrs') + '\n' +
  extraeFuncao(html, 'photoCell') + '\n' +
  'this.fotoAttrs=fotoAttrs; this.photoCell=photoCell;',
  sandbox
);

console.log('── photoCell: registro vindo da lista leve (?resumo=1), com fotos reais no servidor (photoCount>0) ──');
{
  const html1 = sandbox.photoCell([], 3);
  assert('mostra a contagem de fotos (📷 3) em vez de "—"', /📷\s*3/.test(html1));
  assert('NÃO mostra o "—" de "sem foto nenhuma" (seria falso aqui)', !html1.includes('—'));
}

console.log('── photoCell: registro sem foto nenhuma (photoCount 0) continua mostrando "—" ──');
{
  const html2 = sandbox.photoCell([], 0);
  assert('mostra "—" quando realmente não há foto', html2.includes('—'));
}
{
  const html2b = sandbox.photoCell([], undefined);
  assert('photoCount ausente (undefined) também cai no "—", não quebra', html2b.includes('—'));
}

console.log('── photoCell: registro JÁ hidratado (fotos reais presentes) continua mostrando a miniatura de verdade ──');
{
  const foto = { url: 'https://cdn.exemplo/foto1.jpg', geo: { lat: -16.6, lng: -49.2, shortAddress: 'Rua X' } };
  const html3 = sandbox.photoCell([foto], 1);
  assert('renderiza a miniatura <img> quando o array de fotos já está populado', html3.includes('<img'));
  assert('não usa o badge de contagem quando já tem a foto de verdade', !/📷/.test(html3));
}
{
  const fotos = [{ url: 'a.jpg' }, { url: 'b.jpg' }, { url: 'c.jpg' }];
  const html4 = sandbox.photoCell(fotos, 3);
  assert('com várias fotos reais, mostra "+2" além da miniatura', html4.includes('+2'));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
