'use strict';
// Teste isolado da condição de exibição do botão "Pegar assinatura do
// cliente" em preventiva.html (renderPlansList) e registro.html
// (renderOSList): só deve aparecer quando o filtro de contrato da própria
// tela está em UM contrato específico (nunca "todos") E esse contrato,
// vindo fresco do servidor, tem assinaturaClientePorEstab=true. Extrai só
// o trecho de cálculo (não a função de render inteira, que depende de
// muito DOM) via marcadores fixos no comentário que precede o trecho.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

// Extrai de `const _contratoFiltrado...` até o `;` do `const _btnAssin = ...;`
// (2 statements, o 2º terminado por `;` seguido de quebra de linha).
function extraeCalculoBotao(src) {
  const inicio = src.indexOf('const _contratoFiltrado');
  if (inicio < 0) throw new Error('trecho _contratoFiltrado não encontrado');
  const marcaFim = src.indexOf(": ''", inicio);
  if (marcaFim < 0) throw new Error('fim do trecho _btnAssin não encontrado');
  const fim = src.indexOf(';', marcaFim) + 1;
  return src.slice(inicio, fim);
}

function testaArquivo(arquivo, varFiltro, varContratos) {
  console.log(`── ${arquivo}: botão só aparece com filtro em 1 contrato habilitado ──`);
  const src = fs.readFileSync(path.join(__dirname, arquivo), 'utf8');
  const trecho = extraeCalculoBotao(src);

  function roda(fContractVal, contratosFrescos) {
    const sandbox = {};
    sandbox[varFiltro] = fContractVal;
    sandbox[varContratos] = contratosFrescos;
    vm.createContext(sandbox);
    // `const` declarado via runInContext não aparece como propriedade do
    // sandbox (ambiente léxico próprio do vm) — expõe explicitamente.
    vm.runInContext(trecho + '\nthis._btnAssin = _btnAssin;', sandbox);
    return sandbox._btnAssin;
  }

  const contratos = [
    { numero: '10', assinaturaClientePorEstab: true },
    { numero: '20', assinaturaClientePorEstab: false },
  ];

  assert('sem filtro algum (contrato "" / todos): botão NÃO aparece',
    roda('', contratos) === '');
  assert('filtro em contrato SEM a opção ligada: botão NÃO aparece',
    roda('20', contratos) === '');
  assert('filtro em contrato COM a opção ligada: botão aparece',
    roda('10', contratos).includes('Pegar assinatura do cliente'));
  assert('filtro num contrato que nem existe na lista fresca: botão NÃO aparece',
    roda('999', contratos) === '');
  assert('lista de contratos frescos ainda vazia (fetch não chegou): botão NÃO aparece mesmo com filtro setado',
    roda('10', []) === '');
}

testaArquivo('preventiva.html', 'fContract', '_contratosFrescos');
testaArquivo('registro.html', 'filterContract', '_contratosFrescosReg');

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
