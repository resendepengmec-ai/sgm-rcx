'use strict';
// Lançamento de corretiva com franquia no navegador (registro.html).
// Uso: node tools/layout-audit/smoke-registro-franquia.js
const path = require('path'), fs = require('fs');
const RAIZ = path.join(__dirname, '..', '..');
const pw = require('playwright');
const { responder, sessao, CONTRATOS } = require('./fixtures');
const API = 'https://smm-backend-a8a4.onrender.com';
let falhas = 0; const ok = (d, c) => { console.log(c ? '  ✓' : '  ✗', d); if (!c) falhas++; };

const FRANQ = { id: 'cf', numero: '7777', razao: 'Linha branca', ativo: true, modeloCorretiva: 'franquia', franquia: { tipo: 'total' },
  equipamentos: [{ tag: '5', tipo: 'GELADEIRA', familia: 'refrigeracao', estabelecimento: 'Escola', recinto: 'Cozinha', status: 'operante' }], servicos: [] };
const LISTA = { id: 'cl', numero: '8888', razao: 'Split', ativo: true,
  equipamentos: [{ tag: '9', tipo: 'SPLIT', estabelecimento: 'Escola', recinto: 'Sala', status: 'operante' }], servicos: [{ name: 'Limpeza', unit: 'un', price: 100 }] };
const VOCAB = {
  acoes: [{ c: 'SUB', n: 'Substituição', s: ['troca'] }, { c: 'REP', n: 'Reparo', s: ['conserto'] }],
  unidades: ['un', 'kg'],
  termos: [
    { i: 'b:refrigeracao:SUB.BORRACHA_VEDACAO', f: 'refrigeracao', a: 'SUB', k: 'Borracha de vedação', u: 'un', s: 'a', y: ['gaxeta', 'borracha da porta'] },
    { i: 'b:refrigeracao:SUB.TERMOSTATO', f: 'refrigeracao', a: 'SUB', k: 'Termostato', u: 'un', s: 'a' },
  ],
  uso: { refrigeracao: { 'b:refrigeracao:SUB.TERMOSTATO': 3 } },
};

(async () => {
  const b = await pw.chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const erros = []; page.on('pageerror', e => erros.push(e.stack || e.message));
  const enviados = [];
  await page.addInitScript(jwt => sessionStorage.setItem('smm_jwt', jwt), sessao('supervisor'));
  await page.route('**/*', async route => {
    const rq = route.request(), u = rq.url();
    if (u.startsWith(API)) {
      const p = new URL(u).pathname.replace(/^\/api/, '');
      const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
      if (p === '/contratos' && rq.method() === 'GET') return json([...CONTRATOS, FRANQ, LISTA]);
      if (p === '/vocab') return json(VOCAB);
      if (p === '/vocab/termos') return json({ termo: { i: 'c:cf:refrigeracao:REP.PUXADOR_GAVETA', f: 'refrigeracao', a: 'REP', k: 'Puxador da gaveta', u: 'un', s: 'n' }, existente: false });
      if (p === '/registros' && rq.method() === 'POST') { const corpo = JSON.parse(rq.postData() || '{}'); enviados.push(corpo); return json({ saved: corpo.record?.id, record: corpo.record }); }
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
  await page.goto('http://127.0.0.1:8099/registro.html');
  await page.waitForSelector('#records-list > *', { state: 'attached' });
  await page.waitForFunction(() => (safeLocalStorageGetJSON('smm_contracts', []) || []).some(c => c.numero === '7777'));

  // Contrato em lista: tela de hoje (serviços com stepper)
  await page.evaluate(() => { startNew(); document.getElementById('f-client').value = '8888'; onContractChange(); });
  ok('contrato em lista: checklist de serviços de sempre', await page.isVisible('#os-checklist-box') && !(await page.isVisible('#franquia-box')));

  // Contrato com franquia: busca no vocabulário
  await page.evaluate(() => { startNew(); document.getElementById('f-client').value = '7777'; selectedMachine = { tag: '5', tipo: 'GELADEIRA', familia: 'refrigeracao', estabelecimento: 'Escola' }; document.getElementById('f-equip').value = '5'; onContractChange(); });
  await page.waitForSelector('#franquia-box');
  ok('franquia: bloco "Serviço executado" no lugar da lista', !(await page.isVisible('#os-checklist-box')));
  await page.waitForSelector('#fq-atalhos button');
  ok('atalho "Mais usados nesta família" mostra o termostato', (await page.textContent('#fq-atalhos')).includes('Termostato'));
  await page.fill('#fq-busca', 'troca borr porta');
  await page.waitForSelector('#fq-sugestoes button');
  ok('busca com prefixo e sinônimo acha a borracha', (await page.textContent('#fq-sugestoes')).includes('Substituição · Borracha de vedação'));
  await page.click('#fq-sugestoes button');
  let itens = await page.evaluate(() => newItems);
  ok('item lançado com qtd 1, unidade sugerida e consulta', itens.length === 1 && itens[0].qtd === 1 && itens[0].unidade === 'un' && itens[0].consulta === 'troca borr porta');
  await page.click('button[aria-label="Aumentar"]');
  ok('stepper soma 1', (await page.evaluate(() => newItems[0].qtd)) === 2);
  await page.fill('input[aria-label="Quantidade"]', '1,5'); await page.dispatchEvent('input[aria-label="Quantidade"]', 'change');
  ok('quantidade fracionária pelo campo', (await page.evaluate(() => newItems[0].qtd)) === 1.5);

  await page.fill('#fq-busca', 'termostado');
  await page.waitForSelector('text=Você quis dizer');
  ok('"Você quis dizer" sugere o termostato', (await page.textContent('#fq-novo')).includes('Termostato'));
  await page.fill('#fq-busca', 'puxador gaveta');
  await page.click('text=+ Adicionar como novo termo');
  ok('formulário de termo novo pré-preenchido com o que foi digitado', (await page.inputValue('#fq-novo-comp')) === 'puxador gaveta');
  await page.selectOption('#fq-novo-acao', 'REP');
  await page.click('#fq-novo-form >> text=Adicionar');
  await page.waitForFunction(() => newItems.length === 2);
  itens = await page.evaluate(() => newItems);
  ok('termo novo vira item com o id devolvido pelo servidor', itens[1].termoId === 'c:cf:refrigeracao:REP.PUXADOR_GAVETA');

  // Trocar para contrato em lista descarta os itens de franquia; voltar recomeça limpo.
  const salvos = await page.evaluate(() => newItems.map(i => ({ ...i })));
  await page.evaluate(() => { document.getElementById('f-client').value = '8888'; onContractChange(); });
  ok('trocar para contrato em lista descarta os itens de franquia', (await page.evaluate(() => newItems.length)) === 0);
  await page.evaluate(its => { document.getElementById('f-client').value = '7777'; onContractChange(); newItems = its; renderNewItems(); }, salvos);

  await page.evaluate(() => saveRecord(document.querySelector('#screen-new .btn-primary')));
  await page.waitForFunction(() => true);
  for (let i = 0; i < 50 && !enviados.length; i++) await page.waitForTimeout(100);
  const rec = enviados[0]?.record;
  ok('registro enviado com itens de franquia, sem preço', rec && rec.items.length === 2 && rec.items.every(i => i.price === undefined && i.qtd > 0 && i.termoId));
  ok('sem erros de página', erros.length === 0 || (console.log(erros), false));
  await b.close();
  console.log(falhas ? falhas + ' falha(s)' : 'Todos passaram'); process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
