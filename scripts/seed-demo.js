/**
 * Gera o db.json de demonstração (dados coerentes entre si e relativos à data de hoje).
 *
 *   npm run seed                 -> grava ./db.json (ou DB_FILE)
 *   node scripts/seed-demo.js --stdout
 *
 * Todos os usuários recebem a senha DEMO_PASSWORD (padrão "Fimap@2026"). Rode de novo quando as
 * datas ficarem "velhas": o dashboard olha o mês atual e o anterior.
 *
 * Regras de coerência:
 *  - tudo que é financeiro aponta para `conexao_id`, e a conexão aponta para `usuario_id`;
 *  - `transacoes.conta_id_externo` existe em `contas_financeiras` da mesma conexão;
 *  - `faturas.cartao_id_externo` existe em `cartoes_financeiros` da mesma conexão;
 *  - `investimentos.ativo_codigo` existe em `ativos_financeiros`;
 *  - contadores sociais (curtidas/comentários) são calculados a partir das tabelas de relação.
 */
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('../lib/security');
const { isValidCpf } = require('../lib/validators');

const NOW = process.env.SEED_NOW ? new Date(process.env.SEED_NOW) : new Date();
const PASSWORD = process.env.DEMO_PASSWORD || 'Fimap@2026';
const OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 86400000;

// ---------------------------------------------------------------- utilitários
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const money = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

const localNow = new Date(NOW.getTime() + OFFSET_MS);
const TODAY = { y: localNow.getUTCFullYear(), m: localNow.getUTCMonth() + 1, d: localNow.getUTCDate() };
const nowHour = localNow.getUTCHours();

/** Data de Brasília: ano, mês (1-12, aceita fora do intervalo), dia, hora, minuto -> ISO com -03:00 */
function at(year, month, day, hour = 12, minute = 0) {
  const base = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}T${pad(
    base.getUTCHours(),
  )}:${pad(base.getUTCMinutes())}:00-03:00`;
}
const isoToMs = (iso) => new Date(iso).getTime();
const monthShift = (offset) => {
  const index = TODAY.y * 12 + (TODAY.m - 1) + offset;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
};
const monthKey = ({ y, m }) => `${y}-${pad(m)}`;
const daysAgo = (n, hour = 12, minute = 0) => at(TODAY.y, TODAY.m, TODAY.d - n, hour, minute);
const isPast = (iso) => isoToMs(iso) <= NOW.getTime();
const dateOnly = (iso) => iso.slice(0, 10);

function makeCpf(seed) {
  const rnd = mulberry32(seed);
  const digits = Array.from({ length: 9 }, () => Math.floor(rnd() * 10));
  const check = (list) => {
    const sum = list.reduce((total, digit, i) => total + digit * (list.length + 1 - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  digits.push(check(digits));
  digits.push(check(digits));
  return digits.join('');
}

// ---------------------------------------------------------------- tabelas
const db = {};
const counters = {};
function insert(table, row) {
  db[table] = db[table] || [];
  counters[table] = (counters[table] || 0) + 1;
  const doc = { id: counters[table], ...row };
  db[table].push(doc);
  return doc;
}
const TABLES = [
  'usuarios', 'dispositivos', 'configuracoes', 'conexoes_open_finance', 'categorias_meta', 'metas',
  'simulacoes_investimentos', 'simulacoes_amortizacoes', 'notificacoes', 'posts', 'comentarios',
  'categorias_denuncia', 'denuncias', 'badges', 'badges_usuarios', 'ranking', 'chats', 'mensagens',
  'categorias_recomendacao', 'recomendacoes_ia', 'contas_financeiras', 'transacoes_financeiras',
  'investimentos_financeiros', 'ativos_financeiros', 'cartoes_financeiros', 'faturas_financeiras',
  'emprestimos_financeiros', 'patrimonio_historico', 'oportunidades', 'seguidores', 'curtidas_posts',
  'curtidas_comentarios', 'participantes_chats', 'codigos_otp', 'sessoes',
];
TABLES.forEach((t) => { db[t] = []; });

// ---------------------------------------------------------------- catálogos
const ATIVOS = [
  ['TESOURO_SELIC_2029', 'Tesouro Selic 2029', 'renda_fixa', 'Tesouro Direto'],
  ['TESOURO_IPCA_2035', 'Tesouro IPCA+ 2035', 'renda_fixa', 'Tesouro Direto'],
  ['CDB_NU_110', 'CDB Nubank 110% CDI', 'renda_fixa', 'Renda fixa privada'],
  ['CDB_ITAU_100', 'CDB Itaú 100% CDI', 'renda_fixa', 'Renda fixa privada'],
  ['LCI_XP_95', 'LCI XP 95% CDI', 'renda_fixa', 'Renda fixa privada'],
  ['PETR4', 'Petrobras PN', 'acao', 'B3'],
  ['VALE3', 'Vale ON', 'acao', 'B3'],
  ['ITUB4', 'Itaú Unibanco PN', 'acao', 'B3'],
  ['WEGE3', 'WEG ON', 'acao', 'B3'],
  ['HGLG11', 'CSHG Logística FII', 'fii', 'B3'],
  ['MXRF11', 'Maxi Renda FII', 'fii', 'B3'],
  ['IVVB11', 'iShares S&P 500', 'etf', 'B3'],
  ['BOVA11', 'iShares Ibovespa', 'etf', 'B3'],
  ['BTC', 'Bitcoin', 'cripto', 'Cripto'],
  ['ETH', 'Ethereum', 'cripto', 'Cripto'],
];
ATIVOS.forEach(([codigo, nome, tipo, mercado]) => insert('ativos_financeiros', { codigo, nome, tipo, mercado }));

['Meta de emergência', 'Viagem', 'Educação', 'Aquisição', 'Investimento', 'Quitação de dívida'].forEach((nome) =>
  insert('categorias_meta', { nome }),
);
const catMeta = (nome) => db.categorias_meta.find((c) => c.nome === nome);

['Spam', 'Golpe ou fraude', 'Conteúdo ofensivo', 'Informação enganosa', 'Outro'].forEach((nome) =>
  insert('categorias_denuncia', { nome }),
);
['Economia', 'Investimentos', 'Cartões', 'Dívidas', 'Planejamento'].forEach((nome) =>
  insert('categorias_recomendacao', { nome }),
);
const catRec = (nome) => db.categorias_recomendacao.find((c) => c.nome === nome);

[
  ['Primeiro passo', 'Concluiu o cadastro e conectou a primeira instituição.', 'rocket', 50],
  ['Poupador', 'Guardou dinheiro em 3 meses seguidos.', 'piggy-bank', 120],
  ['Meta batida', 'Concluiu uma meta financeira.', 'target', 150],
  ['Investidor', 'Diversificou a carteira em 3 tipos de ativos.', 'trending-up', 200],
  ['Sem juros', 'Pagou todas as faturas em dia por 3 meses.', 'shield-check', 180],
  ['Comunidade', 'Fez 10 interações na comunidade.', 'users', 80],
  ['Curioso', 'Conversou com o assistente 5 vezes.', 'message-circle', 60],
  ['Streak 30', 'Acessou o app por 30 dias seguidos.', 'flame', 250],
].forEach(([nome, descricao, icone, xp]) => insert('badges', { nome, descricao, icone, xp }));

[
  ['CDB com liquidez diária a 112% do CDI', 'Reserva de emergência rendendo mais que a poupança.', 'Renda fixa', true],
  ['Tesouro IPCA+ com taxa acima de 7% a.a.', 'Proteção contra a inflação para metas de longo prazo.', 'Renda fixa', true],
  ['Portabilidade de crédito pessoal', 'Taxas até 30% menores para quem paga em dia.', 'Crédito', true],
  ['Cartão sem anuidade com 1,5% de cashback', 'Para quem concentra gastos no crédito.', 'Cartões', true],
  ['FIIs de papel com dividendos mensais', 'Renda passiva com diversificação.', 'Investimentos', true],
  ['Seguro de vida a partir de R$ 19/mês', 'Proteção para a família com cobertura personalizada.', 'Seguros', true],
  ['Consórcio de imóvel sem taxa de adesão', 'Campanha encerrada.', 'Consórcio', false],
].forEach(([titulo, descricao, categoria, ativa]) => insert('oportunidades', { titulo, descricao, categoria, ativa }));

// ---------------------------------------------------------------- usuários
const USERS = [
  { nome: 'Murilo Antunes', username: 'murilo', email: 'murilo@example.com', cpf: '12345678909', uf: 'SP', xp: 320, nivel: 3,
    bio: 'Aprendendo a cuidar melhor das finanças.' },
  { nome: 'Camila Ferreira', username: 'camila.ferreira', email: 'camila.ferreira@example.com', uf: 'RJ', xp: 890, nivel: 6,
    bio: 'Planejadora financeira. Dívida zero em 2026.' },
  { nome: 'Rafael Souza', username: 'rafa.souza', email: 'rafael.souza@example.com', uf: 'MG', xp: 610, nivel: 5,
    bio: 'Foco em renda variável e dividendos.' },
  { nome: 'Beatriz Lima', username: 'bia.lima', email: 'beatriz.lima@example.com', uf: 'RS', xp: 450, nivel: 4,
    bio: 'Juntando para o primeiro apartamento.' },
  { nome: 'Lucas Martins', username: 'lucasm', email: 'lucas.martins@example.com', uf: 'PR', xp: 240, nivel: 2,
    bio: 'Começando agora, uma meta por vez.' },
  { nome: 'Fernanda Costa', username: 'fe.costa', email: 'fernanda.costa@example.com', uf: 'BA', xp: 1020, nivel: 7,
    bio: 'Educação financeira para todos.' },
  { nome: 'Gustavo Almeida', username: 'gus.almeida', email: 'gustavo.almeida@example.com', uf: 'SC', xp: 130, nivel: 1,
    bio: '' },
  { nome: 'Juliana Rocha', username: 'ju.rocha', email: 'juliana.rocha@example.com', uf: 'PE', xp: 520, nivel: 4,
    bio: 'Viajar é prioridade. Estou planejando.' },
];
USERS.forEach((u, index) => {
  const cpf = u.cpf || makeCpf(1000 + index);
  if (!isValidCpf(cpf)) throw new Error(`CPF inválido gerado para ${u.username}`);
  const user = insert('usuarios', {
    nome: u.nome,
    cpf,
    email: u.email,
    username: u.username,
    xp_usuario: u.xp,
    nivel_total: u.nivel,
    foto_perfil: null,
    nome_exibicao: u.nome.split(' ')[0],
    username_social: u.username,
    biografia_social: u.bio,
    localizacao_estado: u.uf,
    visibilidade: index === 6 ? 'privado' : 'publico',
    senha_hash: hashPassword(PASSWORD),
  });
  u.id = user.id;
  insert('configuracoes', {
    usuario_id: user.id,
    notificacao: true,
    alerta: true,
    relatorio: index % 2 === 0,
    recomendacao: true,
    topicos: index !== 4,
  });
  insert('dispositivos', {
    usuario_id: user.id,
    nome: index % 2 === 0 ? 'Chrome Windows' : 'Safari iPhone',
    tipo: index % 2 === 0 ? 'web' : 'mobile',
    identificador: `device-demo-${pad(user.id)}1`,
    data_ultimo_acesso: daysAgo(index % 4, 9, 30),
  });
  if (index === 0) {
    insert('dispositivos', {
      usuario_id: user.id,
      nome: 'Safari iPhone',
      tipo: 'mobile',
      identificador: 'device-demo-012',
      data_ultimo_acesso: daysAgo(2, 21, 10),
    });
  }
});
const publicAuthor = (u) => ({
  id: u.id,
  nome_exibicao: u.nome.split(' ')[0],
  username_social: u.username,
  foto_perfil: null,
});

// ---------------------------------------------------------------- finanças por perfil
/**
 * Perfis financeiros. `contas[].conexao` indexa `conexoes`. Os valores são em reais.
 * Murilo tem o perfil mais completo (é o usuário da demonstração).
 */
const PROFILES = [
  {
    user: 0, salario: 11500, salarioDia: 5, extra: [1200, 2400], aluguel: 2100, condominio: 450,
    conexoes: [
      { instituicao: 'Itaú', status: 'ativa' },
      { instituicao: 'Nubank', status: 'ativa' },
      { instituicao: 'XP Investimentos', status: 'ativa' },
    ],
    contas: [
      { conexao: 0, key: 'itau-cc', nome: 'Conta Corrente Itaú', tipo: 'corrente', saldo: 7842.36, principal: true },
      { conexao: 0, key: 'itau-pp', nome: 'Poupança Itaú', tipo: 'poupanca', saldo: 12400 },
      { conexao: 1, key: 'nu-cc', nome: 'Conta Nubank', tipo: 'corrente', saldo: 2315.9 },
      { conexao: 2, key: 'xp-cc', nome: 'Conta XP', tipo: 'investimento', saldo: 1250 },
    ],
    cartoes: [
      { conexao: 0, key: 'itau-visa', nome: 'Itaú Visa Gold', final: '4821', limite: 12000, fecha: 28, gasto: 3480.55 },
      { conexao: 1, key: 'nu-master', nome: 'Nubank Mastercard', final: '7305', limite: 8000, fecha: 10, gasto: 1846.72 },
    ],
    invest: [
      { conexao: 2, ativo: 'TESOURO_SELIC_2029', qtd: 1.25, investido: 15000, atual: 15980.4 },
      { conexao: 1, ativo: 'CDB_NU_110', qtd: 1, investido: 8000, atual: 8420.15 },
      { conexao: 2, ativo: 'PETR4', qtd: 100, investido: 3400, atual: 3690 },
      { conexao: 2, ativo: 'HGLG11', qtd: 20, investido: 3200, atual: 3310.6 },
      { conexao: 2, ativo: 'IVVB11', qtd: 14, investido: 4000, atual: 4270.8 },
      { conexao: 2, ativo: 'BTC', qtd: 0.012, investido: 1500, atual: 1731.25 },
    ],
    emprestimos: [
      { conexao: 0, nome: 'Crédito pessoal Itaú', contratado: 12000, parcela: 689.5, total: 24, pagas: 9, taxa: 1.89 },
    ],
  },
  {
    user: 1, salario: 11200, salarioDia: 5, extra: [800, 1800], aluguel: 2600, condominio: 520,
    conexoes: [{ instituicao: 'Banco do Brasil', status: 'ativa' }, { instituicao: 'Inter', status: 'ativa' }],
    contas: [
      { conexao: 0, key: 'bb-cc', nome: 'Conta Corrente BB', tipo: 'corrente', saldo: 9120.4, principal: true },
      { conexao: 1, key: 'inter-cc', nome: 'Conta Inter', tipo: 'corrente', saldo: 4310.75 },
    ],
    cartoes: [{ conexao: 0, key: 'bb-elo', nome: 'BB Ourocard', final: '1190', limite: 15000, fecha: 20, gasto: 2975.1 }],
    invest: [
      { conexao: 1, ativo: 'TESOURO_IPCA_2035', qtd: 3, investido: 20000, atual: 22150 },
      { conexao: 1, ativo: 'LCI_XP_95', qtd: 1, investido: 12000, atual: 12620 },
      { conexao: 1, ativo: 'MXRF11', qtd: 400, investido: 4000, atual: 4120 },
    ],
    emprestimos: [],
  },
  {
    user: 2, salario: 9300, salarioDia: 7, extra: [0, 0], aluguel: 1800, condominio: 380,
    conexoes: [{ instituicao: 'XP Investimentos', status: 'ativa' }, { instituicao: 'Itaú', status: 'ativa' }],
    contas: [
      { conexao: 1, key: 'itau-cc', nome: 'Conta Corrente Itaú', tipo: 'corrente', saldo: 5240.1, principal: true },
      { conexao: 0, key: 'xp-cc', nome: 'Conta XP', tipo: 'investimento', saldo: 3900 },
    ],
    cartoes: [{ conexao: 1, key: 'itau-mc', nome: 'Itaú Mastercard Black', final: '9932', limite: 20000, fecha: 15, gasto: 5210.9 }],
    invest: [
      { conexao: 0, ativo: 'ITUB4', qtd: 300, investido: 9000, atual: 10230 },
      { conexao: 0, ativo: 'WEGE3', qtd: 150, investido: 5400, atual: 5010 },
      { conexao: 0, ativo: 'VALE3', qtd: 120, investido: 7200, atual: 7440 },
      { conexao: 0, ativo: 'BOVA11', qtd: 60, investido: 6500, atual: 6890 },
    ],
    emprestimos: [{ conexao: 1, nome: 'Financiamento de veículo', contratado: 38000, parcela: 1240.8, total: 48, pagas: 22, taxa: 1.35 }],
  },
  {
    user: 3, salario: 6400, salarioDia: 5, extra: [400, 900], aluguel: 1500, condominio: 300,
    conexoes: [{ instituicao: 'Nubank', status: 'ativa' }],
    contas: [{ conexao: 0, key: 'nu-cc', nome: 'Conta Nubank', tipo: 'corrente', saldo: 3880.25, principal: true }],
    cartoes: [{ conexao: 0, key: 'nu-master', nome: 'Nubank Mastercard', final: '2204', limite: 6000, fecha: 12, gasto: 1320.4 }],
    invest: [
      { conexao: 0, ativo: 'CDB_NU_110', qtd: 1, investido: 9000, atual: 9560.3 },
      { conexao: 0, ativo: 'MXRF11', qtd: 250, investido: 2500, atual: 2570 },
    ],
    emprestimos: [],
  },
  {
    user: 4, salario: 3900, salarioDia: 5, extra: [0, 0], aluguel: 1100, condominio: 0,
    conexoes: [{ instituicao: 'Caixa', status: 'pendente' }],
    contas: [], cartoes: [], invest: [], emprestimos: [],
  },
  {
    user: 5, salario: 7800, salarioDia: 6, extra: [600, 1500], aluguel: 1900, condominio: 410,
    conexoes: [{ instituicao: 'Santander', status: 'ativa' }],
    contas: [{ conexao: 0, key: 'san-cc', nome: 'Conta Corrente Santander', tipo: 'corrente', saldo: 6420.8, principal: true }],
    cartoes: [{ conexao: 0, key: 'san-visa', nome: 'Santander Visa Platinum', final: '5517', limite: 10000, fecha: 25, gasto: 2210.35 }],
    invest: [{ conexao: 0, ativo: 'CDB_ITAU_100', qtd: 1, investido: 14000, atual: 14890 }],
    emprestimos: [],
  },
  {
    user: 6, salario: 2900, salarioDia: 10, extra: [0, 0], aluguel: 800, condominio: 0,
    conexoes: [{ instituicao: 'Nubank', status: 'erro' }],
    contas: [{ conexao: 0, key: 'nu-cc', nome: 'Conta Nubank', tipo: 'corrente', saldo: 640.2, principal: true }],
    cartoes: [], invest: [],
    emprestimos: [{ conexao: 0, nome: 'Empréstimo consignado', contratado: 4000, parcela: 245.9, total: 24, pagas: 20, taxa: 1.6, atrasado: true }],
  },
  {
    user: 7, salario: 8800, salarioDia: 5, extra: [1000, 2000], aluguel: 2200, condominio: 480,
    conexoes: [{ instituicao: 'Itaú', status: 'ativa' }, { instituicao: 'Nubank', status: 'ativa' }],
    contas: [
      { conexao: 0, key: 'itau-cc', nome: 'Conta Corrente Itaú', tipo: 'corrente', saldo: 8105.55, principal: true },
      { conexao: 1, key: 'nu-cc', nome: 'Conta Nubank', tipo: 'corrente', saldo: 1990.4 },
    ],
    cartoes: [{ conexao: 1, key: 'nu-master', nome: 'Nubank Mastercard', final: '6611', limite: 9000, fecha: 8, gasto: 2480.9 }],
    invest: [
      { conexao: 1, ativo: 'CDB_NU_110', qtd: 1, investido: 11000, atual: 11630.5 },
      { conexao: 0, ativo: 'ETH', qtd: 0.9, investido: 6000, atual: 6840 },
    ],
    emprestimos: [],
  },
];

const VARIAVEIS = [
  ['Supermercado', 'Compra no Pão de Açúcar', [140, 420]],
  ['Supermercado', 'Compra no Carrefour', [90, 380]],
  ['Alimentação', 'iFood', [32, 89]],
  ['Alimentação', 'Restaurante', [48, 140]],
  ['Transporte', 'Uber', [14, 58]],
  ['Transporte', 'Posto de combustível', [120, 260]],
  ['Saúde', 'Farmácia', [22, 160]],
  ['Lazer', 'Cinema', [38, 96]],
  ['Compras', 'Compra online', [60, 340]],
];
const FIXAS = [
  ['Moradia', 'Energia elétrica', 6, [150, 230]],
  ['Moradia', 'Internet', 12, [119.9, 119.9]],
  ['Saúde', 'Academia', 6, [129, 129]],
  ['Lazer', 'Netflix', 15, [55.9, 55.9]],
  ['Lazer', 'Spotify', 16, [21.9, 21.9]],
];

function buildFinance(profile, seedBase) {
  const user = USERS[profile.user];
  const rnd = mulberry32(seedBase + profile.user);
  const between = ([lo, hi]) => money(lo + rnd() * (hi - lo));
  const conexoes = profile.conexoes.map((c, i) =>
    insert('conexoes_open_finance', {
      usuario_id: user.id,
      instituicao_nome: c.instituicao,
      status: c.status,
      ultima_sincronizacao: c.status === 'ativa' ? daysAgo(0, Math.max(0, nowHour - 1), 5 + i) : daysAgo(c.status === 'erro' ? 6 : 1, 10, 0),
      url_autorizacao: `https://openfinance.example.com/autorizar/${user.username}-${i + 1}`,
    }),
  );

  const contas = profile.contas.map((c) => {
    const conexao = conexoes[c.conexao];
    return {
      ...insert('contas_financeiras', {
        id_externo: `${conexao.id}-${c.key}`,
        conexao_id: conexao.id,
        instituicao_nome: profile.conexoes[c.conexao].instituicao,
        tipo: c.tipo,
        nome: c.nome,
        saldo: c.saldo,
      }),
      principal: Boolean(c.principal),
    };
  });
  const principal = contas.find((c) => c.principal);

  // Transações (somente contas ativas): últimos 3 meses, até hoje
  if (principal) {
    const emit = (conta, tipo, valor, data, descricao, categoria) => {
      if (!isPast(data)) return;
      const seq = (db.transacoes_financeiras.length + 1);
      insert('transacoes_financeiras', {
        id_externo: `tx-${seq}`,
        conexao_id: conta.conexao_id,
        conta_id_externo: conta.id_externo,
        tipo,
        valor: money(valor),
        data,
        descricao,
        categoria,
      });
    };

    for (let back = 2; back >= 0; back -= 1) {
      const { y, m } = monthShift(-back);
      emit(principal, 'receita', profile.salario, at(y, m, profile.salarioDia, 8, 0), 'Salário', 'Salário');
      if (profile.extra[1] > 0) {
        emit(principal, 'receita', between(profile.extra), at(y, m, 18, 15, 30), 'Projeto freelance', 'Renda extra');
      }
      emit(principal, 'despesa', profile.aluguel, at(y, m, 7, 10, 0), 'Aluguel', 'Moradia');
      if (profile.condominio) emit(principal, 'despesa', profile.condominio, at(y, m, 8, 10, 0), 'Condomínio', 'Moradia');
      FIXAS.forEach(([cat, desc, day, range]) => emit(principal, 'despesa', between(range), at(y, m, day, 9, 0), desc, cat));

      // Variáveis: 9 por mês em dias espalhados
      for (let i = 0; i < 9; i += 1) {
        const [cat, desc, range] = VARIAVEIS[Math.floor(rnd() * VARIAVEIS.length)];
        const day = 1 + Math.floor(rnd() * 27);
        emit(principal, 'despesa', between(range), at(y, m, day, 11 + Math.floor(rnd() * 9), Math.floor(rnd() * 60)), desc, cat);
      }
      // Rendimentos da poupança/investimentos
      if (profile.invest.length) {
        emit(principal, 'receita', between([48, 140]), at(y, m, 1, 6, 0), 'Rendimentos', 'Investimentos');
      }
    }
    // Movimento de hoje (para o gráfico de "dia"): só quando o horário já passou
    emit(principal, 'despesa', between([18, 36]), daysAgo(0, 8, 10), 'Padaria', 'Alimentação');
    emit(principal, 'despesa', between([42, 75]), daysAgo(0, 12, 40), 'Almoço', 'Alimentação');
  }

  // Cartões e faturas (3 ciclos: dois anteriores e o atual)
  const cartoes = profile.cartoes.map((c) => {
    const conexao = conexoes[c.conexao];
    const card = insert('cartoes_financeiros', {
      id_externo: `${conexao.id}-${c.key}`,
      conexao_id: conexao.id,
      nome: c.nome,
      final_cartao: c.final,
      limite: c.limite,
    });
    // Próximo fechamento (hoje ou depois)
    let next = monthShift(0);
    if (TODAY.d > c.fecha) next = monthShift(1);
    for (let k = -2; k <= 0; k += 1) {
      const cycle = (() => {
        const index = next.y * 12 + (next.m - 1) + k;
        return { y: Math.floor(index / 12), m: (index % 12) + 1 };
      })();
      const fechamento = at(cycle.y, cycle.m, c.fecha, 23, 59);
      const vencimento = at(cycle.y, cycle.m, c.fecha + 7, 23, 59);
      let status = 'aberta';
      if (isoToMs(fechamento) <= NOW.getTime()) status = isoToMs(vencimento) <= NOW.getTime() ? 'paga' : 'fechada';
      const valor = k === 0 ? c.gasto : money(c.gasto * (0.82 + rnd() * 0.3));
      insert('faturas_financeiras', {
        id_externo: `fat-${card.id_externo}-${monthKey(cycle)}`,
        conexao_id: conexao.id,
        cartao_id_externo: card.id_externo,
        periodo: monthKey(cycle),
        valor_total: valor,
        status,
        data_fechamento: dateOnly(fechamento),
        data_vencimento: dateOnly(vencimento),
      });
      // Fatura paga vira despesa na conta principal
      if (status === 'paga' && principal && isPast(vencimento)) {
        const seq = db.transacoes_financeiras.length + 1;
        insert('transacoes_financeiras', {
          id_externo: `tx-${seq}`,
          conexao_id: principal.conexao_id,
          conta_id_externo: principal.id_externo,
          tipo: 'despesa',
          valor: valor,
          data: at(cycle.y, cycle.m, c.fecha + 7, 9, 0),
          descricao: `Pagamento fatura ${c.nome}`,
          categoria: 'Cartão de crédito',
        });
      }
    }
    return card;
  });
  void cartoes;

  profile.invest.forEach((i) => {
    const conexao = conexoes[i.conexao];
    insert('investimentos_financeiros', {
      id_externo: `inv-${conexao.id}-${i.ativo.toLowerCase()}`,
      conexao_id: conexao.id,
      ativo_codigo: i.ativo,
      quantidade: i.qtd,
      valor_investido: i.investido,
      valor_atual: i.atual,
    });
  });

  profile.emprestimos.forEach((e, n) => {
    const conexao = conexoes[e.conexao];
    const proxima = monthShift(TODAY.d > 15 ? 1 : 0);
    insert('emprestimos_financeiros', {
      id_externo: `emp-${conexao.id}-${n + 1}`,
      conexao_id: conexao.id,
      nome: e.nome,
      valor_contratado: e.contratado,
      valor_parcela: e.parcela,
      parcelas_total: e.total,
      parcelas_pagas: e.pagas,
      taxa_mensal: e.taxa,
      saldo_devedor: money(e.parcela * (e.total - e.pagas)),
      data_proxima_parcela: e.atrasado ? daysAgo(12, 0, 0).slice(0, 10) : at(proxima.y, proxima.m, 15, 0, 0).slice(0, 10),
      status: e.atrasado ? 'atrasado' : 'ativo',
    });
  });

  // Histórico de patrimônio (fechamento de cada mês, 12 meses)
  const patrimonioAtual =
    profile.contas.reduce((t, c) => t + c.saldo, 0) + profile.invest.reduce((t, i) => t + i.atual, 0);
  if (patrimonioAtual > 0) {
    for (let back = 1; back <= 12; back += 1) {
      const wobble = 1 + (rnd() - 0.5) * 0.012;
      insert('patrimonio_historico', {
        usuario_id: user.id,
        mes: monthKey(monthShift(-back)),
        patrimonio: money((patrimonioAtual / (1 + 0.021 * back)) * wobble),
      });
    }
  }
}
PROFILES.forEach((p) => buildFinance(p, 77));

// ---------------------------------------------------------------- metas
const metaRow = (userIdx, nome, descricao, categoria, inicio, desejado, atual, alvoMeses, status = 'em_andamento') => {
  const progress = desejado > inicio ? Math.min(100, Math.round(((atual - inicio) / (desejado - inicio)) * 100)) : 0;
  const alvo = monthShift(alvoMeses);
  const cat = catMeta(categoria);
  insert('metas', {
    usuario_id: USERS[userIdx].id,
    nome,
    descricao,
    valor_inicio: inicio,
    valor_desejado: desejado,
    valor_total: atual,
    data_alvo: at(alvo.y, alvo.m, 28, 12, 0),
    categoria_id: cat.id,
    status: status === 'concluida' ? 'concluida' : status,
    categoria: { id: cat.id, nome: cat.nome },
    percentual_progresso: status === 'concluida' ? 100 : progress,
  });
};
metaRow(0, 'Reserva de emergência', '6 meses de despesas guardados', 'Meta de emergência', 0, 30000, 18600, 8);
metaRow(0, 'Viagem para a Europa', 'Lisboa, Paris e Roma em julho', 'Viagem', 0, 15000, 6300, 9);
metaRow(0, 'Notebook novo', 'Para trabalhar com mais folga', 'Aquisição', 0, 8000, 5200, 3);
metaRow(0, 'Curso de inglês', 'Intensivo de 6 meses', 'Educação', 0, 4800, 4800, -1, 'concluida');
metaRow(1, 'Quitar financiamento', 'Antecipar parcelas', 'Quitação de dívida', 0, 20000, 11800, 10);
metaRow(1, 'Reserva de emergência', 'Meta de 8 meses', 'Meta de emergência', 0, 45000, 36000, 5);
metaRow(2, 'Carteira de dividendos', 'Renda passiva de R$ 1.500/mês', 'Investimento', 0, 120000, 38400, 30);
metaRow(3, 'Entrada do apartamento', '20% de um imóvel de R$ 350 mil', 'Aquisição', 0, 70000, 21500, 24);
metaRow(4, 'Primeiros R$ 5 mil', 'Começar a reserva', 'Meta de emergência', 0, 5000, 900, 10);
metaRow(5, 'Pós-graduação', 'MBA em finanças', 'Educação', 0, 28000, 14200, 14);
metaRow(7, 'Viagem ao Japão', 'Abril do ano que vem', 'Viagem', 0, 22000, 9800, 6);

// ---------------------------------------------------------------- simulações
const murilo = USERS[0];
insert('simulacoes_investimentos', {
  usuario_id: murilo.id, nome: 'Reserva em CDB 110%', descricao: 'Aportes mensais de R$ 1.500 por 24 meses',
  valor_inicial: 18600, aporte_mensal: 1500, prazo: 24, rentabilidade: 11.2, data_criacao: daysAgo(12, 20, 15),
});
insert('simulacoes_investimentos', {
  usuario_id: murilo.id, nome: 'Aposentadoria 2045', descricao: 'Carteira diversificada, longo prazo',
  valor_inicial: 36000, aporte_mensal: 1200, prazo: 228, rentabilidade: 9.5, data_criacao: daysAgo(40, 19, 0),
});
insert('simulacoes_amortizacoes', {
  usuario_id: murilo.id, nome: 'Antecipar crédito pessoal', descricao: 'Aporte extra de R$ 500 por mês',
  saldo_devedor: 10342.5, prazo: 15, taxa: 1.89, sistema_calculo: 'PRICE', aporte_mensal: 500, modalidade: 'reduzir_prazo',
  data_criacao: daysAgo(7, 21, 40),
});
insert('simulacoes_amortizacoes', {
  usuario_id: USERS[2].id, nome: 'Financiamento do carro', descricao: 'Comparando SAC e PRICE',
  saldo_devedor: 32260.8, prazo: 26, taxa: 1.35, sistema_calculo: 'SAC', aporte_mensal: 800, modalidade: 'reduzir_parcela',
  data_criacao: daysAgo(15, 10, 5),
});

// ---------------------------------------------------------------- notificações
[
  [0, 'credit-card', 'Fatura próxima do fechamento', 'A fatura do Itaú Visa Gold fecha em poucos dias.', 0, 8, false],
  [0, 'target', 'Meta quase lá', 'Você está a 65% de comprar o notebook novo.', 1, 10, false],
  [0, 'trending-up', 'Sua carteira cresceu', 'Seus investimentos valorizaram 3,2% nos últimos 30 dias.', 2, 9, false],
  [0, 'lightbulb', 'Nova recomendação', 'Existe um CDB com liquidez diária pagando mais que a sua reserva.', 3, 14, true],
  [0, 'trophy', 'Nova conquista', 'Você ganhou o badge "Meta batida".', 6, 16, true],
  [0, 'refresh-cw', 'Contas sincronizadas', 'Itaú, Nubank e XP foram atualizados.', 8, 7, true],
  [0, 'alert-triangle', 'Gasto acima da média', 'Alimentação ficou 22% acima da média dos últimos 3 meses.', 11, 18, true],
  [1, 'target', 'Meta atualizada', 'Você alcançou 59% da meta "Quitar financiamento".', 1, 12, false],
  [2, 'trending-up', 'Dividendos recebidos', 'Você recebeu R$ 214,30 em proventos.', 2, 11, false],
  [3, 'link', 'Conexão pendente', 'Conclua a autorização com a Caixa para sincronizar suas contas.', 1, 9, false],
].forEach(([u, icone, nome, conteudo, dias, hora, lida]) =>
  insert('notificacoes', {
    usuario_id: USERS[u].id, icone, nome, conteudo, data_criacao: daysAgo(dias, hora, 0), lida,
  }),
);

// ---------------------------------------------------------------- social
const U = USERS;
[
  [1, 'Fechei o mês no azul pela primeira vez em 2026 depois de separar uma "conta dos gastos fixos". Recomendo!', 1, 'publicado'],
  [2, 'Dica rápida: automatize o aporte no dia em que o salário cai. O que não passa pela conta, não é gasto.', 2, 'publicado'],
  [0, 'Alguém aqui usa a regra 50/30/20? Estou testando há dois meses e queria comparar resultados.', 3, 'publicado'],
  [5, 'Resumo do meu aprendizado com renda fixa: liquidez, prazo e risco do emissor andam sempre juntos.', 4, 'publicado'],
  [3, 'Comparei três simulações de financiamento e a diferença de juros total passou de R$ 9 mil.', 5, 'publicado'],
  [7, 'Meta da viagem em 45%! Cada aporte pequeno conta.', 6, 'publicado'],
  [4, 'Comecei hoje. Primeira meta: juntar R$ 5 mil. Dicas são bem-vindas.', 7, 'publicado'],
  [2, 'Cuidado com "oportunidades" que prometem retorno garantido muito acima do CDI.', 9, 'publicado'],
  [6, 'Post removido pelo autor.', 12, 'removido'],
].forEach(([author, conteudo, dias, status]) =>
  insert('posts', {
    autor: publicAuthor(U[author]),
    conteudo,
    data_criacao: daysAgo(dias, 9 + (dias % 8), 15),
    data_atualizacao: daysAgo(dias, 9 + (dias % 8), 15),
    status,
    total_curtidas: 0,
    total_comentarios: 0,
    curtido_pelo_usuario: false,
  }),
);

const COMMENTS = [
  [1, 0, null, 'Parabéns! Qual percentual você deixa para os fixos?', 1],
  [1, 2, 1, 'Uns 55%, mas depende do mês.', 1],
  [2, 2, null, 'Automatizar mudou meu jogo também.', 2],
  [3, 1, null, 'Estou na 50/30/20 há 6 meses, vale muito a pena.', 2],
  [3, 5, null, 'Dá certo se você ajustar os 30% conforme a fase da vida.', 2],
  [3, 0, 5, 'Boa, vou ajustar o meu então. Obrigado!', 1],
  [4, 7, null, 'Ótimo resumo, salvei.', 3],
  [5, 2, null, 'Qual simulador você usou? Quero comparar também.', 4],
  [6, 3, null, 'Vai chegar lá! Já passei por essa fase.', 5],
  [8, 4, null, 'Concordo, retorno garantido alto é sinal de alerta.', 8],
];
COMMENTS.forEach(([postId, author, parent, mensagem, dias]) =>
  insert('comentarios', {
    post_id: postId,
    autor: publicAuthor(U[author]),
    comentario_pai_id: parent,
    mensagem,
    data_criacao: daysAgo(dias, 14, 20 + postId),
    total_curtidas: 0,
    curtido_pelo_usuario: false,
    total_respostas: 0,
  }),
);

// Curtidas e seguidores (relações)
const postLikes = [[1, 1], [1, 2], [1, 3], [2, 1], [2, 4], [2, 6], [2, 8], [3, 2], [3, 6], [4, 1], [4, 2], [4, 3], [4, 7], [5, 1], [6, 1], [6, 2], [7, 2], [7, 6], [7, 1], [8, 1], [8, 3], [8, 4]];
postLikes.forEach(([userIdx, postId]) =>
  insert('curtidas_posts', { usuario_id: U[userIdx - 1].id, post_id: postId, data_criacao: daysAgo(1, 10 + (postId % 10), 5) }),
);
const commentLikes = [[1, 1], [2, 1], [3, 4], [1, 4], [3, 5], [1, 5], [2, 6], [1, 8], [4, 9]];
commentLikes.forEach(([userIdx, commentId]) =>
  insert('curtidas_comentarios', { usuario_id: U[userIdx - 1].id, comentario_id: commentId, data_criacao: daysAgo(1, 11, commentId) }),
);
[[1, 2], [1, 3], [1, 6], [2, 1], [2, 6], [3, 1], [4, 1], [4, 2], [5, 1], [5, 6], [6, 1], [6, 2], [6, 3], [7, 1], [8, 1], [8, 6]].forEach(([a, b], i) =>
  insert('seguidores', { seguidor_id: a, seguido_id: b, data_criacao: daysAgo(30 + i, 10, 0) }),
);

// Contadores derivados (visão do usuário 1, o da demonstração)
const VIEWER = U[0].id;
db.posts.forEach((post) => {
  const likes = db.curtidas_posts.filter((l) => l.post_id === post.id);
  post.total_curtidas = likes.length;
  post.total_comentarios = db.comentarios.filter((c) => c.post_id === post.id).length;
  post.curtido_pelo_usuario = likes.some((l) => l.usuario_id === VIEWER);
});
db.comentarios.forEach((comment) => {
  const likes = db.curtidas_comentarios.filter((l) => l.comentario_id === comment.id);
  comment.total_curtidas = likes.length;
  comment.curtido_pelo_usuario = likes.some((l) => l.usuario_id === VIEWER);
  comment.total_respostas = db.comentarios.filter((c) => c.comentario_pai_id === comment.id).length;
});

// Denúncias
insert('denuncias', { usuario_id: U[1].id, post_id: 8, titulo: 'Conteúdo suspeito', descricao: 'Parece promover retorno garantido.', categoria_id: 2, data_criacao: daysAgo(8, 16, 0) });
insert('denuncias', { usuario_id: U[3].id, post_id: 9, titulo: 'Spam', descricao: 'Post repetido várias vezes.', categoria_id: 1, data_criacao: daysAgo(11, 9, 30) });

// Badges e ranking
[[0, [1, 3, 6]], [1, [1, 2, 3, 4, 5, 6]], [2, [1, 4, 6]], [3, [1, 3]], [4, [1]], [5, [1, 2, 3, 4, 5, 6, 7, 8]], [6, [1]], [7, [1, 2, 3]]].forEach(([userIdx, badgeIds]) =>
  badgeIds.forEach((badgeId, i) => {
    const badge = db.badges.find((b) => b.id === badgeId);
    insert('badges_usuarios', { usuario_id: U[userIdx].id, badge, data_conquista: daysAgo(10 + i * 9 + userIdx, 12, 0) });
  }),
);
[...USERS]
  .sort((a, b) => b.xp - a.xp)
  .forEach((u, i) => insert('ranking', { posicao: i + 1, pontos_total: u.xp, usuario: publicAuthor(u) }));

// Chats do assistente
const chat1 = insert('chats', { usuario_id: murilo.id, nome: 'Como organizar minhas finanças', data_criacao: daysAgo(6, 20, 0) });
const chat2 = insert('chats', { usuario_id: murilo.id, nome: 'Vale a pena antecipar o empréstimo?', data_criacao: daysAgo(2, 21, 30) });
const chat3 = insert('chats', { usuario_id: U[1].id, nome: 'Planejando a reserva de emergência', data_criacao: daysAgo(3, 19, 0) });
[[chat1, murilo], [chat2, murilo], [chat3, U[1]]].forEach(([chat, user]) =>
  insert('participantes_chats', { usuario_id: user.id, chat_id: chat.id }),
);
[
  [chat1, 'usuario', 'Como posso organizar minhas finanças?', 6, 20, 0],
  [chat1, 'assistente', 'Um bom começo é separar suas despesas em fixas, variáveis e metas. Pelo que vejo, suas fixas somam cerca de 40% da renda; há espaço para aumentar os aportes.', 6, 20, 1],
  [chat1, 'usuario', 'E quanto deveria guardar por mês?', 6, 20, 3],
  [chat1, 'assistente', 'Uma referência é guardar de 15% a 20% da renda. Com a sua renda atual, isso fica entre R$ 1.500 e R$ 2.000 por mês.', 6, 20, 4],
  [chat2, 'usuario', 'Vale a pena antecipar as parcelas do crédito pessoal?', 2, 21, 30],
  [chat2, 'assistente', 'A taxa do contrato (1,89% a.m.) é maior que o rendimento da sua reserva. Antecipar costuma compensar, desde que você mantenha a reserva de emergência.', 2, 21, 31],
  [chat3, 'usuario', 'Quantos meses de reserva é ideal?', 3, 19, 0],
  [chat3, 'assistente', 'De 6 a 12 meses de despesas, conforme a estabilidade da renda.', 3, 19, 1],
].forEach(([chat, papel, conteudo, d, h, m]) =>
  insert('mensagens', { chat_id: chat.id, papel, conteudo, data_envio: daysAgo(d, h, m) }),
);

// Recomendações de IA (usuário 1)
[
  ['Antecipe parcelas do crédito pessoal', 'Sua taxa (1,89% a.m.) supera o rendimento da reserva. Antecipar pode economizar cerca de R$ 1.100 em juros.', 'alto', 'Dívidas', 'pendente', 1],
  ['Reduza gastos com delivery', 'Alimentação fora de casa cresceu nos últimos 2 meses. Um teto semanal pode liberar R$ 300 por mês.', 'medio', 'Economia', 'pendente', 2],
  ['Aumente o aporte na reserva', 'Com R$ 1.800 por mês você conclui a reserva de emergência 3 meses antes.', 'alto', 'Planejamento', 'pendente', 3],
  ['Diversifique em renda fixa indexada', 'Sua carteira concentra 62% em renda fixa pós-fixada. Considere uma parte em títulos IPCA+.', 'medio', 'Investimentos', 'aceita', 9],
  ['Pague a fatura integral', 'Você tem pago a fatura integral. Continue assim para evitar juros do rotativo.', 'baixo', 'Cartões', 'ignorada', 14],
].forEach(([titulo, descricao, impacto, cat, status, dias]) => {
  const category = catRec(cat);
  insert('recomendacoes_ia', {
    usuario_id: murilo.id, titulo, descricao, impacto, data_criacao: daysAgo(dias, 8, 0), status,
    categoria: { id: category.id, nome: category.nome },
  });
});

// ---------------------------------------------------------------- saída
const order = [...TABLES];
const output = {};
order.forEach((t) => { output[t] = db[t]; });

// Verificações de integridade (falham o seed se algo ficar inconsistente)
(function verify() {
  const ids = (t) => new Set(db[t].map((r) => r.id));
  const conexaoIds = ids('conexoes_open_finance');
  const check = (cond, msg) => { if (!cond) throw new Error(`Integridade: ${msg}`); };
  ['contas_financeiras', 'transacoes_financeiras', 'investimentos_financeiros', 'cartoes_financeiros', 'faturas_financeiras', 'emprestimos_financeiros']
    .forEach((t) => db[t].forEach((r) => check(conexaoIds.has(r.conexao_id), `${t}#${r.id} sem conexão`)));
  db.transacoes_financeiras.forEach((t) =>
    check(db.contas_financeiras.some((c) => c.conexao_id === t.conexao_id && c.id_externo === t.conta_id_externo), `transação ${t.id} sem conta`));
  db.faturas_financeiras.forEach((f) =>
    check(db.cartoes_financeiros.some((c) => c.conexao_id === f.conexao_id && c.id_externo === f.cartao_id_externo), `fatura ${f.id} sem cartão`));
  const ativoCodes = new Set(db.ativos_financeiros.map((a) => a.codigo));
  db.investimentos_financeiros.forEach((i) => check(ativoCodes.has(i.ativo_codigo), `investimento ${i.id} sem ativo`));
  db.comentarios.forEach((c) => check(ids('posts').has(c.post_id), `comentário ${c.id} sem post`));
})();

const json = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes('--stdout')) {
  process.stdout.write(json);
} else {
  const file = path.resolve(process.env.DB_FILE || path.join(__dirname, '..', 'db.json'));
  fs.writeFileSync(file, json);
  const counts = Object.entries(output).map(([k, v]) => `${k}:${v.length}`).join('  ');
  console.log(`db.json gerado em ${file}\n${counts}\nSenha de todos os usuários: ${PASSWORD}`);
}
