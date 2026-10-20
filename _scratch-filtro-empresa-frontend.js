'use strict';
// Teste isolado do cálculo de "a qual empresa (admin_cliente) cada
// usuário pertence" em _renderUsersList (index.html) — rótulo/filtro de
// "empresas contratantes do SaaS" (nome fantasia). Staff que atende mais
// de uma empresa (mesmo e-mail com contratos de admin_clientes
// diferentes — já suportado no backend, ver _scratch-admin-saas-http.js
// "Um e-mail pode abranger contratos de admin_clientes DIFERENTES")
// precisa aparecer com os rótulos das duas, não só uma.
const fs = require('fs');
const path = require('path');

let falhas = 0;
function assert(desc, cond) { if (cond) console.log('  ✓', desc); else { console.log('  ✗', desc); falhas++; } }

const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Reimplementação literal do trecho de _renderUsersList que resolve
// empresaPorContrato/empresas — comparada linha a linha com o arquivo
// real para garantir que não diverge silenciosamente de uma edição futura.
//
// Admin Cliente multi-empresa (mais de 1 CNPJ — ver Pré-autorizar): o
// rótulo 🏢 precisa listar TODAS as empresas vinculadas ao e-mail, não só
// uma. Bug corrigido aqui: a versão anterior usava `wl.find(...)` (só a
// PRIMEIRA linha da whitelist com aquele e-mail), então um admin_cliente
// de 2+ empresas só aparecia com UMA das duas — qual delas dependia da
// ordem de retorno do backend, não de qual estava "selecionada" em lugar
// nenhum.
function calcular(wl, users) {
  const empresaPorContrato = {};
  wl.filter(w => w.role === 'admin_cliente' && w.company).forEach(w => {
    (w.contract ? String(w.contract).split(',').map(s=>s.trim()).filter(Boolean) : [])
      .forEach(num => { empresaPorContrato[num] = w.company; });
  });
  return users.map(u => {
    const minhasLinhas = wl.filter(w => w.email.toLowerCase() === u.email.toLowerCase());
    const wlEntry = minhasLinhas[0];
    const conts = wlEntry?.contract ? String(wlEntry.contract).split(',').map(s=>s.trim()).filter(Boolean) : [];
    const empresas = u.role === 'admin_cliente'
      ? [...new Set(minhasLinhas.map(w => w.company).filter(Boolean))]
      : [...new Set(conts.map(c => empresaPorContrato[c]).filter(Boolean))];
    return { email: u.email, empresas };
  });
}

console.log('── index.html contém a lógica esperada de empresaPorContrato/empresas ──');
assert('fonte tem o cálculo de empresaPorContrato a partir dos admin_cliente com company',
  src.includes("wl.filter(w => w.role === 'admin_cliente' && w.company)"));
assert('fonte resolve "empresas" do staff via conts.map(c => empresaPorContrato[c])',
  src.includes('conts.map(c => empresaPorContrato[c]).filter(Boolean)'));
assert('fonte resolve "empresas" do admin_cliente a partir de TODAS as próprias linhas (não só a primeira encontrada)',
  src.includes('minhasLinhas.map(w => w.company).filter(Boolean)'));

console.log('── Comportamento: rótulo de empresa por usuário ──');
{
  const wl = [
    { email: 'acA@teste.com', role: 'admin_cliente', company: 'Empresa A', contract: '10' },
    { email: 'acB@teste.com', role: 'admin_cliente', company: 'Empresa B', contract: '20' },
    { email: 'acLegado@teste.com', role: 'admin_cliente', company: '', contract: '30' }, // sem nome fantasia ainda
    { email: 'multi@teste.com', role: 'gestor', contract: '10,20' },     // atende as 2 empresas
    { email: 'so-a@teste.com', role: 'tecnico', contract: '10' },
    { email: 'sem-contrato@teste.com', role: 'diretor', contract: null },
    // Admin Cliente dono de 2 empresas (mesmo e-mail, 2 linhas na
    // whitelist, 1 por CNPJ) — cenário do pedido do usuário.
    { email: 'donoMulti@teste.com', role: 'admin_cliente', company: 'Empresa C', cnpj: '1', contract: '40' },
    { email: 'donoMulti@teste.com', role: 'admin_cliente', company: 'Empresa D', cnpj: '2', contract: '50' },
  ];
  const users = [...new Map(wl.map(w => [w.email.toLowerCase(), { email: w.email, role: w.role }])).values()];
  const r = calcular(wl, users);
  const porEmail = Object.fromEntries(r.map(x => [x.email, x.empresas]));

  assert('admin_cliente A mostra o próprio nome fantasia', porEmail['acA@teste.com'].length === 1 && porEmail['acA@teste.com'][0] === 'Empresa A');
  assert('admin_cliente sem nome fantasia ainda: lista vazia (não quebra, não inventa nome)', porEmail['acLegado@teste.com'].length === 0);
  assert('staff vinculado a 1 contrato: mostra só a empresa dona dele', porEmail['so-a@teste.com'].length === 1 && porEmail['so-a@teste.com'][0] === 'Empresa A');
  assert('staff com contratos de 2 admin_clientes diferentes: mostra AS DUAS empresas (rótulo de associação múltipla)',
    porEmail['multi@teste.com'].length === 2 && porEmail['multi@teste.com'].includes('Empresa A') && porEmail['multi@teste.com'].includes('Empresa B'));
  assert('staff sem contrato (irrestrito): nenhuma empresa (não é de ninguém em particular)', porEmail['sem-contrato@teste.com'].length === 0);
  assert('Admin Cliente dono de 2 empresas: rótulo lista AS DUAS (Empresa C e D), não só a primeira encontrada',
    porEmail['donoMulti@teste.com'].length === 2 && porEmail['donoMulti@teste.com'].includes('Empresa C') && porEmail['donoMulti@teste.com'].includes('Empresa D'));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
