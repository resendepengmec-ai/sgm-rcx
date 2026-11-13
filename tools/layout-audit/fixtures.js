'use strict';
// Dados sintéticos "difíceis" para a auditoria de layout. Nada aqui toca
// a produção: todas as chamadas à API são interceptadas por page.route.

const AGORA = Date.parse('2026-11-13T15:37:00-03:00');
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPhfDwAEhwH9h5oQ8QAAAABJRU5ErkJggg==';

const NOME_LONGO = 'Paulo Vinícius da Silva Resende de Albuquerque Cavalcanti';
const ESCOLA_80 = 'ESCOLA MUNICIPAL PROFESSORA MARIA APARECIDA DOS SANTOS CARAIBAS DE GOIÁS CENTRO';
const CONTRATO_LONGO = '622_Aditivo_062/2026';

function trilha(n) {
  const papeis = ['tecnico', 'supervisor', 'gestor', 'admin_cliente', 'diretor'];
  const acoes = ['criou', 'editou', 'aprovou', 'assinou', 'concluiu'];
  return Array.from({ length: n }, (_, i) => ({
    action: acoes[i % acoes.length],
    by_name: i === 0 ? 'Paulo Vinícius da Silva Resende' : NOME_LONGO,
    by: 'usuario' + i + '@exemplo.com.br',
    role: papeis[i % papeis.length],
    at: AGORA - (n - i) * 3600e3,
    hash: '251d81' + 'abcdef0123456789'.repeat(3),
  }));
}

// Defeito de referência: card de chamado com selos, TAG, contrato longo,
// solicitante, estabelecimento · local e trilha de assinatura.
const CHAMADOS = [
  {
    id: 'CHMWFBKN6KKZ', status: 'andamento', priority: 'normal', date: '2026-11-13',
    client: CONTRATO_LONGO, equip: '1500', requester: 'Joana',
    machine: { estabelecimento: 'ESCOLA MUN. CARAIBAS', recinto: 'SALA 01' },
    desc: '', photos: [{ dataUrl: PNG_1PX }], photoCount: 1, _signatures: trilha(1),
  },
  {
    id: 'CHMXXXXXXXXXXXXLONGO1234', status: 'aberto', priority: 'urgente', date: '2026-11-12',
    client: CONTRATO_LONGO, equip: 'TAG-000123456789', requester: NOME_LONGO,
    machine: { estabelecimento: ESCOLA_80, recinto: 'SALA DE INFORMÁTICA E LABORATÓRIO DE CIÊNCIAS 02' },
    desc: 'Aparelho de ar-condicionado não liga, display pisca e desarma o disjuntor do quadro geral logo após a partida do compressor.',
    photos: [], photoCount: 3, _signatures: trilha(5),
  },
  {
    id: 'CHMSEMCAMPOS', status: 'resolvido', priority: 'baixa', date: '2026-11-01',
    client: '1020', equip: '', requester: '', machine: null, desc: '', photos: [], _signatures: [],
  },
];

const REGISTROS = [
  {
    id: 'reg-1', date: '2026-11-13', client: CONTRATO_LONGO, equip: '1500', tech: NOME_LONGO,
    items: [{ name: 'Limpeza completa de evaporadora e condensadora com higienização' }, { name: 'Troca de capacitor' }],
    machine: { estabelecimento: ESCOLA_80, recinto: 'SALA 01' }, photos: [{ dataUrl: PNG_1PX }], photoCount: 12,
    _signatures: trilha(5),
  },
  {
    id: 'reg-2', date: '2026-11-10', client: '1020', equip: '', tech: '', items: [{ name: 'Inspeção' }],
    machine: null, photos: [], photoCount: 0,
  },
  {
    id: 'reg-3', date: '2026-11-09', _avulso: true, equip: 'SPLIT-9000', tech: 'Joana',
    items: [{ inviavel: true }], machine: { cliente: 'Cliente avulso com nome comercial muito comprido Ltda.', endereco: 'Rua das Palmeiras, 1234, Bloco C, Apto 501, Setor Bueno, Goiânia' },
    photos: [], photoCount: 1,
  },
];

const ORDENS = [
  {
    id: 'os-1', numero: 'OS-2026-000123456', chamadoId: 'CHMWFBKN6KKZ', status: 'em_execucao',
    tag: '1500', contrato: CONTRATO_LONGO, machine: { estabelecimento: ESCOLA_80, recinto: 'SALA 01' },
    chamadoDesc: 'Aparelho não liga e desarma o disjuntor do quadro geral logo após a partida do compressor, com cheiro de queimado.',
    tecnico: NOME_LONGO, criadoEm: AGORA - 86400e3, servicos: ['Diagnóstico elétrico completo'],
  },
  { id: 'os-2', numero: 'OS-2', chamadoId: 'CHMSEMCAMPOS', status: 'aberta', tag: '', contrato: '1020', criadoEm: AGORA },
];

const ORCAMENTOS = [
  {
    id: 'orc-1', numero: 'ORC-2026-00012345', client: CONTRATO_LONGO, status: 'sent', date: '2026-11-13',
    unidade: ESCOLA_80, notes: 'Troca de compressor e recarga de gás', equip: '1500',
    items: [{ name: 'Troca de compressor rotativo 18.000 BTU/h', qty: 1, price: 2450.5, tag: '1500' }, { name: 'Recarga de gás R-410A', qty: 2, price: 380, tag: '1501' }],
    _signatures: trilha(5),
  },
  { id: 'orc-2', numero: '', client: '1020', status: 'approved', date: '2026-11-02', items: [], _signatures: [] },
];

const CONTRATOS = [
  {
    id: 'c1', numero: CONTRATO_LONGO, razao: 'Secretaria Municipal de Educação, Cultura, Esporte e Lazer de Caraíbas de Goiás',
    cnpj: '12.345.678/0001-90', responsavel: NOME_LONGO, art: 'ART-0000000000000123456789', inicio: '2026-01-01', fim: '2026-12-31', tel: '(64) 99999-0000', ativo: true,
    documentos: [{ name: 'Termo_Aditivo_062-2026_assinado_versao_final_revisada.pdf' }],
    equipamentos: Array.from({ length: 3 }, (_, i) => ({
      tag: String(1500 + i), estabelecimento: ESCOLA_80, recinto: 'SALA 0' + (i + 1),
      patrimonio: '000123456789', marca: 'Marca Internacional de Climatização Avançada', tipo: 'Split Hi-Wall Inverter', capacidade: '18000 BTU/h', area: '42 m²',
    })),
    equipCount: 3, _signatures: trilha(5),
  },
  { id: 'c2', numero: '1020', razao: 'Contrato curto', ativo: true, equipamentos: [], _signatures: [] },
];

const MOVIMENTACOES = [
  {
    id: 'mov-1', contrato: CONTRATO_LONGO, tipo: 'transferencia', status: 'pendente', criadoEm: AGORA,
    tag: '1500', numPatrimonio: '000123456789', estabelecimentoDestino: ESCOLA_80, recintoDestino: 'SALA DE INFORMÁTICA 01',
    solicitanteNome: NOME_LONGO, solicitanteEmail: 'outra@exemplo.com.br',
    motivo: 'Remanejamento para atender sala com maior número de alunos no turno vespertino', _signatures: trilha(5),
  },
  { id: 'mov-2', contrato: '1020', tipo: 'baixa', status: 'pendente', criadoEm: AGORA, tag: '', solicitanteNome: '', _signatures: [] },
];

const PREVENTIVAS = [
  {
    id: 'prev-1', client: CONTRATO_LONGO, period: '2026-11', level: 2, tech: NOME_LONGO,
    equipments: [{ tag: '1500', estabelecimento: ESCOLA_80 }, { tag: '1501', estabelecimento: ESCOLA_80 }], _signatures: trilha(5),
  },
  { id: 'prev-2', client: '1020', period: '2026-10', level: 1, tech: '', equipments: [] },
];

const LAUDOS = [
  { id: 'laudo-1', contract: CONTRATO_LONGO, unidade: ESCOLA_80, assunto: 'Equipamento irrecuperável por corrosão generalizada da serpentina e do gabinete', createdAt: AGORA },
  { id: 'laudo-2', contract: '', unidade: '', assunto: '', createdAt: AGORA },
];

const USERS = [
  {
    id: 'u1', name: NOME_LONGO, email: 'paulo.vinicius.da.silva.resende.albuquerque@exemplo-de-dominio-longo.com.br',
    role: 'supervisor', active: true, last_login: AGORA, contract: CONTRATO_LONGO,
  },
  { id: 'u2', name: '', email: 'x@y.z', role: 'tecnico', active: false },
];

const WHITELIST = [
  { email: USERS[0].email, role: 'supervisor', contract: CONTRATO_LONGO + ',1020', company: 'Empresa de Manutenção Predial e Climatização do Centro-Oeste Ltda.' },
];

const PAPEIS = ['admin', 'supervisor', 'tecnico'];

function fakeJwt(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '');
  return b64({ alg: 'none' }) + '.' + b64(payload) + '.sig';
}

function sessao(role) {
  return fakeJwt({
    id: 1, email: 'auditoria@exemplo.com.br', role, name: NOME_LONGO,
    contract: role === 'admin' ? '' : CONTRATO_LONGO + ',1020', exp: Math.floor(AGORA / 1000) + 10 * 365 * 86400,
  });
}

const COLECOES = {
  '/chamados': CHAMADOS, '/registros': REGISTROS, '/orcamentos': ORCAMENTOS, '/preventiva': PREVENTIVAS,
  '/ordens-servico': ORDENS, '/contratos': CONTRATOS, '/movimentacoes': MOVIMENTACOES, '/laudos': LAUDOS,
  '/users': USERS, '/whitelist': WHITELIST,
};

// Responde qualquer chamada à API com dados das fixtures. Rotas sem
// fixture recebem lista vazia (GET) ou sucesso vazio (escrita): a tela
// carrega, só não mostra nada naquela seção.
async function responder(route, role) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.replace(/^\/api/, '');
  const json = (data, extra) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data, ...extra }) });
  if (p === '/auth/me') return json({ role, contract: role === 'admin' ? '' : CONTRATO_LONGO + ',1020', active: true, modulosDoPlano: null, modulosPermitidos: null, name: NOME_LONGO, email: 'auditoria@exemplo.com.br' });
  if (p === '/auth/config/public') return json({});
  if (req.method() !== 'GET') return json({});
  if (COLECOES[p]) return json(COLECOES[p], { pagination: { nextOffset: null } });
  if (p.startsWith('/arquivos/')) return route.fulfill({ status: 404, body: '' });
  return json([], { pagination: { nextOffset: null } });
}

module.exports = { responder, sessao, PAPEIS, CONTRATOS, CHAMADOS, AGORA };
