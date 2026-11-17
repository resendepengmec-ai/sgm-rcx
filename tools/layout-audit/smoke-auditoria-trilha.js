'use strict';
// Aba Auditoria (admin): botão de verificar a integridade da trilha.
// Uso: node tools/layout-audit/smoke-auditoria-trilha.js
const path = require('path'), fs = require('fs');
const RAIZ = path.join(__dirname, '..', '..');
const pw = require('playwright');
const { responder, sessao } = require('./fixtures');
const API = 'https://smm-backend-a8a4.onrender.com';
let falhas = 0; const ok = (d, c) => { console.log(c ? '  ✓' : '  ✗', d); if (!c) falhas++; };

(async () => {
  const b = await pw.chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const erros = []; page.on('pageerror', e => erros.push(e.stack || e.message));
  await page.addInitScript(jwt => sessionStorage.setItem('smm_jwt', jwt), sessao('admin'));
  let resposta = { ok: true, verificados: 1234, legados: 14914, ancora: { id: 16148, hash: 'abcdef0123456789ffff' } };
  let chamadas = 0;
  await page.route('**/*', async route => {
    const rq = route.request(), u = rq.url();
    if (u.startsWith(API)) {
      const p = new URL(u).pathname.replace(/^\/api/, '');
      const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
      if (p === '/audit/verificar') { chamadas++; return json(resposta); }
      if (p === '/audit/summary') return json({ logins_30d: 1, actions_30d: 2, active_users: 3, expired_access: 0 });
      if (p === '/audit/expired-access') return json([]);
      if (p === '/audit') return json([{ ts: Date.now(), user_email: '<img src=x onerror=window.__xss=1>@x', user_role: 'admin', action: '<b>x</b>', module: 'registros', record_id: '<i>abc</i>' }]);
      return responder(route, 'admin');
    }
    if (new URL(u).hostname === '127.0.0.1') {
      const full = path.join(RAIZ, decodeURIComponent(new URL(u).pathname));
      if (!fs.existsSync(full)) return route.fulfill({ status: 404, body: '' });
      const t = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(full)] || 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: t, body: fs.readFileSync(full) });
    }
    return route.abort();
  });
  await page.goto('http://127.0.0.1:8099/index.html');
  await page.waitForFunction(() => typeof showAdminPanel === 'function' && !!document.getElementById('admin-panel'));
  await page.waitForFunction(() => getCurrentUser()?.role === 'admin', null, { timeout: 15000 });
  await page.evaluate(() => showAdminPanel());
  await page.waitForSelector('.admin-tab[data-tab="auditoria"]', { timeout: 8000 }).catch(() => {});
  ok('aba Auditoria visível para admin', await page.isVisible('.admin-tab[data-tab="auditoria"]'));
  await page.click('.admin-tab[data-tab="auditoria"]');
  await page.waitForSelector('#btn-verificar-trilha');
  const box = await page.locator('#btn-verificar-trilha').boundingBox();
  ok('botão com área de toque ≥ 40px', box && box.height >= 40);
  await page.click('#btn-verificar-trilha');
  await page.waitForSelector('#trilha-resultado :text("íntegra")');
  const t1 = await page.textContent('#trilha-resultado');
  ok('mostra íntegra, contagem e linhas anteriores à cadeia', t1.includes('1.234') && t1.includes('14.914') && t1.includes('#16148') && t1.includes('abcdef0123456789') && !t1.includes('ffff'));
  resposta = { ok: false, verificados: 10, legados: 0, falha: { id: 77, motivo: '<b>conteúdo alterado</b>' } };
  await page.click('#btn-verificar-trilha');
  await page.waitForSelector('#trilha-resultado :text("adulteração")');
  const h = await page.innerHTML('#trilha-resultado');
  ok('mostra a linha adulterada, com o motivo escapado', h.includes('#77') && h.includes('&lt;b&gt;conteúdo alterado'));
  ok('uma chamada por clique', chamadas === 2);
  await page.click('button:has-text("Filtrar")');
  await page.waitForSelector('#audit-log-list :text("registros")');
  ok('log de atividades escapa e-mail/ação/id', !(await page.evaluate(() => window.__xss)) && (await page.innerHTML('#audit-log-list')).includes('&lt;b&gt;x&lt;/b&gt;'));
  ok('sem erros de página', erros.length === 0 || (console.log(erros), false));
  await page.screenshot({ path: path.join(__dirname, 'out', 'auditoria-trilha.png'), fullPage: false });
  await b.close();
  console.log(falhas ? falhas + ' falha(s)' : 'Todos passaram'); process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
