'use strict';
// Prévia da importação de equipamentos no navegador (contratos.html).
// Uso: node tools/layout-audit/smoke-import-equip.js
const path = require('path'), fs = require('fs');
const AUD = __dirname;
const RAIZ = path.join(__dirname, '..', '..');
const pw = require(AUD + '/node_modules/playwright');
const { responder, sessao } = require(AUD + '/fixtures');
const API = 'https://smm-backend-a8a4.onrender.com';
let falhas = 0; const ok = (d, c) => { console.log(c ? '  ✓' : '  ✗', d); if (!c) falhas++; };
(async () => {
  const b = await pw.chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const erros = []; page.on('pageerror', e => erros.push(e.message));
  await page.addInitScript(jwt => sessionStorage.setItem('smm_jwt', jwt), sessao('admin'));
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(API)) return responder(route, 'admin');
    if (new URL(u).hostname === '127.0.0.1') {
      let p = decodeURIComponent(new URL(u).pathname); const full = path.join(RAIZ, p);
      if (!fs.existsSync(full)) return route.fulfill({ status: 404, body: '' });
      const t = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(full)] || 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: t, body: fs.readFileSync(full) });
    }
    return route.abort();
  });
  await page.goto('http://127.0.0.1:8099/contratos.html');
  await page.waitForSelector('#contracts-list > *', { state: 'attached' });
  await page.evaluate(() => { openNewContract(); pendingEquip = [{ tag: '1', tipo: 'GELADEIRA', estabelecimento: 'Escola Municipal Santa Rita', status: 'operante' }]; switchFormTab('equipamentos'); });
  ok('checklist padrão começa em split', await page.$eval('#f-checklist-padrao', e => e.value) === 'split');
  const csv = 'tag,tipo,fabricante,estabelecimento,patrimônio\n10,GELADEIRA,Consul,Escola Municipal Santa Rita,S/P\n010,FREEZER VERTICAL,Electrolux,Escola Municipal Santa Rita,123\n,BEBEDOURO,X,Escola Municipal Santa Rita,\n11,TELEVISOR,LG,Esc. Municipal Santa Rita,\n';
  await page.setInputFiles('#tab-equipamentos input[type=file]', { name: 'eq.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForSelector('select[data-dup="0"]');
  ok('painel de decisão aparece', true);
  ok('nada mesclado antes de decidir', await page.evaluate(() => pendingEquip.length) === 1);
  await page.click('text=Aplicar importação');
  ok('sem escolha da TAG duplicada não aplica', await page.evaluate(() => pendingEquip.length) === 1);
  await page.selectOption('select[data-dup="0"]', { index: 2 });
  await page.click('text=Aplicar importação');
  const r = await page.evaluate(() => pendingEquip);
  ok('aplicou: 1 existente + 2 novos (linha sem TAG fora)', r.length === 3);
  const t10 = r.find(e => e.tag === '010');
  ok('TAG duplicada: ficou só a linha escolhida (FREEZER)', t10 && t10.tipo === 'FREEZER VERTICAL' && !r.find(e => e.tag === '10'));
  ok('fabricante virou marca', t10?.marca === 'Electrolux');
  ok('estabelecimento parecido trocado pelo existente', r.find(e => e.tag === '11')?.estabelecimento === 'Escola Municipal Santa Rita');
  ok('_linha não vai para o equipamento', r.every(e => e._linha === undefined));
  const resumo = await page.$eval('#equip-sample', e => e.textContent);
  ok('resumo avisa linha sem TAG e tipo sem família', /sem TAG/.test(resumo) && /TELEVISOR/.test(resumo));
  await page.setInputFiles('#tab-equipamentos input[type=file]', { name: 'eq3.csv', mimeType: 'text/csv', buffer: Buffer.from('tag,tipo,estabelecimento\n0001,GELADEIRA DUPLEX,Escola Municipal Santa Rita\n') });
  await page.waitForFunction(() => pendingEquip.find(e => e.tipo === 'GELADEIRA DUPLEX'));
  ok('TAG 0001 da planilha atualiza a TAG 1 existente (sem duplicar)', await page.evaluate(() => pendingEquip.length) === 3);
  // importação sem nada a decidir aplica direto, como hoje
  await page.setInputFiles('#tab-equipamentos input[type=file]', { name: 'eq2.csv', mimeType: 'text/csv', buffer: Buffer.from('tag,tipo,estabelecimento\n20,BALANÇA,Escola Municipal Santa Rita\n') });
  await page.waitForFunction(() => pendingEquip.length === 4);
  ok('sem decisão pendente: mescla direto', true);
  // Modelo de corretiva: motivo só aparece ao trocar o modelo de um contrato já salvo.
  await page.evaluate(() => switchFormTab(document.querySelector('.stab').dataset.tab));
  await page.selectOption('#f-modelo-corretiva', 'franquia');
  ok('contrato novo com franquia: sem campo de motivo', !(await page.isVisible('#f-motivo-modelo-corretiva')));
  await page.evaluate(() => { _modeloCorretivaCarregado = 'lista'; mostrarMotivoModeloCorretiva(); });
  ok('contrato salvo trocando de modelo: pede motivo', await page.isVisible('#f-motivo-modelo-corretiva'));
  const posts = []; page.on('request', rq => { if (rq.method() === 'POST' && rq.url().includes('/contratos')) posts.push(rq.url()); });
  await page.evaluate(() => { document.getElementById('f-numero').value = '999'; document.getElementById('f-razao').value = 'X'; return saveContract(null); });
  ok('sem motivo não envia', posts.length === 0);
  await page.selectOption('#f-modelo-corretiva', 'lista');
  ok('voltando ao modelo salvo, o motivo some', !(await page.isVisible('#f-motivo-modelo-corretiva')));
  ok('sem erros de página', erros.length === 0 || (console.log(erros), false));
  await b.close();
  console.log(falhas ? falhas + ' falha(s)' : 'Todos passaram'); process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
