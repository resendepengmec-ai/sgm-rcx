// ── zip-stream.js — escritor de ZIP mínimo (modo STORED, sem compressão) ──
// Fase 2 do SGM: o backup completo passou a baixar arquivo por arquivo
// (fotos/documentos/logo) em vez de já ter tudo embutido em base64 no
// JSON. Este módulo empacota o que foi baixado num .zip, sem depender de
// biblioteca externa (mesma filosofia de dependência mínima do backend —
// ver comentário em validate.js) e sem recodificar em base64 em momento
// nenhum: trabalha direto com Uint8Array/Blob.
//
// Por que STORED (sem compressão) de propósito: o conteúdo já é
// majoritariamente JPEG/PNG e PDF, que não comprimem mais — o ganho de
// implementar DEFLATE seria pequeno e o custo de manutenção não. Um ZIP
// STORED ainda é um .zip válido, abre em qualquer sistema operacional.
//
// Limite: ZIP32 clássico (sem ZIP64) — até ~4 GB e 65535 arquivos por
// parte. O chamador (backup.html) já divide em partes de ~500 MB, bem
// abaixo desse teto.
'use strict';
(function (global) {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes, crc = 0xFFFFFFFF) {
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return crc;
  }
  function crc32Final(crc) { return (crc ^ 0xFFFFFFFF) >>> 0; }

  function dosDateTime(date) {
    const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
    const day = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
    return { time, day };
  }
  function u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }
  function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; }
  function utf8(str) { return new TextEncoder().encode(str); }

  // Escritor incremental: addFile() recebe UM arquivo de cada vez (Blob ou
  // Uint8Array) — não precisa ter todos em memória ao mesmo tempo, só o
  // atual. finish() devolve o Blob final do .zip.
  class ZipWriter {
    constructor() {
      this._chunks = [];       // partes já escritas (Blob), acumuladas por referência — sem recopiar bytes
      this._offset = 0;
      this._central = [];      // registros de diretório central (metadados, pequenos)
    }
    async addFile(name, data, date = new Date()) {
      const bytes = data instanceof Uint8Array ? data
        : data instanceof Blob ? new Uint8Array(await data.arrayBuffer())
        : new Uint8Array(data);
      const nameBytes = utf8(name);
      const crc = crc32Final(crc32(bytes));
      const { time, day } = dosDateTime(date);
      const localHeaderOffset = this._offset;

      const local = new Uint8Array(30 + nameBytes.length);
      local.set(u32(0x04034b50), 0);         // assinatura local file header
      local.set(u16(20), 4);                 // versão mínima
      local.set(u16(0), 6);                  // flags
      local.set(u16(0), 8);                  // método: 0 = STORED
      local.set(u16(time), 10);
      local.set(u16(day), 12);
      local.set(u32(crc), 14);
      local.set(u32(bytes.length), 18);      // compressed size == uncompressed (STORED)
      local.set(u32(bytes.length), 22);
      local.set(u16(nameBytes.length), 26);
      local.set(u16(0), 28);                 // extra field length
      local.set(nameBytes, 30);

      this._chunks.push(local, bytes);
      this._offset += local.length + bytes.length;

      const central = new Uint8Array(46 + nameBytes.length);
      central.set(u32(0x02014b50), 0);       // assinatura central directory
      central.set(u16(20), 4);               // versão que gravou
      central.set(u16(20), 6);               // versão mínima
      central.set(u16(0), 8);
      central.set(u16(0), 10);
      central.set(u16(time), 12);
      central.set(u16(day), 14);
      central.set(u32(crc), 16);
      central.set(u32(bytes.length), 20);
      central.set(u32(bytes.length), 24);
      central.set(u16(nameBytes.length), 28);
      central.set(u16(0), 30);               // extra
      central.set(u16(0), 32);               // comment
      central.set(u16(0), 34);               // disk number start
      central.set(u16(0), 36);               // internal attrs
      central.set(u32(0), 38);                // external attrs
      central.set(u32(localHeaderOffset), 42);
      central.set(nameBytes, 46);
      this._central.push(central);
    }
    // Tamanho aproximado já escrito (dados + headers locais), para o
    // chamador decidir quando fechar a parte atual e abrir a próxima.
    get bytesWritten() { return this._offset; }

    finish() {
      const centralOffset = this._offset;
      let centralSize = 0;
      for (const c of this._central) centralSize += c.length;

      const end = new Uint8Array(22);
      end.set(u32(0x06054b50), 0);
      end.set(u16(0), 4);
      end.set(u16(0), 6);
      end.set(u16(this._central.length), 8);
      end.set(u16(this._central.length), 10);
      end.set(u32(centralSize), 12);
      end.set(u32(centralOffset), 16);
      end.set(u16(0), 20);

      const parts = [...this._chunks, ...this._central, end];
      return new Blob(parts, { type: 'application/zip' });
    }
  }

  global.ZipWriter = ZipWriter;
})(typeof window !== 'undefined' ? window : globalThis);
