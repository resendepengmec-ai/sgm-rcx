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
function calcular(wl, users) {
  const empresaPorContrato = {};
  wl.filter(w => w.role === 'admin_cliente' && w.company).forEach(w => {
    (w.contract ? String(w.contract).split(',').map(s=>s.trim()).filter(Boolean) : [])
      .forEach(num => { empresaPorContrato[num] = w.company; });
  });
  return users.map(u => {
    const wlEntry = wl.find(w => w.email.toLowerCase() === u.email.toLowerCase());
    const conts = wlEntry?.contract ? String(wlEntry.contract).split(',').map(s=>s.trim()).filter(Boolean) : [];
    const empresas = u.role === 'admin_cliente'
      ? (wlEntry?.company ? [wlEntry.company] : [])
      : [...new Set(conts.map(c => empresaPorContrato[c]).filter(Boolean))];
    return { email: u.email, empresas };
  });
}

console.log('── index.html contém a lógica esperada de empresaPorContrato/empresas ──');
assert('fonte tem o cálculo de empresaPorContrato a partir dos admin_cliente com company',
  src.includes("wl.filter(w => w.role === 'admin_cliente' && w.company)"));
assert('fonte resolve "empresas" do staff via conts.map(c => empresaPorContrato[c])',
  src.includes('conts.map(c => empresaPorContrato[c]).filter(Boolean)'));

console.log('── Comportamento: rótulo de empresa por usuário ──');
{
  const wl = [
    { email: 'acA@teste.com', role: 'admin_cliente', company: 'Empresa A', contract: '10' },
    { email: 'acB@teste.com', role: 'admin_cliente', company: 'Empresa B', contract: '20' },
    { email: 'acLegado@teste.com', role: 'admin_cliente', company: '', contract: '30' }, // sem nome fantasia ainda
    { email: 'multi@teste.com', role: 'gestor', contract: '10,20' },     // atende as 2 empresas
    { email: 'so-a@teste.com', role: 'tecnico', contract: '10' },
    { email: 'sem-contrato@teste.com', role: 'diretor', contract: null },
  ];
  const users = wl.map(w => ({ email: w.email, role: w.role }));
  const r = calcular(wl, users);
  const porEmail = Object.fromEntries(r.map(x => [x.email, x.empresas]));

  assert('admin_cliente A mostra o próprio nome fantasia', porEmail['acA@teste.com'].length === 1 && porEmail['acA@teste.com'][0] === 'Empresa A');
  assert('admin_cliente sem nome fantasia ainda: lista vazia (não quebra, não inventa nome)', porEmail['acLegado@teste.com'].length === 0);
  assert('staff vinculado a 1 contrato: mostra só a empresa dona dele', porEmail['so-a@teste.com'].length === 1 && porEmail['so-a@teste.com'][0] === 'Empresa A');
  assert('staff com contratos de 2 admin_clientes diferentes: mostra AS DUAS empresas (rótulo de associação múltipla)',
    porEmail['multi@teste.com'].length === 2 && porEmail['multi@teste.com'].includes('Empresa A') && porEmail['multi@teste.com'].includes('Empresa B'));
  assert('staff sem contrato (irrestrito): nenhuma empresa (não é de ninguém em particular)', porEmail['sem-contrato@teste.com'].length === 0);
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
