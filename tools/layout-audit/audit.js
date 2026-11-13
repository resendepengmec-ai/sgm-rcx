'use strict';
// Auditoria de layout do SGM: cabeçalho fixo e cards de lista.
//   node audit.js                    matriz completa
//   node audit.js --quick            chromium 390 e 1366 (iteração rápida)
//   node audit.js --pages=chamados   só algumas páginas (lista separada por vírgula)
//   node audit.js --engines=webkit   só alguns motores
//   node audit.js --out=antes        nome da pasta de saída em out/
//   node audit.js --ci               sai com código 1 se houver ocorrência crítica
const path = require('path');
const fs = require('fs');
const http = require('http');
const pw = require('playwright');
const { responder, sessao } = require('./fixtures');
const { detectar, checarCabecalho } = require('./detect');
const { PAGINAS, CARDS } = require('./pages');

// --raiz=<pasta> audita outra cópia do site (ex.: um worktree do main para o "antes").
const RAIZ = path.resolve(process.argv.find((x) => x.startsWith('--raiz='))?.slice(7) || path.join(__dirname, '..', '..'));
const API = 'https://smm-backend-a8a4.onrender.com';
const arg = (k) => { const a = process.argv.find((x) => x.startsWith('--' + k)); return a ? (a.split('=')[1] ?? true) : undefined; };
const CI = !!arg('ci'), QUICK = !!arg('quick');
const SAIDA = path.join(__dirname, 'out', String(arg('out') || 'ultimo'));
const LARGURAS = [360, 375, 390, 412, 768, 1024, 1280, 1366, 1920];

function servir() {
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const full = path.join(RAIZ, p);
    if (!full.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': tipos[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

function matriz() {
  const engines = arg('engines') ? String(arg('engines')).split(',') : ['chromium', 'firefox', 'webkit'];
  const m = [];
  if (QUICK) {
    for (const w of [390, 1366]) m.push({ engine: 'chromium', w, dsf: 1 });
    return m.filter((c) => engines.includes(c.engine));
  }
  for (const engine of engines) {
    for (const w of LARGURAS) m.push({ engine, w, dsf: 1 });
    for (const w of [390, 1366]) m.push({ engine, w, dsf: 1, fonteMax: true });
    for (const w of [1280, 1366]) m.push({ engine, w, dsf: 1, zoom: 1.5 });
    if (engine !== 'webkit') for (const dsf of [1.25, 1.5]) for (const w of [390, 1366]) m.push({ engine, w, dsf });
    if (engine !== 'firefox') for (const d of ['iPhone SE', 'iPhone 14', 'Pixel 7', 'iPad (gen 7)']) m.push({ engine, device: d });
  }
  return m;
}

function rotulo(c) {
  if (c.device) return `${c.engine} ${c.device}`;
  return `${c.engine} ${c.w}px${c.dsf !== 1 ? ' @' + c.dsf + 'x' : ''}${c.fonteMax ? ' A+máx' : ''}${c.zoom ? ' zoom' + c.zoom * 100 + '%' : ''}`;
}

async function contexto(browser, c) {
  let opts;
  if (c.device) opts = { ...pw.devices[c.device] };
  else if (c.zoom) opts = { viewport: { width: Math.round(c.w / c.zoom), height: Math.round(800 / c.zoom) }, deviceScaleFactor: c.dsf * c.zoom };
  else opts = { viewport: { width: c.w, height: 800 }, deviceScaleFactor: c.dsf };
  if (c.engine === 'firefox') delete opts.isMobile;
  return browser.newContext({ ...opts, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
}

async function auditarPagina(ctx, base, pg, c, shotsDir) {
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(({ jwt, fonteMax }) => {
    sessionStorage.setItem('smm_jwt', jwt);
    if (fonteMax) {
      localStorage.setItem('smm_font_size', '22');
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '22px'; });
    }
  }, { jwt: sessao(pg.papel), fonteMax: !!c.fonteMax });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(API)) return responder(route, pg.papel);
    if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  const res = { pagina: pg.nome, config: rotulo(c), ocorrencias: [], erros };
  try {
    await page.goto(base + '/' + pg.arquivo, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector(pg.pronto, { timeout: 15000, state: 'attached' }).catch(() => res.ocorrencias.push({ tipo: 'nao-renderizou', critico: false, onde: pg.pronto, detalhe: '' }));
    if (pg.preparar) { await page.evaluate(pg.preparar).catch((e) => erros.push('preparar: ' + e.message)); }
    if (pg.depois) await page.waitForSelector(pg.depois, { timeout: 10000, state: 'attached' }).catch(() => {});
    await page.waitForTimeout(300);
    const mobile = (c.device ? (pw.devices[c.device].viewport.width) : Math.round(c.w / (c.zoom || 1))) <= 768;
    const header = pg.cabecalho === undefined ? '.app-header' : pg.cabecalho;
    res.cards = await page.evaluate((sel) => document.querySelectorAll(sel).length, CARDS);
    res.ocorrencias.push(...await page.evaluate(`(${detectar})(${JSON.stringify({ cardSel: CARDS, headerSel: header || '__nenhum__', mobile })})`));
    if (header) {
      const alturaPagina = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      if (alturaPagina > 50) {
        await page.evaluate(() => scrollTo(0, Math.min(1000, document.documentElement.scrollHeight)));
        await page.waitForTimeout(150);
        res.ocorrencias.push(...await page.evaluate(`(${checarCabecalho})(${JSON.stringify(header)})`));
        await page.evaluate(() => scrollTo(0, 0));
      }
    }
    if (res.ocorrencias.some((o) => o.critico) && shotsDir) {
      const f = `${pg.nome}__${rotulo(c).replace(/[^a-z0-9]+/gi, '_')}.png`;
      await page.screenshot({ path: path.join(shotsDir, f), fullPage: false }).catch(() => {});
      res.screenshot = f;
    }
    // Defeito de referência: card de chamado sempre fotografado em 390 e 1366.
    if (pg.nome === 'chamados' && !c.device && !c.zoom && !c.fonteMax && c.dsf === 1 && [390, 1366].includes(c.w)) {
      const card = page.locator(CARDS).first();
      const f = `referencia_chamado_${c.engine}_${c.w}.png`;
      await card.screenshot({ path: path.join(shotsDir, f) }).catch(() => {});
    }
  } catch (e) {
    res.ocorrencias.push({ tipo: 'falha-auditoria', critico: false, onde: pg.arquivo, detalhe: e.message.split('\n')[0] });
  }
  await page.close();
  return res;
}

function html(resultados) {
  const linhas = resultados.filter((r) => r.ocorrencias.length).map((r) => `<tr><td>${r.pagina}</td><td>${r.config}</td><td><ul>${r.ocorrencias.map((o) => `<li class="${o.critico ? 'c' : 'w'}"><b>${o.tipo}</b> ${esc(o.onde)} ${esc(o.detalhe)}</li>`).join('')}</ul></td><td>${r.screenshot ? `<a href="shots/${r.screenshot}">png</a>` : ''}</td></tr>`).join('');
  function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  return `<!doctype html><meta charset="utf-8"><title>Auditoria de layout</title><style>body{font:13px system-ui;margin:16px}td{vertical-align:top;border-bottom:1px solid #ddd;padding:4px}.c{color:#b91c1c}.w{color:#92400e}</style><h1>Auditoria de layout</h1><table>${linhas}</table>`;
}

(async () => {
  const filtro = arg('pages') ? String(arg('pages')).split(',') : null;
  const paginas = PAGINAS.filter((p) => !filtro || filtro.includes(p.nome));
  fs.rmSync(SAIDA, { recursive: true, force: true });
  const shots = path.join(SAIDA, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const srv = await servir();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const resultados = [];
  const porEngine = {};
  for (const c of matriz()) (porEngine[c.engine] = porEngine[c.engine] || []).push(c);
  for (const [engine, configs] of Object.entries(porEngine)) {
    let browser;
    try { browser = await pw[engine].launch(); } catch (e) { console.error(`motor ${engine} indisponível: ${e.message.split('\n')[0]}`); continue; }
    for (const c of configs) {
      const ctx = await contexto(browser, c);
      for (const pg of paginas) resultados.push(await auditarPagina(ctx, base, pg, c, shots));
      await ctx.close();
      process.stdout.write('.');
    }
    await browser.close();
  }
  srv.close();
  const resumo = {};
  resultados.forEach((r) => r.ocorrencias.forEach((o) => {
    const k = `${r.pagina}|${o.critico ? 'critico' : 'aviso'}|${o.tipo}`;
    resumo[k] = (resumo[k] || 0) + 1;
  }));
  fs.writeFileSync(path.join(SAIDA, 'report.json'), JSON.stringify({ resumo, resultados }, null, 1));
  fs.writeFileSync(path.join(SAIDA, 'report.html'), html(resultados));
  console.log('\n' + Object.entries(resumo).sort().map(([k, v]) => `${k}: ${v}`).join('\n'));
  const criticos = resultados.reduce((n, r) => n + r.ocorrencias.filter((o) => o.critico).length, 0);
  console.log(`\nconfigs: ${resultados.length} páginas×config, ocorrências críticas: ${criticos}\nrelatório: ${path.join(SAIDA, 'report.html')}`);
  if (CI && criticos) process.exit(1);
})();
