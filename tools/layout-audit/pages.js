'use strict';
// Páginas auditadas. "pronto" é um seletor que indica que a lista já
// renderizou; "preparar" leva a tela até o estado auditado (aba, sublista).

const CARDS = '.lcard,#l-lista > div,.tabela-cards tbody tr,.event-row,.chamado-card,.record-card,.quote-card,.tri-card,.user-row,.mov-card,.plan-card,.contract-card,.laudo-card,.equip-card,.module-card,.os-card,.wl-row';

const PAGINAS = [
  { nome: 'chamados', arquivo: 'chamados.html', papel: 'supervisor', pronto: '#chamados-list > *' },
  { nome: 'registro', arquivo: 'registro.html', papel: 'supervisor', pronto: '#records-list > *' },
  { nome: 'registro-os', arquivo: 'registro.html', papel: 'supervisor', pronto: '#records-list > *', preparar: "switchTab('os')", depois: '#os-list > *' },
  { nome: 'orcamento', arquivo: 'orcamento.html', papel: 'supervisor', pronto: '#quotes-list > *' },
  { nome: 'patrimonio', arquivo: 'patrimonio.html', papel: 'supervisor', pronto: '#mov-list > *', },
  { nome: 'preventiva', arquivo: 'preventiva.html', papel: 'supervisor', pronto: '#plans-list > *' },
  { nome: 'laudo', arquivo: 'laudo.html', papel: 'supervisor', pronto: '#root .scope-tab', preparar: "switchView('realizados')" },
  { nome: 'contratos', arquivo: 'contratos.html', papel: 'admin', pronto: '#contracts-list > *' },
  { nome: 'contratos-equip', arquivo: 'contratos.html', papel: 'admin', pronto: '#contracts-list > *', preparar: "viewEquipamentos('c1')" },
  { nome: 'index', arquivo: 'index.html', papel: 'admin', pronto: '.module-card', cabecalho: '.dash-header-top' },
  { nome: 'index-usuarios', arquivo: 'index.html', papel: 'admin', pronto: '.module-card', preparar: 'showAdminPanel()', depois: '.user-row', cabecalho: '.dash-header-top' },
  { nome: 'index-whitelist', arquivo: 'index.html', papel: 'admin', pronto: '.module-card', preparar: "showAdminPanel(); setAdminTab('whitelist')", depois: '.wl-row', cabecalho: '.dash-header-top' },
  { nome: 'relatorio', arquivo: 'relatorio.html', papel: 'supervisor', pronto: '.app-header', preparar: 'render()', depois: '#eventos-list > *' },
  { nome: 'qai', arquivo: 'qai.html', papel: 'supervisor', pronto: '.app-header' },
  { nome: 'dashboard', arquivo: 'dashboard.html', papel: 'supervisor', pronto: '.app-header' },
  { nome: 'recebimento', arquivo: 'recebimento.html', papel: 'supervisor', pronto: '.app-header' },
  { nome: 'backup', arquivo: 'backup.html', papel: 'admin', pronto: '.app-header' },
  { nome: 'sobre', arquivo: 'sobre.html', papel: 'supervisor', pronto: 'body', cabecalho: null },
  { nome: 'privacidade', arquivo: 'privacidade.html', papel: 'supervisor', pronto: 'body', cabecalho: null },
];

module.exports = { PAGINAS, CARDS };
