'use strict';
// Etapa 3 (fecho do lado frontend): corrigirDataExecucaoComServidor
// corrige o campo de data em background, mas só quando ainda está no
// valor-padrão que ELA MESMA preencheu — nunca pisa em edição do usuário
// nem numa data herdada de outro lugar (ex.: data do chamado em f-date-sol).
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'registro.html'), 'utf8');
const m = src.match(/function corrigirDataExecucaoComServidor\([\s\S]*?\n\}/);
if (!m) throw new Error('corrigirDataExecucaoComServidor não encontrada — extração do teste ficou desatualizada');

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

function montarSandbox(hojeServidor) {
  const elementos = {
    'f-date':     { value: '' },
    'f-date-sol': { value: '' },
  };
  const sandbox = {
    console,
    document: { getElementById: id => elementos[id] || null },
    DB: { getTempo: async () => ({ now: Date.now(), hoje: hojeServidor }) },
  };
  const vmCtx = vm.createContext(sandbox);
  vm.runInContext(m[0] + '\nthis.corrigirDataExecucaoComServidor = corrigirDataExecucaoComServidor;', sandbox);
  return { sandbox, elementos };
}

async function esperarMicrotarefas() { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); }

(async () => {
  console.log('── Caso 1: servidor diverge do dispositivo — corrige f-date (sem solicitação) ──');
  {
    const { sandbox, elementos } = montarSandbox('2026-11-13');
    elementos['f-date'].value = '2026-11-12';
    elementos['f-date-sol'].value = '2026-11-12';
    sandbox.corrigirDataExecucaoComServidor('2026-11-12');
    await esperarMicrotarefas();
    assert('f-date corrigido pro valor do servidor', elementos['f-date'].value === '2026-11-13');
    assert('f-date-sol NÃO é tocado (incluirSolicitacao não foi passado)', elementos['f-date-sol'].value === '2026-11-12');
  }

  console.log('── Caso 2: com incluirSolicitacao, corrige os dois ──');
  {
    const { sandbox, elementos } = montarSandbox('2026-11-13');
    elementos['f-date'].value = '2026-11-12';
    elementos['f-date-sol'].value = '2026-11-12';
    sandbox.corrigirDataExecucaoComServidor('2026-11-12', { incluirSolicitacao: true });
    await esperarMicrotarefas();
    assert('f-date corrigido', elementos['f-date'].value === '2026-11-13');
    assert('f-date-sol também corrigido', elementos['f-date-sol'].value === '2026-11-13');
  }

  console.log('── Caso 3: usuário já editou o campo — correção não pisa em cima ──');
  {
    const { sandbox, elementos } = montarSandbox('2026-11-13');
    elementos['f-date'].value = '2026-11-12';
    elementos['f-date-sol'].value = '2026-11-12';
    sandbox.corrigirDataExecucaoComServidor('2026-11-12', { incluirSolicitacao: true });
    elementos['f-date'].value = '2020-01-01'; // usuário editou antes da correção chegar
    await esperarMicrotarefas();
    assert('valor editado pelo usuário é preservado', elementos['f-date'].value === '2020-01-01');
  }

  console.log('── Caso 4: servidor concorda com o dispositivo — nada muda ──');
  {
    const { sandbox, elementos } = montarSandbox('2026-11-12');
    elementos['f-date'].value = '2026-11-12';
    sandbox.corrigirDataExecucaoComServidor('2026-11-12');
    await esperarMicrotarefas();
    assert('f-date permanece igual', elementos['f-date'].value === '2026-11-12');
  }

  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo passou');
  process.exitCode = falhas ? 1 : 0;
})();
