'use strict';
// Teste isolado da lógica PURA do painel admin (admin_cliente — SaaS, ver
// PROMPT-CODEX-admin-saas.md) em index.html: extrai as duas funções novas
// e o ROLES real de api-client.js (mesma fonte de verdade da tela), roda
// num vm limpo. Não executa o script inteiro de index.html (tem efeito
// colateral de DOM/sessão no topo) — só as funções em si, extraídas do
// arquivo real por regex, não reescritas à mão.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const apiClient = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');

function extraeFuncao(src, nome) {
  const re = new RegExp(`function ${nome}\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error('função não encontrada em index.html: ' + nome);
  let i = m.index + m[0].length, depth = 1;
  while (depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

const rolesMatch = /const ROLES = \{[\s\S]*?\n\};/.exec(apiClient);
if (!rolesMatch) throw new Error('ROLES não encontrado em api-client.js');

const sandbox = {};
vm.createContext(sandbox);
// `const`/`function` no topo de um Script vm NÃO vira propriedade do
// objeto de contexto (só `var` faz isso) — exporta explicitamente.
vm.runInContext(
  rolesMatch[0] + '\n' +
  extraeFuncao(html, 'podeAdministrar') + '\n' +
  extraeFuncao(html, 'papeisSelecionaveis') + '\n' +
  'this.ROLES = ROLES; this.podeAdministrar = podeAdministrar; this.papeisSelecionaveis = papeisSelecionaveis;',
  sandbox, { filename: 'index.html-admin-helpers.js' }
);

let falhas = 0;
function assert(desc, cond) {
  if (cond) console.log('  ✓', desc);
  else { console.log('  ✗', desc); falhas++; }
}

console.log('── ROLES: admin_cliente existe e tem o essencial ──');
assert('ROLES.admin_cliente existe', !!sandbox.ROLES.admin_cliente);
assert('admin_cliente inclui o módulo "admin" (abre o painel)', sandbox.ROLES.admin_cliente.modules.includes('admin'));
assert('admin_cliente inclui os mesmos módulos operacionais de diretor', sandbox.ROLES.admin_cliente.modules.includes('contratos') && sandbox.ROLES.admin_cliente.modules.includes('qai'));

console.log('── podeAdministrar: quem abre o painel ──');
assert('admin abre o painel', sandbox.podeAdministrar('admin'));
assert('admin_cliente abre o painel', sandbox.podeAdministrar('admin_cliente'));
assert('diretor NÃO abre o painel (preserva comportamento atual)', !sandbox.podeAdministrar('diretor'));
assert('gestor NÃO abre o painel', !sandbox.podeAdministrar('gestor'));
assert('undefined/sem sessão não abre o painel', !sandbox.podeAdministrar(undefined));

console.log('── papeisSelecionaveis: o que cada ator pode oferecer num <select> ──');
{
  const paraAdmin = sandbox.papeisSelecionaveis('admin').map(([k]) => k);
  const paraCliente = sandbox.papeisSelecionaveis('admin_cliente').map(([k]) => k);
  assert('admin pode oferecer admin_cliente', paraAdmin.includes('admin_cliente'));
  assert('admin pode oferecer admin', paraAdmin.includes('admin'));
  assert('admin_cliente NÃO pode oferecer admin', !paraCliente.includes('admin'));
  assert('admin_cliente NÃO pode oferecer admin_cliente (nem a si mesmo)', !paraCliente.includes('admin_cliente'));
  assert('admin_cliente ainda pode oferecer os 4 papéis de baixo', ['diretor','supervisor','gestor','tecnico','solicitante'].every(r => paraCliente.includes(r)));
  assert('lista de admin_cliente tem exatamente 5 opções (sem os 2 privilegiados)', paraCliente.length === Object.keys(sandbox.ROLES).length - 2);
}

console.log('── addResponsavel: bug pré-existente de função duplicada (shadowing) ──');
{
  // Havia uma 2ª function addResponsavel(contract, est) logo depois desta,
  // que sobrescrevia por hoisting — o único onclick existente chama
  // addResponsavel(ei) (índice do estabelecimento). Prova que, extraindo a
  // função pelo NOME do arquivo real, só existe UMA definição agora (senão
  // extraeFuncao já teria pego a primeira ocorrência, mascarando o bug) e
  // que ela monta _editingResp corretamente a partir de window._respCtx.
  const ocorrencias = html.match(/function addResponsavel\(/g) || [];
  assert('addResponsavel só tem 1 declaração agora (não há mais shadowing)', ocorrencias.length === 1);

  const respSandbox = { console };
  respSandbox.window = respSandbox;
  respSandbox.window._respCtx = { contract: '1020', estabs: ['Unidade A', 'Unidade B'] };
  let modalChamadoCom = null;
  respSandbox.openRespModal = () => { modalChamadoCom = respSandbox._editingResp; };
  vm.createContext(respSandbox);
  vm.runInContext(
    'let _editingResp = null;\n' +
    extraeFuncao(html, 'addResponsavel') + '\n' +
    'this.addResponsavel = addResponsavel; this._getEditingResp = () => _editingResp;',
    respSandbox, { filename: 'index.html-addResponsavel.js' }
  );
  respSandbox.addResponsavel(1); // clica "+ Adicionar" no 2º estabelecimento (índice 1)
  const resultado = respSandbox._getEditingResp();
  assert('contract vem do contexto real (não um índice numérico)', resultado?.contract === '1020');
  assert('establishment resolvido pelo índice (não undefined)', resultado?.establishment === 'Unidade B');
}

console.log('── indicador de consumo da franquia (Minha Empresa) ──');
{
  // _barraFranquia/_fmtAnoMes/_indicadorFranquiaHtml ficam em bloco
  // contíguo no arquivo real — extrai tudo entre as duas marcas (inclui
  // o array const _MESES_PT, que extraeFuncao não cobre por não ser uma
  // function declaration).
  const inicio = html.indexOf('function _barraFranquia');
  const fim = html.indexOf('function renderMinhaEmpresaForm');
  if (inicio < 0 || fim < 0 || fim <= inicio) throw new Error('bloco do indicador de franquia não encontrado em index.html');
  const bloco = html.slice(inicio, fim);

  const indSandbox = { esc: s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') };
  vm.createContext(indSandbox);
  vm.runInContext(
    bloco + '\nthis._barraFranquia=_barraFranquia; this._fmtAnoMes=_fmtAnoMes; this._indicadorFranquiaHtml=_indicadorFranquiaHtml;',
    indSandbox, { filename: 'index.html-indicador-franquia.js' }
  );

  assert('_fmtAnoMes formata 2026-10 como outubro/2026', indSandbox._fmtAnoMes('2026-10') === 'outubro/2026');
  assert('_fmtAnoMes formata 2026-01 como janeiro/2026', indSandbox._fmtAnoMes('2026-01') === 'janeiro/2026');

  assert('_barraFranquia sem limite finito não desenha nada', indSandbox._barraFranquia(3, null) === '');
  assert('_barraFranquia dentro do limite (verde)', indSandbox._barraFranquia(1, 5).includes('#16a34a'));
  assert('_barraFranquia perto do limite, 80%+ (amarelo)', indSandbox._barraFranquia(4, 5).includes('#d97706'));
  assert('_barraFranquia no limite ou acima (vermelho)', indSandbox._barraFranquia(5, 5).includes('#dc2626'));

  const html1 = indSandbox._indicadorFranquiaHtml({
    franquiaContratos: { limite: 3, usado: 2 },
    franquiaFotos: { anoMes: '2026-10', limite: 5, usado: 3, porContrato: [{ contrato: '60', usado: 2 }, { contrato: '61', usado: 1 }] },
  });
  assert('indicador mostra "2 de 3" contratos', html1.includes('2') && html1.includes('de 3'));
  assert('indicador mostra o mês formatado', html1.includes('outubro/2026'));
  assert('indicador lista o contrato 60 com 2 fotos', /Contrato 60[\s\S]*?2 fotos/.test(html1));
  assert('indicador lista o contrato 61 com 1 foto (singular)', /Contrato 61[\s\S]*?1 foto(?!s)/.test(html1));

  const html2 = indSandbox._indicadorFranquiaHtml({
    franquiaContratos: { limite: null, usado: 0 },
    franquiaFotos: { anoMes: '2026-10', limite: null, usado: 0, porContrato: [] },
  });
  assert('sem limite definido mostra aviso em vez de "de X"', html2.includes('sem limite definido'));
  assert('sem fotos no mês mostra mensagem vazia', html2.includes('Nenhuma foto enviada este mês ainda'));

  // Nome de contrato malicioso é escapado (o mesmo rigor de qualquer
  // outro template desta tela).
  const html3 = indSandbox._indicadorFranquiaHtml({
    franquiaContratos: {}, franquiaFotos: { porContrato: [{ contrato: '<img src=x onerror=alert(1)>', usado: 1 }] },
  });
  assert('contrato malicioso no indicador é escapado', !html3.includes('<img') && html3.includes('&lt;img'));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
