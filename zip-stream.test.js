#!/usr/bin/env node
/* zip-stream.test.js — valida vendor/zip-stream.js (Fase 2: backup.html
 * monta o .zip do backup completo com este escritor, sem depender de
 * biblioteca externa).
 *
 * Roda o script num sandbox de VM com um Blob/TextEncoder mínimos (os
 * mesmos que o navegador oferece) e confere:
 *   1) o .zip produzido é lido corretamente por outro leitor de ZIP
 *      independente (implementado aqui, sem reaproveitar código do
 *      escritor — senão um bug espelhado nos dois lados passaria
 *      despercebido);
 *   2) bytes binários (>127, ITENS com \0 etc.) sobrevivem intactos;
 *   3) escritas concorrentes (download em paralelo, escrita em série via
 *      mutex) não corrompem o arquivo, nem duplicam nem perdem entradas.
 *
 * Uso: node zip-stream.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// CRC-32 próprio (não depende de zlib.crc32, indisponível em Node < 20.12,
// nem de pacote externo — mesma filosofia de dependência mínima do projeto).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32Buf(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

let passou = 0, falhou = 0;
function checar(nome, cond, det = '') {
  if (cond) { passou++; console.log(`  ✓ ${nome}`); }
  else { falhou++; console.log(`  ✗ ${nome}${det ? '\n      ' + det : ''}`); }
}

const code = fs.readFileSync(path.join(__dirname, 'vendor', 'zip-stream.js'), 'utf8');
const sandbox = { window: {}, TextEncoder, Uint8Array, DataView, Blob };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const ZipWriter = sandbox.window.ZipWriter;

// Leitor de ZIP independente, só para conferência (não usa nenhum código
// do escritor). Suporta só STORED, que é tudo que o escritor produz.
function lerZipStored(buf) {
  const arquivos = [];
  let eocdOffset = buf.length - 22;
  while (eocdOffset >= 0 && buf.readUInt32LE(eocdOffset) !== 0x06054b50) eocdOffset--;
  if (eocdOffset < 0) throw new Error('EOCD não encontrado');
  const totalCentral = buf.readUInt16LE(eocdOffset + 10);
  let centralOffset = buf.readUInt32LE(eocdOffset + 16);
  for (let i = 0; i < totalCentral; i++) {
    if (buf.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error('assinatura central inválida em ' + centralOffset);
    const method = buf.readUInt16LE(centralOffset + 10);
    const crcEsperado = buf.readUInt32LE(centralOffset + 16);
    const compSize = buf.readUInt32LE(centralOffset + 20);
    const nameLen = buf.readUInt16LE(centralOffset + 28);
    const extraLen = buf.readUInt16LE(centralOffset + 30);
    const commentLen = buf.readUInt16LE(centralOffset + 32);
    const localOffset = buf.readUInt32LE(centralOffset + 42);
    const name = buf.toString('utf8', centralOffset + 46, centralOffset + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    const crcReal = crc32Buf(data);

    arquivos.push({ name, method, data: Buffer.from(data), crcOk: crcReal === crcEsperado });
    centralOffset += 46 + nameLen + extraLen + commentLen;
  }
  return arquivos;
}

async function testeBasico() {
  const zw = new ZipWriter();
  const binario = new Uint8Array(300);
  for (let i = 0; i < binario.length; i++) binario[i] = i % 256; // cobre toda a faixa de bytes, inclusive >127 e \0
  await zw.addFile('dados.json', new TextEncoder().encode(JSON.stringify({ ok: true, acento: 'ção' })));
  await zw.addFile('arquivos/bin.dat', binario);
  await zw.addFile('pasta/vazio.txt', new Uint8Array(0));
  const blob = zw.finish();
  const buf = Buffer.from(await blob.arrayBuffer());

  checar('assina como ZIP válido (PK\\x03\\x04 no início)', buf.readUInt32LE(0) === 0x04034b50);

  const lidos = lerZipStored(buf);
  checar('lê de volta 3 entradas', lidos.length === 3, `leu ${lidos.length}`);
  checar('todos os métodos são STORED (0)', lidos.every(f => f.method === 0));
  checar('todos os CRC-32 batem', lidos.every(f => f.crcOk), lidos.filter(f=>!f.crcOk).map(f=>f.name).join(','));

  const dadosJson = lidos.find(f => f.name === 'dados.json');
  checar('dados.json com conteúdo exato (utf-8 com acento)', dadosJson && JSON.parse(dadosJson.data.toString('utf8')).acento === 'ção');

  const binLido = lidos.find(f => f.name === 'arquivos/bin.dat');
  checar('bytes binários (0-255) preservados exatamente', binLido && Buffer.compare(binLido.data, Buffer.from(binario)) === 0);

  const vazio = lidos.find(f => f.name === 'pasta/vazio.txt');
  checar('arquivo vazio (0 bytes) é lido corretamente', vazio && vazio.data.length === 0);
}

async function testeConcorrencia() {
  const zw = new ZipWriter();
  let escrevendo = Promise.resolve();
  const escreverSerial = fn => { const p = escrevendo.then(fn, fn); escrevendo = p.catch(() => {}); return p; };

  const N = 60;
  const escritos = [];
  await Promise.all(Array.from({ length: N }, (_, i) => (async () => {
    await new Promise(r => setTimeout(r, Math.random() * 15)); // "download" concorrente
    await escreverSerial(async () => {
      await zw.addFile(`arquivos/item-${i}.bin`, new TextEncoder().encode('conteudo-' + i));
      escritos.push(i);
    });
  })()));

  checar('mutex serializa: todas as 60 escritas aconteceram', escritos.length === N, `só ${escritos.length}`);
  checar('mutex serializa: nenhuma duplicada', new Set(escritos).size === N);

  const buf = Buffer.from(await zw.finish().arrayBuffer());
  const lidos = lerZipStored(buf);
  checar('zip final tem as 60 entradas, sem corrupção', lidos.length === N, `leu ${lidos.length}`);
  checar('todo conteúdo bate com o índice esperado', lidos.every(f => {
    const i = f.name.match(/item-(\d+)\.bin/)[1];
    return f.data.toString('utf8') === 'conteudo-' + i;
  }));
}

async function testeBytesWrittenControlaPartes() {
  const zw = new ZipWriter();
  checar('bytesWritten começa em 0', zw.bytesWritten === 0);
  await zw.addFile('a.bin', new Uint8Array(1000));
  checar('bytesWritten cresce após addFile', zw.bytesWritten > 1000);
}

(async () => {
  console.log('\n═══ zip-stream.js — escritor de ZIP (Fase 2) ═══\n');
  console.log('── Estrutura básica e integridade de bytes ──');
  await testeBasico();
  console.log('\n── Download concorrente + escrita serializada (mutex) ──');
  await testeConcorrencia();
  console.log('\n── Controle de tamanho por parte ──');
  await testeBytesWrittenControlaPartes();
  console.log(`\n═══ RESULTADO: ${passou} passaram, ${falhou} falharam ═══`);
  if (falhou) process.exit(1);
})();
