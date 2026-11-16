'use strict';
// Roda DENTRO da página (page.evaluate). Devolve uma lista de ocorrências
// {tipo, critico, onde, detalhe}. "onde" é um seletor curto para achar o
// elemento no relatório.

function detectar(opts) {
  const { cardSel, headerSel, mobile } = opts;
  const out = [];
  const nome = (el) => {
    if (!el || el === document.body) return 'body';
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls} "${txt}"`;
  };
  const visivel = (el) => {
    // Conteúdo de <details> fechado não é desenhado (o resumo, sim).
    const det = el.closest("details:not([open])");
    if (det && !el.closest("summary") && el !== det) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const add = (tipo, critico, el, detalhe) => out.push({ tipo, critico, onde: nome(el), detalhe: detalhe || '' });

  // 1. Rolagem horizontal da página
  const sw = document.documentElement.scrollWidth, cw = document.documentElement.clientWidth;
  if (sw > cw + 1) add('rolagem-horizontal', true, document.body, `scrollWidth ${sw} > ${cw}`);

  // Folhas com texto: elementos que têm nó de texto próprio não vazio.
  const folhasDe = (root) => {
    const res = [];
    root.querySelectorAll('*').forEach((el) => {
      if (!visivel(el)) return;
      const temTexto = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const controle = el.matches('button,input,select,textarea,img,a');
      if (temTexto || controle) res.push(el);
    });
    return res;
  };

  const cards = cardSel ? [...document.querySelectorAll(cardSel)].filter(visivel) : [];
  cards.forEach((card) => {
    const folhas = folhasDe(card);
    // Retângulos dos NÓS DE TEXTO (não da caixa do elemento): um elemento
    // inline que quebra em várias linhas tem caixa enorme, mas o texto em si
    // não se sobrepõe a nada.
    // Recorta pela caixa do ancestral com overflow escondido (ex.: line-clamp):
    // linha que não aparece não pode se sobrepor a nada.
    const recorte = (el) => {
      let box = null;
      for (let a = el; a && a !== card.parentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (['hidden', 'clip'].includes(cs.overflowY) || ['hidden', 'clip'].includes(cs.overflow)) {
          const r = a.getBoundingClientRect();
          box = box ? { left: Math.max(box.left, r.left), top: Math.max(box.top, r.top), right: Math.min(box.right, r.right), bottom: Math.min(box.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        }
      }
      return box;
    };
    const recortar = (r, box) => {
      if (!box) return r;
      const o = { left: Math.max(r.left, box.left), top: Math.max(r.top, box.top), right: Math.min(r.right, box.right), bottom: Math.min(r.bottom, box.bottom) };
      return o.right - o.left > 1 && o.bottom - o.top > 1 ? o : null;
    };
    const rects = folhas.map((el) => {
      const box = recorte(el);
      const rs = [];
      if (el.matches('button,input,select,textarea,img')) rs.push(el.getBoundingClientRect());
      else el.childNodes.forEach((n) => {
        if (n.nodeType !== 3 || !n.textContent.trim()) return;
        const rg = document.createRange(); rg.selectNodeContents(n);
        [...rg.getClientRects()].forEach((r) => { if (r.width > 1 && r.height > 1) rs.push(r); });
      });
      return { el, rs: rs.map((r) => recortar(r, box)).filter(Boolean) };
    });
    // 2. Sobreposição entre textos/controles de um mesmo card
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        let hit = false;
        for (const ra of a.rs) for (const rb of b.rs) {
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (w > 2 && h > 2) hit = true;
        }
        if (hit) add('sobreposicao', true, a.el, 'com ' + nome(b.el));
      }
    }
    // 3. Texto cortado sem reticências / 4. quebra degenerada
    folhas.forEach((el) => {
      const cs = getComputedStyle(el);
      const corta = ['hidden', 'clip'].includes(cs.overflowX) || ['hidden', 'clip'].includes(cs.overflow);
      if (corta && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && !el.matches('img,input,select,textarea')) {
        add('texto-cortado', true, el, `scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
      }
      // Linhas reais do texto (topos distintos dos retângulos de linha), não a
      // altura da caixa: botão com min-height alto não é texto quebrado.
      const r = el.getBoundingClientRect();
      const topos = new Set();
      el.childNodes.forEach((n) => {
        if (n.nodeType !== 3 || !n.textContent.trim()) return;
        const rg = document.createRange(); rg.selectNodeContents(n);
        [...rg.getClientRects()].forEach((q) => { if (q.width > 1) topos.add(Math.round(q.top)); });
      });
      if (r.width < 60 && topos.size > 3 && (el.textContent || '').trim().length > 6) {
        add('quebra-degenerada', true, el, `largura ${Math.round(r.width)}px, ${topos.size} linhas`);
      }
    });
    // 5. Conteúdo do card vazando para fora do card
    const rc = card.getBoundingClientRect();
    rects.forEach(({ el, rs }) => rs.forEach((r) => {
      if (r.right > rc.right + 2 || r.left < rc.left - 2) add('vaza-do-card', true, el, `x ${Math.round(r.left)}–${Math.round(r.right)} fora de ${Math.round(rc.left)}–${Math.round(rc.right)}`);
    }));
    // 6. "·" isolado na linha (ou no começo/fim de linha)
    const tw = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    const chars = [];
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.parentElement || !visivel(n.parentElement)) continue;
      const t = n.textContent;
      for (let k = 0; k < t.length; k++) {
        if (/\s/.test(t[k])) continue;
        const rg = document.createRange(); rg.setStart(n, k); rg.setEnd(n, k + 1);
        const r = rg.getBoundingClientRect();
        if (r.width || r.height) chars.push({ c: t[k], top: Math.round(r.top), node: n });
      }
    }
    chars.forEach((ch, k) => {
      if (ch.c !== '·') return;
      const mesmaLinha = (o) => o && Math.abs(o.top - ch.top) < 4;
      if (!mesmaLinha(chars[k - 1]) || !mesmaLinha(chars[k + 1])) add('ponto-isolado', true, ch.node.parentElement, 'separador "·" sem vizinho na mesma linha');
    });
  });

  // 7. Elemento fixo (fora o cabeçalho) cobrindo campo de formulário
  const fixos = [...document.querySelectorAll('body *')].filter((el) => {
    const p = getComputedStyle(el).position;
    return (p === 'fixed') && visivel(el) && !el.closest(headerSel) && !el.closest('.modal-bg,.auth-overlay,.lightbox,.toast');
  });
  // Conta só o que continua coberto DEPOIS de focar o campo (o navegador
  // rola o campo para a vista respeitando scroll-padding): enquanto se rola
  // a página, qualquer barra fixa passa por cima de algo.
  const cobre = (f, fx) => {
    const rf = f.getBoundingClientRect(), r = fx.getBoundingClientRect();
    const w = Math.min(r.right, rf.right) - Math.max(r.left, rf.left);
    const h = Math.min(r.bottom, rf.bottom) - Math.max(r.top, rf.top);
    return w > 4 && h > 4;
  };
  const y0 = scrollY;
  document.querySelectorAll('input:not([type=hidden]),select,textarea').forEach((f) => {
    if (!visivel(f) || f.closest('.modal-bg')) return;
    const suspeitos = fixos.filter((fx) => !fx.contains(f) && cobre(f, fx));
    if (!suspeitos.length) return;
    f.focus();
    suspeitos.forEach((fx) => { if (cobre(f, fx)) add('fixo-cobre-campo', true, fx, 'cobre ' + nome(f) + ' mesmo com o campo focado'); });
    f.blur();
  });
  scrollTo(0, y0);

  // 8. Alvos de toque e fonte de campo (só telas ≤ 768px)
  if (mobile) {
    document.querySelectorAll('button,a[href],[role=button],input[type=checkbox],input[type=radio],select').forEach((el) => {
      if (!visivel(el) || el.closest('.modal-bg.hidden')) return;
      if (cardSel && el.matches(cardSel)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) {
        // Checkbox nativo: conta a área do <label> que o envolve.
        const lab = el.closest('label');
        const rl = lab ? lab.getBoundingClientRect() : r;
        if (rl.width < 44 || rl.height < 44) add('alvo-pequeno', false, el, `${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    });
    document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea').forEach((el) => {
      if (!visivel(el)) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) add('campo-fonte-pequena', false, el, `${fs}px (iOS dá zoom ao focar)`);
    });
  }
  return out;
}

// Cabeçalho: depois de rolar, continua no topo e visível (não coberto)?
function checarCabecalho(headerSel) {
  const h = document.querySelector(headerSel);
  if (!h) return [{ tipo: 'cabecalho-ausente', critico: true, onde: headerSel, detalhe: '' }];
  const out = [];
  const r = h.getBoundingClientRect();
  if (Math.abs(r.top) > 1) out.push({ tipo: 'cabecalho-nao-fixo', critico: true, onde: headerSel, detalhe: `top ${Math.round(r.top)} após rolar ${Math.round(scrollY)}px` });
  else {
    // Outro elemento por cima do cabeçalho (ex.: segundo cabeçalho sticky)
    const x = r.left + Math.min(40, r.width / 2), y = r.top + r.height / 2;
    const topo = document.elementFromPoint(x, y);
    if (topo && !h.contains(topo)) out.push({ tipo: 'cabecalho-coberto', critico: true, onde: headerSel, detalhe: 'coberto por ' + (topo.tagName + '.' + topo.className) });
  }
  // Foco: um item lá do começo da página, focado com a página rolada, não
  // pode ficar escondido atrás do cabeçalho fixo (scroll-padding-top).
  const alvo = [...document.querySelectorAll('[tabindex="0"],input:not([type=hidden]),select,textarea,button')]
    .find((el) => !h.contains(el) && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().top < 0 && !el.closest('.modal-bg,.bottom-nav,.a11y-bar'));
  if (alvo) {
    alvo.focus();
    const ra = alvo.getBoundingClientRect(), rh = h.getBoundingClientRect();
    if (document.activeElement === alvo && ra.top < rh.bottom - 1 && ra.bottom > rh.top) {
      out.push({ tipo: 'cabecalho-cobre-foco', critico: true, onde: headerSel, detalhe: `foco em ${alvo.tagName.toLowerCase()} fica atrás do cabeçalho (top ${Math.round(ra.top)} < ${Math.round(rh.bottom)})` });
    }
    alvo.blur();
  }
  return out;
}

module.exports = { detectar, checarCabecalho };
