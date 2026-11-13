#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────
 * frontend.test.js — validação estática do frontend
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Uma edição automatizada inseriu uma instrução ENTRE um `if` e o seu
 * `else` em relatorio/contratos/patrimonio/dashboard. Isso é SyntaxError:
 * o bloco de script inteiro deixa de executar, o overlay de autenticação
 * nunca é escondido, e a página trava para sempre em "Verificando acesso…".
 *
 * O erro passou por três validações anteriores sem ser detectado, porque
 * todas checavam o HTML (tags balanceadas, parsing) e nenhuma checava o
 * JAVASCRIPT DENTRO do HTML. Contagem de tags não vê SyntaxError.
 *
 * Uso:  node test/frontend.test.js [caminho-do-frontend]
 * ────────────────────────────────────────────────────────────────── */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = process.argv[2] || path.join(__dirname, '..', '..', 'sgm-rcx');

let passou = 0, falhou = 0;
const falhas = [];
function checar(nome, cond, det = '') {
  if (cond) { passou++; console.log(`  ✓ ${nome}`); }
  else { falhou++; console.log(`  ✗ ${nome}${det ? '\n      ' + det : ''}`); falhas.push(nome); }
}

if (!fs.existsSync(RAIZ)) {
  console.error(`Frontend não encontrado em ${RAIZ}`);
  console.error('Uso: node test/frontend.test.js /caminho/para/sgm-rcx');
  process.exit(1);
}

const htmls = fs.readdirSync(RAIZ).filter(f => f.endsWith('.html')).sort();

// ── 1. Sintaxe de cada bloco de script inline ─────────────────────
console.log('\n═══ FRONTEND: sintaxe e integridade ═══\n');
console.log('── 1. JavaScript inline compila? ──');

for (const arquivo of htmls) {
  const html = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
  // Blocos <script> SEM src (os inline). O ? torna a captura não-gulosa.
  const blocos = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  let erro = null, idx = 0;

  for (const b of blocos) {
    idx++;
    const codigo = b[1];
    if (!codigo.trim()) continue;
    try {
      // new vm.Script apenas COMPILA — não executa nada. É o mesmo
      // parser que o navegador usaria.
      new vm.Script(codigo, { filename: `${arquivo}#script${idx}` });
    } catch (e) {
      // Linha aproximada dentro do arquivo, para facilitar o conserto
      const antes = html.slice(0, b.index).split('\n').length;
      const dentro = e.stack && e.stack.match(/#script\d+:(\d+)/);
      const linha = antes + (dentro ? parseInt(dentro[1], 10) : 0);
      erro = `bloco ${idx}, ~linha ${linha}: ${e.message}`;
      break;
    }
  }
  checar(`${arquivo} (${blocos.length} bloco(s) inline)`, !erro, erro || '');
}

// (A verificação heurística de "else órfão" foi REMOVIDA: `if (x) faz();
// else outra();` sem chaves é JavaScript perfeitamente válido, e a
// heurística acusava esses casos como erro. A compilação do item 1 já
// detecta a cadeia partida com precisão, usando o próprio parser do
// motor — não há motivo para uma segunda checagem aproximada.)


// ── 2. Módulos passados a guardaDeModulo existem em ROLES ─────────
// Um nome errado ('relatorio' em vez de 'relatorios') não é erro de
// sintaxe: a página carrega e redireciona TODO MUNDO para index.html.
console.log('\n── 2. Nomes de módulo válidos ──');
{
  const client = fs.readFileSync(path.join(RAIZ, 'api-client.js'), 'utf8');
  const validos = new Set();
  for (const m of client.matchAll(/modules:\s*\[([^\]]*)\]/g))
    for (const t of m[1].matchAll(/'([^']+)'/g)) validos.add(t[1]);

  checar('ROLES define a lista de módulos', validos.size > 0, `(${validos.size} encontrados)`);

  for (const arquivo of htmls) {
    const html = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    const usados = [...html.matchAll(/guardaDeModulo\('([^']+)'/g)].map(m => m[1]);
    for (const mod of usados) {
      checar(`${arquivo}: guardaDeModulo('${mod}')`, validos.has(mod),
        `módulo inexistente — a página redirecionaria todos. Válidos: ${[...validos].join(', ')}`);
    }
  }
}

// ── 3. Toda página protegida esconde o overlay ────────────────────
console.log('\n── 3. Overlay de autenticação é escondido ──');
for (const arquivo of htmls) {
  const html = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
  if (!html.includes('auth-overlay')) continue;
  checar(`${arquivo}: esconde o overlay`,
    /auth-overlay'\)\.style\.display\s*=\s*'none'|auth-overlay"\)\.style\.display\s*=\s*"none"/.test(html),
    'a página mostra "Verificando acesso…" mas nunca esconde o overlay');
}

// ── 4. Bibliotecas locais, sem CDN ────────────────────────────────
console.log('\n── 4. Bibliotecas auto-hospedadas ──');
{
  const vendor = path.join(RAIZ, 'vendor');
  checar('pasta vendor/ existe', fs.existsSync(vendor));
  if (fs.existsSync(vendor)) {
    for (const lib of ['jspdf.umd.min.js', 'xlsx.full.min.js', 'chart.umd.js'])
      checar(`vendor/${lib} presente`, fs.existsSync(path.join(vendor, lib)));
  }
  const comCdn = htmls.filter(f =>
    /cdnjs\.cloudflare|unpkg\.com|jsdelivr/.test(fs.readFileSync(path.join(RAIZ, f), 'utf8')));
  checar('nenhuma página carrega script de CDN', comCdn.length === 0, comCdn.join(', '));
}

// ── 5. Layout: viewport, cache do CSS, cabeçalho e cards ──────────
// Regressões já vistas: zoom bloqueado, Safari/Chrome Android servindo o
// shared.css antigo depois do deploy, cabeçalho sem a classe que o deixa
// fixo e "·" literal sobrando entre campos vazios nos cards de lista.
console.log('\n── 5. Layout (cabeçalho fixo e cards) ──');
{
  // Páginas com barra de topo própria, fora do padrão .app-header.
  const CABECALHO_PROPRIO = { 'index.html': 'dash-topbar', 'assinar.html': 'topbar' };
  // Páginas públicas/estáticas sem barra de topo (abertura com "hero").
  const SEM_CABECALHO = ['sobre.html', 'privacidade.html', 'auth-callback.html'];
  for (const arquivo of htmls) {
    const html = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    const vp = (html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/i) || [])[1] || '';
    checar(`${arquivo}: meta viewport`,
      /width=device-width/.test(vp) && /initial-scale=1(\.0)?\b/.test(vp) && /viewport-fit=cover/.test(vp)
        && !/user-scalable\s*=\s*no|maximum-scale/i.test(vp), `content="${vp}"`);
    if (/href="shared.css/.test(html)) {
      const refs = [...html.matchAll(/href="shared\.css([^"]*)"/g)].map((m) => m[1]);
      checar(`${arquivo}: shared.css com ?v=`, refs.length > 0 && refs.every((q) => /^\?v=[\w.-]+$/.test(q)), refs.join(' '));
    }
    if (SEM_CABECALHO.includes(arquivo)) continue;
    const classe = CABECALHO_PROPRIO[arquivo] || 'app-header';
    checar(`${arquivo}: cabeçalho .${classe}`, new RegExp(`class="[^"]*\\b${classe}\\b`).test(html));
  }

  // Dentro do HTML de card (de class="lcard" até o fim do template), nenhum
  // "·" literal colado a uma interpolação: separador é .sep ou o gap do .cluster.
  const fontes = [...htmls, 'api-client.js'];
  for (const arquivo of fontes) {
    const src = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    const ruins = [];
    for (const m of src.matchAll(/class="lcard[\s\S]*?<\/div>`/g)) {
      if (/\}\s*·|·\s*\$\{|'\s*·\s*'/.test(m[0])) ruins.push(src.slice(0, m.index).split('\n').length);
    }
    if (src.includes('class="lcard')) checar(`${arquivo}: cards sem "·" literal entre campos`, !ruins.length, `linhas ~${ruins.join(', ')}`);
  }
}

console.log(`\n═══ ${passou} passaram, ${falhou} falharam ═══\n`);
if (falhou) falhas.forEach(f => console.log('  ✗ ' + f));
process.exit(falhou ? 1 : 0);
