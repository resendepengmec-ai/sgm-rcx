'use strict';
// Curadoria do vocabulário no navegador (contratos.html).
// Uso: node tools/layout-audit/smoke-curadoria.js
const path = require('path'), fs = require('fs');
const RAIZ = path.join(__dirname, '..', '..');
const pw = require('playwright');
const { responder, sessao, CONTRATOS } = require('./fixtures');
const API = 'https://smm-backend-a8a4.onrender.com';
let falhas = 0; const ok = (d, c) => { console.log(c ? '  ✓' : '  ✗', d); if (!c) falhas++; };

const FRANQ = { id: 'cf', numero: '7777', razao: 'Linha branca', ativo: true, modeloCorretiva: 'franquia', equipamentos: [] };
const FILAS = {
  novos: [{ i: 'c:cf:refrigeracao:SUB.ALCA_LATERAL', f: 'refrigeracao', a: 'SUB', k: 'Alça lateral', u: 'un', s: 'n', rotulo: 'Substituição · Alça lateral', origem: 'campo' }],
  sugeridos: [{ i: 'c:cf:outros:SUB.PLACA', f: 'outros', a: 'SUB', k: 'Placa <b>x</b>', u: 'un', s: 's', rotulo: 'Substituição · Placa <b>x</b>', origem: 'ia' }],
  sinonimos: [{ termoId: 'b:refrigeracao:SUB.TERMOSTATO', sinonimo: 'controlador frio', rotulo: 'Substituição · Termostato' }],
  pendencias: 3,
};
const VOCAB = { acoes: [{ c: 'SUB', n: 'Substituição' }], termos: [
  { i: 'b:refrigeracao:SUB.PUXADOR', f: 'refrigeracao', a: 'SUB', k: 'Puxador', u: 'un', s: 'a' },
  { i: 'b:agua:SUB.REFIL', f: 'agua', a: 'SUB', k: 'Refil', u: 'un', s: 'a' },
] };

(async () => {
  const b = await pw.chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const erros = []; page.on('pageerror', e => erros.push(e.stack || e.message));
  page.on('dialog', d => d.accept());
  const acoes = [];
  await page.addInitScript(jwt => sessionStorage.setItem('smm_jwt', jwt), sessao('supervisor'));
  await page.route('**/*', async route => {
    const rq = route.request(), u = rq.url();
    if (u.startsWith(API)) {
      const url = new URL(u), p = url.pathname.replace(/^\/api/, '');
      const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
      if (p === '/contratos' && rq.method() === 'GET') return json([...CONTRATOS, FRANQ]);
      if (p === '/vocab/curadoria' && rq.method() === 'GET') return json(url.searchParams.get('resumo') === '1' ? { pendencias: 3 } : FILAS);
      if (p === '/vocab/curadoria') { acoes.push(JSON.parse(rq.postData())); return json({ ok: true }); }
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
  await page.goto('http://127.0.0.1:8099/contratos.html');
  await page.waitForSelector('#contracts-list > *', { state: 'attached' });
  await page.waitForSelector('text=3 pendentes');
  ok('card do contrato com franquia mostra o contador de pendências', true);
  ok('contrato sem franquia não tem o botão', (await page.$$('button:has-text("Vocabulário")')).length === 1);
  await page.click('button:has-text("Vocabulário")');
  await page.waitForSelector('text=Novos de campo (1)');
  ok('três filas', (await page.textContent('#detail-content')).includes('Sugeridos pela IA (1)') && (await page.textContent('#detail-content')).includes('Sinônimos aprendidos (1)'));
  ok('texto do termo escapado (sem HTML injetado)', !(await page.$('#detail-content b')));
  const linha = page.locator('#detail-content .lcard').first();
  await linha.locator('button', { hasText: '🔀 Mesclar' }).click();
  const opcoes = await linha.locator('select option').allTextContents();
  ok('destinos da mescla: aprovados da mesma família (sem outra família)', opcoes.join() === 'Substituição · Puxador');
  await linha.locator('text=Mesclar neste termo').click();
  await page.waitForFunction(() => true);
  for (let i = 0; i < 30 && !acoes.length; i++) await page.waitForTimeout(100);
  ok('mesclar envia origem e destino', acoes[0]?.acao === 'mesclar' && acoes[0]?.termoId === 'c:cf:refrigeracao:SUB.ALCA_LATERAL' && acoes[0]?.destinoId === 'b:refrigeracao:SUB.PUXADOR');
  await page.waitForSelector('text=Novos de campo (1)');
  await page.locator('#detail-content .lcard').last().locator('text=Aprovar').click();
  for (let i = 0; i < 30 && acoes.length < 2; i++) await page.waitForTimeout(100);
  ok('aprovar sinônimo envia o sinônimo', acoes[1]?.acao === 'aprovar_sinonimo' && acoes[1]?.sinonimo === 'controlador frio');
  ok('sem erros de página', erros.length === 0 || (console.log(erros), false));
  await b.close();
  console.log(falhas ? falhas + ' falha(s)' : 'Todos passaram'); process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
