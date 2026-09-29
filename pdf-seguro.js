// ── pdf-seguro.js — Fase 3 ──────────────────────────────────────────
// Módulo compartilhado para os geradores de PDF com fotos. Antes, cada
// página (chamados/registro/laudo/patrimonio/preventiva/relatorio) tinha
// sua própria cópia (ou nenhuma) da lógica de baixar+desenhar foto, sem
// redução de tamanho, sem retry, sem cancelamento e sem aviso de
// progresso — um PDF de centenas de fotos podia travar a aba por minutos
// sem feedback nenhum.
//
// Duas partes, deliberadamente separadas: (1) funções PURAS (sem DOM/
// canvas), testáveis em Node puro — cálculo de progresso, backoff,
// decisão de volume, formatação de tempo; (2) funções que dependem do
// navegador (createImageBitmap, OffscreenCanvas, wakeLock, o modal em
// si). A primeira parte tem teste automatizado (pdf-seguro.test.js); a
// segunda só dá para validar lendo o código e comparando com o
// comportamento anterior — não há navegador real disponível para rodar
// isto neste projeto no momento.
'use strict';

// ═══ Parte 1: lógica pura (sem DOM) — exportada também para teste ═══

// Pesos fixos da barra de progresso (prompt original, seção 3.2).
const PDF_SEGURO_PESOS = Object.freeze({ precalculo: 2, registros: 8, fotos: 80, montagem: 5, saida: 5 });

// `estado` é {precalculo,registros,fotos,montagem,saida}, cada um uma
// fração 0..1 de quanto daquela etapa já foi concluído. O resultado nunca
// retrocede (quem chama garante isso passando frações monotônicas) e só
// chega a 100 quando `saida` está completo.
function pdfSeguroProgresso(estado) {
  const e = estado || {};
  let pct = 0;
  for (const etapa of Object.keys(PDF_SEGURO_PESOS)) {
    const fracao = Math.max(0, Math.min(1, Number(e[etapa]) || 0));
    pct += fracao * PDF_SEGURO_PESOS[etapa];
  }
  return Math.max(0, Math.min(100, Math.round(pct)));
}

// Espera progressiva entre tentativas: 300ms, 900ms, 2700ms (×3 a cada
// tentativa). `tentativa` é 1-based (1ª nova tentativa = índice 1).
function pdfSeguroBackoffMs(tentativa) {
  return 300 * Math.pow(3, Math.max(0, tentativa - 1));
}

// 150 MB de imagens já desenhadas no documento atual → hora de fechar a
// parte e abrir a próxima (prompt original, seção 3.1.4). `bytesAcumulados`
// soma só os JPEGs JÁ REDUZIDOS (pós createImageBitmap+resize), não o
// tamanho original baixado.
const PDF_SEGURO_LIMITE_VOLUME_BYTES = 150 * 1024 * 1024;
function pdfSeguroPrecisaNovoVolume(bytesAcumulados, limite = PDF_SEGURO_LIMITE_VOLUME_BYTES) {
  return bytesAcumulados >= limite;
}

// Média móvel simples do tempo por foto já processada, para estimar o
// restante. `temposMs` é o histórico (ms por foto); `restantes` é quantas
// faltam. Primeiras fotos (histórico vazio) devolvem null — a interface
// mostra "calculando…" nesse caso, como pede o prompt.
function pdfSeguroTempoRestanteMs(temposMs, restantes) {
  if (!Array.isArray(temposMs) || !temposMs.length || restantes <= 0) return null;
  const media = temposMs.reduce((a, b) => a + b, 0) / temposMs.length;
  return Math.round(media * restantes);
}
function pdfSeguroFormatarTempo(ms) {
  if (ms == null) return 'calculando…';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}min${r ? ' ' + r + 's' : ''}`;
}

// ═══ Parte 2: dependente do navegador ═══

// Baixa e reduz UMA foto: até 3 tentativas, retorna bytes prontos para
// jsPDF.addImage(Uint8Array,...) — sem base64 em nenhum momento. Falha
// (rede ou decodificação) nas 3 tentativas devolve {falhou:true}; quem
// chama desenha o quadro "Foto indisponível" com a TAG, como já é
// convenção nos geradores (ex.: preventiva.html:desenharFotoPdf).
async function prepararFotoPdf(ref, { maxLado = 600, qualidade = 0.6, tentativas = 3 } = {}) {
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      const blob = await arquivoBytes(ref && ref.sha ? ref.sha : ref);
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      try {
        let w = bitmap.width, h = bitmap.height;
        if (w > maxLado || h > maxLado) {
          if (w > h) { h = Math.round(h * maxLado / w); w = maxLado; }
          else { w = Math.round(w * maxLado / h); h = maxLado; }
        }
        const usaOffscreen = typeof OffscreenCanvas !== 'undefined';
        const canvas = usaOffscreen ? new OffscreenCanvas(w, h) : document.createElement('canvas');
        if (!usaOffscreen) { canvas.width = w; canvas.height = h; }
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, w, h);
        const reduzido = usaOffscreen
          ? await canvas.convertToBlob({ type: 'image/jpeg', quality: qualidade })
          : await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', qualidade));
        const bytes = new Uint8Array(await reduzido.arrayBuffer());
        return { bytes, w, h, tamanho: bytes.length };
      } finally { bitmap.close(); }
    } catch (e) {
      ultimoErro = e;
      if (tentativa < tentativas) await new Promise(r => setTimeout(r, pdfSeguroBackoffMs(tentativa)));
    }
  }
  return { falhou: true, motivo: (ultimoErro && ultimoErro.message) || 'falha desconhecida' };
}

// Desenha o quadro padrão "Foto indisponível" — mesmo visual em todos os
// geradores, para quem usa prepararFotoPdf e recebe {falhou:true}.
function desenharFotoIndisponivel(doc, x, y, w, h, tag) {
  doc.setDrawColor(200); doc.setFillColor(245, 245, 245);
  doc.rect(x, y, w, h, 'FD');
  doc.setFontSize(8); doc.setTextColor(150, 150, 150); doc.setFont('helvetica', 'normal');
  doc.text('Foto indisponível', x + w / 2, y + h / 2 - 2, { align: 'center' });
  if (tag) doc.text(String(tag), x + w / 2, y + h / 2 + 6, { align: 'center' });
  doc.setTextColor(0, 0, 0);
}

// Uma única sessão de geração por vez (bloqueio de geração sobreposta —
// prompt original, seção 3.1.6). Nenhum gerador pode abrir uma segunda
// sessão enquanto esta está ativa.
let _pdfSeguroSessaoAtiva = null;

function _criarModal() {
  let el = document.getElementById('psg-modal');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'psg-modal';
  el.className = 'modal-bg hidden';
  el.innerHTML = `
    <div class="modal">
      <div class="modal-handle"></div>
      <div class="modal-title" id="psg-titulo">Gerando…</div>
      <div class="psg-barra"><div class="psg-prog" id="psg-prog" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div></div>
      <div class="psg-etapa" id="psg-etapa"></div>
      <div class="psg-tempo" id="psg-tempo"></div>
      <div class="psg-aviso">Mantenha esta aba aberta até o fim. A geração pode levar vários minutos.</div>
      <button type="button" class="btn btn-secondary" id="psg-cancelar" style="width:100%;margin-top:12px">Cancelar</button>
    </div>`;
  document.body.appendChild(el);
  return el;
}

// `rotulo` aparece no título ("Gerando relatório XX%" / "Gerando backup XX%").
// `totalFotos` é só para a estimativa inicial de tempo/tamanho — a sessão
// funciona mesmo com 0 fotos (relatórios sem foto nenhuma).
function iniciarSessaoPdf({ rotulo = 'relatório', totalFotos = 0 } = {}) {
  if (_pdfSeguroSessaoAtiva && !_pdfSeguroSessaoAtiva.finalizada) {
    throw new Error('Já existe uma geração de PDF em andamento. Aguarde terminar ou cancele.');
  }

  const modal = _criarModal();
  const titulo = modal.querySelector('#psg-titulo');
  const prog = modal.querySelector('#psg-prog');
  const etapaEl = modal.querySelector('#psg-etapa');
  const tempoEl = modal.querySelector('#psg-tempo');
  const btnCancelar = modal.querySelector('#psg-cancelar');

  const estado = { precalculo: 0, registros: 0, fotos: 0, montagem: 0, saida: 0 };
  const temposFoto = [];
  let fotosFeitas = 0;
  let bytesVolumeAtual = 0;
  let wakeLock = null;
  let cancelada = false;
  let finalizada = false;

  function render(textoEtapa) {
    const pct = pdfSeguroProgresso(estado);
    titulo.textContent = `Gerando ${rotulo} ${pct}%`;
    prog.style.width = pct + '%';
    prog.setAttribute('aria-valuenow', String(pct));
    if (textoEtapa) etapaEl.textContent = textoEtapa;
    const restantes = Math.max(0, totalFotos - fotosFeitas);
    tempoEl.textContent = restantes
      ? 'Tempo restante estimado: ' + pdfSeguroFormatarTempo(pdfSeguroTempoRestanteMs(temposFoto, restantes))
      : '';
  }

  function beforeUnload(e) { e.preventDefault(); e.returnValue = ''; }

  const sessao = {
    get cancelada() { return cancelada; },
    get finalizada() { return finalizada; },

    async abrir() {
      modal.classList.remove('hidden');
      window.addEventListener('beforeunload', beforeUnload);
      btnCancelar.onclick = () => { cancelada = true; btnCancelar.disabled = true; btnCancelar.textContent = 'Cancelando…'; };
      if (navigator.wakeLock) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {} }
      render('Preparando…');
    },

    etapaPrecalculo(fracao) { estado.precalculo = fracao; render('Calculando…'); },
    etapaRegistros(atual, total) {
      estado.registros = total ? atual / total : 1;
      render(`Carregando registros ${atual}/${total}`);
    },

    // Processa uma foto: baixa+reduz, desenha (via `desenhar(prep)`,
    // fornecido pelo chamador — cada gerador sabe onde/como posicionar),
    // cede um tick pro navegador atualizar a tela antes da próxima.
    async processarFoto(ref, desenhar) {
      if (cancelada) return { cancelada: true };
      const inicio = Date.now();
      const prep = await prepararFotoPdf(ref);
      if (!prep.falhou) bytesVolumeAtual += prep.tamanho;
      if (typeof desenhar === 'function') desenhar(prep);
      temposFoto.push(Date.now() - inicio);
      if (temposFoto.length > 20) temposFoto.shift(); // média móvel: só as últimas 20
      fotosFeitas++;
      estado.fotos = totalFotos ? fotosFeitas / totalFotos : 1;
      render(`Processando fotos ${fotosFeitas}/${totalFotos}`);
      await new Promise(r => setTimeout(r, 0)); // cede o event loop — não trava a aba
      return prep;
    },

    volumeCheio() { return pdfSeguroPrecisaNovoVolume(bytesVolumeAtual); },
    resetarVolume() { bytesVolumeAtual = 0; },

    etapaMontagem(fracao = 1) { estado.montagem = fracao; render('Montando páginas…'); },
    etapaSaida(fracao, texto) { estado.saida = fracao; render(texto || 'Finalizando arquivo…'); },

    async finalizar() {
      finalizada = true;
      window.removeEventListener('beforeunload', beforeUnload);
      if (wakeLock) { try { await wakeLock.release(); } catch (_) {} wakeLock = null; }
      modal.classList.add('hidden');
      btnCancelar.disabled = false; btnCancelar.textContent = 'Cancelar';
      if (_pdfSeguroSessaoAtiva === sessao) _pdfSeguroSessaoAtiva = null;
    },

    desenharFotoIndisponivel,
  };

  _pdfSeguroSessaoAtiva = sessao;
  return sessao;
}

// Navegador: expõe em window. Node (teste automatizado): não existe
// `window` — só a Parte 1 (lógica pura) é exportada via module.exports.
if (typeof window !== 'undefined') {
  window.prepararFotoPdf = prepararFotoPdf;
  window.desenharFotoIndisponivel = desenharFotoIndisponivel;
  window.iniciarSessaoPdf = iniciarSessaoPdf;
  window.pdfSeguroProgresso = pdfSeguroProgresso;
  window.pdfSeguroBackoffMs = pdfSeguroBackoffMs;
  window.pdfSeguroPrecisaNovoVolume = pdfSeguroPrecisaNovoVolume;
  window.pdfSeguroTempoRestanteMs = pdfSeguroTempoRestanteMs;
  window.pdfSeguroFormatarTempo = pdfSeguroFormatarTempo;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PDF_SEGURO_PESOS, pdfSeguroProgresso, pdfSeguroBackoffMs,
    PDF_SEGURO_LIMITE_VOLUME_BYTES, pdfSeguroPrecisaNovoVolume,
    pdfSeguroTempoRestanteMs, pdfSeguroFormatarTempo,
  };
}
