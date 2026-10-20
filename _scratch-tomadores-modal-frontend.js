'use strict';
// Teste isolado do modal "Novo/Editar tomador de serviço" (index.html,
// openRespModal):
// 1) o rodapé com Cancelar/Salvar é sticky dentro da área rolável — sem
//    isso, em celular o teclado virtual (ao digitar CPF/celular) empurra
//    o botão Salvar pra fora da área visível, e ele PARECE travado mesmo
//    estando funcional (ver diagnóstico com DOM real que motivou a troca).
// 2) o campo "Ativo" usa o mesmo botão toggle-btn/data-active já usado em
//    "Editar usuário" (demais telas de administração), não mais checkbox.
// Mesmo padrão de extração por regex + vm de _scratch-admin-saas-frontend.js,
// sem depender de nenhuma lib de DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const apiClient = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');

function extraeFuncao(src, nome) {
  // (async\s+)? também captura "async function" — saveRespForm usa await.
  const re = new RegExp(`(?:async\\s+)?function ${nome}\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error('função não encontrada: ' + nome);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

// DOM mínimo escrito à mão (sem jsdom): só o que openRespModal toca ao
// montar o modal. openRespModal chama _maskCpfInput/_maskCelInput no fim
// (pra popular a mensagem de status já na abertura) — essas duas leem
// outros ids via getElementById; aqui devolvemos um objeto descartável
// genérico pra qualquer id que não seja 'resp-modal', só pra não quebrar.
// O que este teste verifica é o HTML já montado pelo template literal,
// não o efeito colateral dessas chamadas.
function stubDOM() {
  let modalEl = null;
  const document = {
    getElementById(id) {
      if (id === 'resp-modal') return modalEl;
      return { value: '', innerHTML: '' };
    },
    createElement(tag) {
      const el = { tagName: tag, id: '', _html: '', style: {} };
      Object.defineProperty(el, 'innerHTML', {
        get() { return el._html; },
        set(v) { el._html = v; },
      });
      return el;
    },
    body: { appendChild(el) { modalEl = el; } },
  };
  return { document, getModal: () => modalEl };
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  extraeFuncao(apiClient, 'esc') + '\n' +
  extraeFuncao(html, '_fmtCpf') + '\n' +
  extraeFuncao(html, '_cpfValido') + '\n' +
  extraeFuncao(html, '_fmtCel') + '\n' +
  extraeFuncao(html, '_maskCpfInput') + '\n' +
  extraeFuncao(html, '_maskCelInput') + '\n' +
  extraeFuncao(html, 'openRespModal') + '\n' +
  'this.esc=esc; this._fmtCpf=_fmtCpf; this._cpfValido=_cpfValido; this._fmtCel=_fmtCel; ' +
  'this._maskCpfInput=_maskCpfInput; this._maskCelInput=_maskCelInput; this.openRespModal=openRespModal;',
  sandbox
);

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

console.log('── Rodapé do modal (Cancelar/Salvar) é sticky — não fica preso atrás do teclado ──');
{
  const { document, getModal } = stubDOM();
  sandbox.document = document;
  sandbox._editingResp = { establishment: 'Unidade Central', contract: '95' }; // novo tomador
  sandbox.openRespModal();
  const h = getModal().innerHTML;
  assert('rodapé usa position:sticky;bottom:0', /position:sticky;bottom:0/.test(h));
  assert('botão Salvar está dentro do rodapé sticky', (() => {
    const i = h.indexOf('position:sticky;bottom:0');
    const j = h.indexOf('>Salvar<');
    return i >= 0 && j > i;
  })());
  assert('o contêiner externo continua rolável (overflow-y:auto)', /overflow-y:auto/.test(h));
}

console.log('── Campo "Ativo" usa o mesmo botão toggle-btn/data-active de "Editar usuário" ──');
{
  const { document, getModal } = stubDOM();
  sandbox.document = document;
  sandbox._editingResp = { establishment: 'Unidade Central', contract: '95' }; // novo tomador
  sandbox.openRespModal();
  const h = getModal().innerHTML;
  assert('não usa mais checkbox (rf-ativo) — foi substituído pelo botão', !h.includes('id="rf-ativo"'));
  assert('botão de status existe com id rf-ativo-btn', h.includes('id="rf-ativo-btn"'));
  assert('usa a classe toggle-btn (mesma de Editar usuário / badges Ativo/Inativo)', /class="toggle-btn active"/.test(h));
  assert('novo tomador: data-active="1" (Ativo) por padrão', /data-active="1"/.test(h));
  assert('texto do botão é "Ativo" por padrão', />Ativo<\/button>/.test(h));
}

console.log('── Editar tomador existente: CPF/celular pré-formatados, status refletido ──');
{
  const { document, getModal } = stubDOM();
  sandbox.document = document;
  sandbox._editingResp = {
    id: 'resp-1', establishment: 'Unidade Central', contract: '95',
    nome: 'Fulano', cargo: 'Síndico', ativo: false,
    cpf: '52998224725', celular: '62999998888',
  };
  sandbox.openRespModal();
  const h = getModal().innerHTML;
  assert('CPF aparece formatado (529.982.247-25), não cru', h.includes('529.982.247-25'));
  assert('celular aparece formatado ((62) 99999-8888), não cru', h.includes('(62) 99999-8888'));
  assert('tomador inativo: data-active="0"', /data-active="0"/.test(h));
  assert('tomador inativo: botão mostra "Inativo" com classe toggle-btn inactive', /class="toggle-btn inactive"/.test(h) && />Inativo<\/button>/.test(h));
}

console.log('── saveRespForm lê o novo botão de status (dataset.active), não mais checkbox ──');
{
  vm.runInContext(
    extraeFuncao(html, 'saveRespForm') + '\nthis.saveRespForm=saveRespForm;',
    sandbox
  );
  const campos = {
    'rf-nome': { value: 'Fulano de Tal' },
    'rf-cpf': { value: '529.982.247-25' },
    'rf-cargo': { value: 'Síndico' },
    'rf-celular': { value: '(62) 99999-8888' },
    'rf-ativo-btn': { dataset: { active: '0' } }, // usuário desmarcou o status
    'rf-cpf-msg': { innerHTML: '' },
    'rf-celular-msg': { innerHTML: '' },
  };
  sandbox.document = { getElementById: id => campos[id] || null };
  sandbox._editingResp = { establishment: 'Unidade Central', contract: '95' };
  sandbox._responsaveis = [];
  let payloadRecebido = null;
  sandbox.DB = { saveResponsavel: async p => { payloadRecebido = p; return { ...p, id: 'resp-novo' }; } };
  sandbox.setActionBusy = () => () => {};
  sandbox.closeRespModal = () => {};
  sandbox.renderRespEstabs = () => {};
  sandbox.showToast = () => {};

  sandbox.saveRespForm({}).then(() => {
    assert('payload.ativo vem de dataset.active (false quando "0")', payloadRecebido && payloadRecebido.ativo === false);
    assert('CPF enviado só com dígitos, mesmo digitado com máscara', payloadRecebido && payloadRecebido.cpf === '52998224725');
    assert('celular enviado só com dígitos, mesmo digitado com máscara', payloadRecebido && payloadRecebido.celular === '62999998888');

    console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
    process.exitCode = falhas === 0 ? 0 : 1;
  });
}
