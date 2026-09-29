#!/usr/bin/env node
/* pdf-seguro.test.js — valida a lógica pura de pdf-seguro.js (Fase 3):
 * cálculo de progresso, backoff de retry, decisão de volume por memória,
 * estimativa de tempo restante. A parte dependente de navegador
 * (createImageBitmap/OffscreenCanvas/wakeLock/modal) não tem como ser
 * testada em Node — só leitura cuidadosa do código.
 *
 * Uso: node pdf-seguro.test.js
 */
'use strict';
const {
  PDF_SEGURO_PESOS, pdfSeguroProgresso, pdfSeguroBackoffMs,
  PDF_SEGURO_LIMITE_VOLUME_BYTES, pdfSeguroPrecisaNovoVolume,
  pdfSeguroTempoRestanteMs, pdfSeguroFormatarTempo,
} = require('./pdf-seguro.js');

let passou = 0, falhou = 0;
function checar(nome, cond, det = '') {
  if (cond) { passou++; console.log(`  ✓ ${nome}`); }
  else { falhou++; console.log(`  ✗ ${nome}${det ? '\n      ' + det : ''}`); }
}

console.log('\n═══ pdf-seguro.js — lógica pura (Fase 3) ═══\n');

console.log('── Pesos somam 100 ──');
{
  const soma = Object.values(PDF_SEGURO_PESOS).reduce((a, b) => a + b, 0);
  checar('precalculo+registros+fotos+montagem+saida = 100', soma === 100, `soma=${soma}`);
}

console.log('\n── Progresso: monotônico, nunca passa de 100, só fecha em 100 com saida completo ──');
{
  checar('tudo zerado = 0%', pdfSeguroProgresso({}) === 0);
  checar('só precalculo completo = 2%', pdfSeguroProgresso({ precalculo: 1 }) === 2);
  checar('precalculo+registros completos = 10%', pdfSeguroProgresso({ precalculo: 1, registros: 1 }) === 10);
  checar('tudo completo = 100%', pdfSeguroProgresso({ precalculo: 1, registros: 1, fotos: 1, montagem: 1, saida: 1 }) === 100);
  checar('fotos pela metade conta proporcional (2+8+40=50)', pdfSeguroProgresso({ precalculo: 1, registros: 1, fotos: 0.5 }) === 50);
  checar('fração negativa não desconta (clamp em 0)', pdfSeguroProgresso({ precalculo: -1 }) === 0);
  checar('fração > 1 não estoura o peso da etapa (clamp em 1)', pdfSeguroProgresso({ precalculo: 5 }) === 2);

  // Monotonicidade: uma sequência crescente de estados nunca gera um
  // percentual menor que o anterior (é a garantia central do prompt:
  // "o percentual nunca retrocede").
  const sequencia = [
    {}, { precalculo: 1 }, { precalculo: 1, registros: 0.5 }, { precalculo: 1, registros: 1 },
    { precalculo: 1, registros: 1, fotos: 0.3 }, { precalculo: 1, registros: 1, fotos: 0.9 },
    { precalculo: 1, registros: 1, fotos: 1 }, { precalculo: 1, registros: 1, fotos: 1, montagem: 1 },
    { precalculo: 1, registros: 1, fotos: 1, montagem: 1, saida: 1 },
  ];
  let anterior = -1, monotonico = true;
  for (const estado of sequencia) {
    const pct = pdfSeguroProgresso(estado);
    if (pct < anterior) monotonico = false;
    anterior = pct;
  }
  checar('sequência de estados crescentes gera percentuais não-decrescentes', monotonico);
  checar('só 100% quando saida=1 (não antes)', pdfSeguroProgresso({ precalculo: 1, registros: 1, fotos: 1, montagem: 1 }) === 95);
}

console.log('\n── Backoff de retry: 300ms, 900ms, 2700ms ──');
{
  checar('1ª nova tentativa: 300ms', pdfSeguroBackoffMs(1) === 300);
  checar('2ª nova tentativa: 900ms', pdfSeguroBackoffMs(2) === 900);
  checar('3ª nova tentativa: 2700ms', pdfSeguroBackoffMs(3) === 2700);
  checar('tentativa 0 (ou negativa) não quebra: 300ms', pdfSeguroBackoffMs(0) === 300);
}

console.log('\n── Divisão em volumes por memória (150 MB) ──');
{
  checar('limite é 150 MB', PDF_SEGURO_LIMITE_VOLUME_BYTES === 150 * 1024 * 1024);
  checar('abaixo do limite: não precisa de novo volume', !pdfSeguroPrecisaNovoVolume(100 * 1024 * 1024));
  checar('exatamente no limite: precisa (>=)', pdfSeguroPrecisaNovoVolume(150 * 1024 * 1024));
  checar('acima do limite: precisa', pdfSeguroPrecisaNovoVolume(200 * 1024 * 1024));
  checar('limite customizado é respeitado', pdfSeguroPrecisaNovoVolume(50, 40));
  checar('limite customizado: abaixo não dispara', !pdfSeguroPrecisaNovoVolume(30, 40));
}

console.log('\n── Tempo restante estimado (média móvel) ──');
{
  checar('sem histórico: null ("calculando…")', pdfSeguroTempoRestanteMs([], 10) === null);
  checar('sem fotos restantes: null', pdfSeguroTempoRestanteMs([100, 200], 0) === null);
  checar('histórico uniforme (100ms cada), 5 restantes: 500ms', pdfSeguroTempoRestanteMs([100, 100, 100], 5) === 500);
  checar('histórico variado usa a média', pdfSeguroTempoRestanteMs([100, 300], 2) === 400); // média 200 × 2

  checar('formata segundos', pdfSeguroFormatarTempo(45000) === '45s');
  checar('formata minutos exatos', pdfSeguroFormatarTempo(120000) === '2min');
  checar('formata minutos com resto', pdfSeguroFormatarTempo(125000) === '2min 5s');
  checar('null vira "calculando…"', pdfSeguroFormatarTempo(null) === 'calculando…');
}

console.log(`\n═══ RESULTADO: ${passou} passaram, ${falhou} falharam ═══`);
if (falhou) process.exit(1);
