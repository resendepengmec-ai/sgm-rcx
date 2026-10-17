'use strict';
// Teste isolado da lógica PURA do trail de assinaturas (sigTrailHtml /
// sigTrailPdfLines / _acaoInfo / _sigPapel) em api-client.js — fonte única
// usada por todas as telas e por todos os geradores de PDF (ver auditoria
// "modelo de assinatura padrão pra todo PDF"). Mesmo padrão de extração por
// regex/marcador já usado em _scratch-admin-saas-frontend.js — roda num vm
// limpo, sem o resto do api-client.js (que toca `window`/`fetch` no topo).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const js = fs.readFileSync(path.join(__dirname, 'api-client.js'), 'utf8');

function entre(src, inicioMarca, fimMarca) {
  const i = src.indexOf(inicioMarca);
  const f = src.indexOf(fimMarca, i);
  if (i < 0 || f < 0 || f <= i) throw new Error('marcador não encontrado: ' + inicioMarca);
  return src.slice(i, f);
}

const rolesMatch = /const ROLES = \{[\s\S]*?\n\};/.exec(js);
if (!rolesMatch) throw new Error('ROLES não encontrado em api-client.js');
const escMatch = /function esc\([\s\S]*?\n\}/.exec(js);
if (!escMatch) throw new Error('esc() não encontrado em api-client.js');
const bloco = entre(js,
  '// ── Trilha de assinaturas (_signatures) — modelo padrão pra tela e PDF ──',
  '// ── Estado padrão de ações assíncronas ─────────────────────────────');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  rolesMatch[0] + '\n' + escMatch[0] + '\n' + bloco +
  '\nthis.ROLES=ROLES; this.esc=esc; this.sigTrailHtml=sigTrailHtml; this.sigTrailPdfLines=sigTrailPdfLines; ' +
  'this._acaoInfo=_acaoInfo; this._sigPapel=_sigPapel;',
  sandbox, { filename: 'api-client.js-sigTrail.js' }
);

let falhas = 0;
function assert(desc, cond) {
  if (cond) console.log('  ✓', desc);
  else { console.log('  ✗', desc); falhas++; }
}

console.log('── _sigPapel: usa o rótulo canônico do ROLES (corrige o mapa incompleto da versão antiga) ──');
assert('admin → "Administrador"', sandbox._sigPapel('admin') === 'Administrador');
assert('diretor → "Diretor" (faltava no mapa antigo do _sigTrail)', sandbox._sigPapel('diretor') === 'Diretor');
assert('supervisor → "Supervisor" (faltava no mapa antigo)', sandbox._sigPapel('supervisor') === 'Supervisor');
assert('admin_cliente → "Admin Cliente" (faltava no mapa antigo)', sandbox._sigPapel('admin_cliente') === 'Admin Cliente');
assert('gestor → "Gestor"', sandbox._sigPapel('gestor') === 'Gestor');
assert('papel desconhecido cai no próprio valor (nunca quebra)', sandbox._sigPapel('xyz') === 'xyz');

console.log('── _acaoInfo: ações fixas + as 2 famílias dinâmicas (status:*, nivel_N_*) ──');
assert('criado → rótulo "Criado"', sandbox._acaoInfo('criado').rotulo === 'Criado');
assert('status:andamento → "Em andamento" (chamados)', sandbox._acaoInfo('status:andamento').rotulo === 'Em andamento');
assert('status:approved_partial → "Aprovado parcial" (orçamentos)', sandbox._acaoInfo('status:approved_partial').rotulo === 'Aprovado parcial');
assert('status:<valor desconhecido> não quebra, cai no texto bruto', sandbox._acaoInfo('status:xyz').rotulo === 'Status: xyz');
assert('nivel_2_concluido → "Nível 2 concluído" (preventiva)', sandbox._acaoInfo('nivel_2_concluido').rotulo === 'Nível 2 concluído');
assert('nivel_1_reaberto → "Nível 1 reaberto"', sandbox._acaoInfo('nivel_1_reaberto').rotulo === 'Nível 1 reaberto');
assert('ação totalmente desconhecida não quebra (ícone genérico)', sandbox._acaoInfo('alguma-coisa-nova').icone === '•');

console.log('── sigTrailHtml: visual de tela, agora escapado ──');
{
  const html = sandbox.sigTrailHtml([
    { action: 'criado', by: 'Pedro de Paula', role: 'supervisor', at: new Date('2026-10-15T12:06:00').getTime(), hash: 'bdadd0ff' },
    { action: 'aprovado', by: 'Paulo Resende', role: 'gestor', at: new Date('2026-10-15T19:58:00').getTime(), hash: 'b34c65aa' },
  ]);
  assert('sem assinaturas devolve string vazia', sandbox.sigTrailHtml([]) === '' && sandbox.sigTrailHtml(null) === '');
  assert('mostra o nome e o papel por extenso', html.includes('Pedro de Paula') && html.includes('Supervisor'));
  assert('mostra o hash truncado em 6 chars', html.includes('[bdadd0]'));
  assert('as duas entradas aparecem, separadas por |', html.includes('Paulo Resende') && html.includes('|'));
  const malicioso = sandbox.sigTrailHtml([{ action: 'criado', by: '<img src=x onerror=alert(1)>', role: 'gestor', at: Date.now(), hash: 'aa' }]);
  assert('nome malicioso é escapado (antes a versão copiada não escapava nada)', !malicioso.includes('<img') && malicioso.includes('&lt;img'));
  assert('hash ausente mostra "não verif." em vez de colchete vazio', sandbox.sigTrailHtml([{ action:'criado', by:'X', role:'gestor', at:Date.now(), hash:null }]).includes('não verif.'));
}

console.log('── sigTrailPdfLines: mesmo conteúdo, texto puro (sem emoji — nenhuma lib de PDF daqui tem fonte pra isso) ──');
{
  const linhas = sandbox.sigTrailPdfLines([
    { action: 'criado', by: 'Pedro de Paula', role: 'supervisor', at: new Date('2026-10-15T12:06:00').getTime(), hash: 'bdadd0ff' },
    { action: 'status:approved', by: 'Paulo Resende', role: 'gestor', at: new Date('2026-10-15T19:58:00').getTime(), hash: 'b34c65aa112233' },
  ]);
  assert('sem assinaturas devolve array vazio', sandbox.sigTrailPdfLines([]).length === 0 && sandbox.sigTrailPdfLines(null).length === 0);
  assert('devolve 1 linha por assinatura', linhas.length === 2);
  assert('rótulo entre colchetes, sem ícone/emoji', linhas[0].startsWith('[Criado]') && !/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(linhas[0]));
  assert('mostra nome · papel por extenso · data · HMAC truncado em 8', linhas[0].includes('Pedro de Paula') && linhas[0].includes('Supervisor') && linhas[0].includes('HMAC bdadd0ff'));
  assert('status:approved vira "[Aprovado parcial]"? não — "[Aprovado]" (status approved, não approved_partial)', linhas[1].startsWith('[Aprovado]'));
}

console.log(falhas === 0 ? '\n✅ tudo passou' : `\n❌ ${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
