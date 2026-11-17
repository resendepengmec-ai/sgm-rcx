'use strict';
// Relatório com contratos misturados (lista + franquia) no navegador.
// Uso: node tools/layout-audit/smoke-relatorio-consumo.js
const path = require('path'), fs = require('fs');
const RAIZ = path.join(__dirname, '..', '..');
const pw = require('playwright');
const { responder, sessao, CONTRATOS } = require('./fixtures');
const API = 'https://smm-backend-a8a4.onrender.com';
let falhas = 0; const ok = (d, c) => { console.log(c ? '  ✓' : '  ✗', d); if (!c) falhas++; };

const FRANQ = { id: 'cf', numero: '7777', razao: 'Linha branca', ativo: true, modeloCorretiva: 'franquia', equipamentos: [] };
const REGS = [
  { id: 'L1', date: '2026-11-10', client: '1020', equip: '9', items: [{ name: 'Limpeza', qty: 1, price: 100 }], machine: { estabelecimento: 'Escola L' }, photos: [], photoCount: 0 },
  { id: 'F1', date: '2026-11-11', client: '7777', equip: '5', modeloCorretiva: 'franquia', machine: { estabelecimento: 'Escola F', familia: 'refrigeracao' }, photos: [], photoCount: 0,
    items: [{ qtd: 2, unidade: 'un', termoId: 'c:cf:refrigeracao:SUB.ALCA', componente: 'Alça', descricao: 'Substituição · Alça', name: 'Substituição · Alça' }] },
  { id: 'F2', date: '2026-11-12', client: '7777', equip: '5', modeloCorretiva: 'franquia', machine: { estabelecimento: 'Escola F', familia: 'refrigeracao' }, photos: [], photoCount: 0,
    items: [{ qtd: 1, unidade: 'un', termoId: 'b:refrigeracao:SUB.PUXADOR', componente: 'Puxador', descricao: 'Substituição · Puxador', name: 'Substituição · Puxador' }] },
];
const VOCAB = { termos: [{ i: 'b:refrigeracao:SUB.PUXADOR', f: 'refrigeracao', a: 'SUB', k: 'Puxador' }], mesclados: { 'c:cf:refrigeracao:SUB.ALCA': 'b:refrigeracao:SUB.PUXADOR' } };

(async () => {
  const b = await pw.chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const erros = []; page.on('pageerror', e => erros.push(e.stack || e.message));
  await page.addInitScript(jwt => sessionStorage.setItem('smm_jwt', jwt), sessao('supervisor'));
  await page.route('**/*', async route => {
    const rq = route.request(), u = rq.url();
    if (u.startsWith(API)) {
      const p = new URL(u).pathname.replace(/^\/api/, '');
      const json = (data, extra) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data, ...extra }) });
      if (p === '/contratos' && rq.method() === 'GET') return json([...CONTRATOS, FRANQ]);
      if (p === '/registros') return json(REGS, { pagination: { nextOffset: null } });
      if (p === '/vocab') return json(VOCAB);
      return responder(route, 'supervisor');
    }
    if (new URL(u).hostname === '127.0.0.1') {
      const full = path.join(RAIZ, decodeURIComponent(new URL(u).pathname));
      if (!fs.existsSync(full)) return route.fulfill({ status: 404, body: '' });
      const t = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(full)] || 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: t, body: fs.readFileSync(full) });
    }
    return route.abort();
  });
  await page.goto('http://127.0.0.1:8099/relatorio.html');
  await page.waitForSelector('.app-header');
  await page.evaluate(async () => { document.getElementById('f-periodo-ini').value = '2026-11'; document.getElementById('f-periodo-fim').value = '2026-11'; await render(); });
  await page.waitForSelector('#section-consumo', { state: 'visible' });
  const regs = await page.textContent('#registros-table');
  ok('registros de lista e de franquia continuam na tabela de registros', regs.includes('Limpeza') && regs.includes('Puxador'));
  const consumo = await page.textContent('#consumo-tables');
  ok('seção Consumo separada, com o mesclado somado (3 un de Puxador)', consumo.includes('Puxador') && consumo.includes('3 un') && !consumo.includes('Alça'));
  ok('Consumo não traz o registro de lista', !consumo.includes('Limpeza') && !consumo.includes('Escola L'));
  ok('recorrência TAG × componente', consumo.includes('Recorrência por TAG'));
  await page.evaluate(async () => { document.getElementById('f-contrato').value = '1020'; await render(); });
  ok('só contrato em lista: sem seção Consumo', !(await page.isVisible('#section-consumo')));
  ok('sem erros de página', erros.length === 0 || (console.log(erros), false));
  await b.close();
  console.log(falhas ? falhas + ' falha(s)' : 'Todos passaram'); process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
