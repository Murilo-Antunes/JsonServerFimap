/**
 * Popula o db.json com os dados financeiros do usuário 1 no formato que o dashboard espera.
 * Substitui SOMENTE estas coleções (as demais, inclusive usuários, ficam intactas):
 *   conexoes_open_finance, contas_financeiras, ativos_financeiros, investimentos_financeiros,
 *   cartoes_financeiros, faturas_financeiras, transacoes_financeiras, emprestimos_financeiros
 * e ajusta a meta de id 1 (usuario_id + valores).
 *
 * As datas são relativas a "hoje", então o seed nunca fica velho.
 * Rode com o servidor PARADO:  node scripts/seed-dashboard.js
 */
const fs = require('fs');
const path = require('path');

const USER_ID = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

function buildSeed(now = new Date()) {
  const localDay = (date) => new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');

  /** Data/hora de Brasília `days` dias atrás (nunca no futuro). */
  const ago = (days, hour = 12, minute = 0) => {
    const day = localDay(new Date(now.getTime() - days * DAY_MS));
    const iso = `${day}T${pad(hour)}:${pad(minute)}:00-03:00`;
    return Date.parse(iso) > now.getTime() ? new Date(now.getTime() - 60 * 60 * 1000).toISOString() : iso;
  };
  const inDays = (days) => localDay(new Date(now.getTime() + days * DAY_MS));

  const conexoes = [
    { id: 1, usuario_id: USER_ID, status: 'ativa', ultima_sincronizacao: now.toISOString(), url_autorizacao: null },
    { id: 2, usuario_id: USER_ID, status: 'ativa', ultima_sincronizacao: now.toISOString(), url_autorizacao: null },
    { id: 3, usuario_id: USER_ID, status: 'ativa', ultima_sincronizacao: now.toISOString(), url_autorizacao: null },
  ];

  const contas = [
    { id: 1, id_externo: 'itau-cc-001', conexao_id: 1, instituicao_nome: 'Itaú', tipo: 'corrente', nome: 'Conta Corrente Itaú', saldo: 5120.4 },
    { id: 2, id_externo: 'itau-pp-001', conexao_id: 1, instituicao_nome: 'Itaú', tipo: 'poupanca', nome: 'Poupança Itaú', saldo: 400.0 },
    { id: 3, id_externo: 'nu-cc-001', conexao_id: 2, instituicao_nome: 'Nubank', tipo: 'corrente', nome: 'Conta Nubank', saldo: 3489.9 },
    { id: 4, id_externo: 'xp-cc-001', conexao_id: 3, instituicao_nome: 'XP', tipo: 'corrente', nome: 'Conta XP', saldo: 1100.0 },
  ];

  const ativos = [
    { id: 1, codigo: 'CDB-XP-2028', nome: 'CDB XP 110% CDI', tipo: 'renda_fixa', mercado: 'B3' },
    { id: 2, codigo: 'HGLG11', nome: 'CSHG Logística', tipo: 'fii', mercado: 'B3' },
    { id: 3, codigo: 'PETR4', nome: 'Petrobras PN', tipo: 'acao', mercado: 'B3' },
  ];

  const investimentos = [
    { id: 1, id_externo: 'inv-001', conexao_id: 3, ativo_codigo: 'CDB-XP-2028', quantidade: 1, valor_investido: 18000, valor_atual: 20000.0 },
    { id: 2, id_externo: 'inv-002', conexao_id: 3, ativo_codigo: 'HGLG11', quantidade: 50, valor_investido: 7600, valor_atual: 8120.2 },
    { id: 3, id_externo: 'inv-003', conexao_id: 3, ativo_codigo: 'PETR4', quantidade: 100, valor_investido: 7800, valor_atual: 8350.0 },
  ];

  const cartoes = [
    { id: 1, id_externo: 'itau-card-001', conexao_id: 1, nome: 'Itaú Black', final_cartao: '4821', limite: 15000 },
    { id: 2, id_externo: 'nu-card-001', conexao_id: 2, nome: 'Nubank Ultravioleta', final_cartao: '9034', limite: 12200 },
  ];

  const faturas = [
    { id: 1, id_externo: 'fat-001', conexao_id: 1, cartao_id_externo: 'itau-card-001', periodo: 'mensal', valor_total: 1340, status: 'aberta', data_fechamento: inDays(3), data_vencimento: inDays(10) },
    { id: 2, id_externo: 'fat-002', conexao_id: 2, cartao_id_externo: 'nu-card-001', periodo: 'mensal', valor_total: 1000, status: 'aberta', data_fechamento: inDays(5), data_vencimento: inDays(12) },
    { id: 3, id_externo: 'fat-000', conexao_id: 1, cartao_id_externo: 'itau-card-001', periodo: 'mensal', valor_total: 2100, status: 'paga', data_fechamento: inDays(-27), data_vencimento: inDays(-20) },
  ];

  const emprestimos = [
    { id: 1, id_externo: 'emp-001', conexao_id: 1, descricao: 'Financiamento de veículo', valor_parcela: 420, parcelas_total: 24, parcelas_pagas: 14, status: 'ativo' },
  ];

  // [dias atrás, hora, minuto, tipo, valor, descrição, categoria, conta]
  const ITAU = 'itau-cc-001';
  const NU = 'nu-cc-001';
  const rows = [
    [0, 14, 22, 'despesa', 349.0, 'Apple Store Brasil', 'Tecnologia', NU],
    [1, 19, 40, 'receita', 1850.0, 'Transferência Pix Recebida', 'Recebimento', ITAU],
    [4, 21, 15, 'despesa', 480.5, 'Restaurante Fasano', 'Gastronomia', NU],
    [2, 10, 5, 'despesa', 612.3, 'Supermercado Pão de Açúcar', 'Mercado', ITAU],
    [3, 18, 30, 'despesa', 38.4, 'Uber', 'Transporte', NU],
    [5, 9, 10, 'despesa', 87.2, 'Farmácia', 'Saúde', ITAU],
    [7, 8, 0, 'despesa', 55.9, 'Streaming', 'Assinaturas', NU],
    [8, 11, 45, 'despesa', 245.8, 'Conta de energia', 'Moradia', ITAU],
    [9, 15, 0, 'receita', 2100.0, 'Projeto freelance', 'Recebimento', ITAU],
    [10, 9, 30, 'despesa', 119.9, 'Internet', 'Moradia', ITAU],
    [12, 8, 0, 'despesa', 2100.0, 'Aluguel', 'Moradia', ITAU],
    [15, 9, 0, 'receita', 8500.0, 'Salário', 'Recebimento', ITAU],
    // mês anterior (para as comparações)
    [32, 9, 0, 'receita', 8500.0, 'Salário', 'Recebimento', ITAU],
    [36, 15, 0, 'receita', 1900.0, 'Projeto freelance', 'Recebimento', ITAU],
    [33, 8, 0, 'despesa', 2100.0, 'Aluguel', 'Moradia', ITAU],
    [35, 20, 10, 'despesa', 890.0, 'Supermercado Pão de Açúcar', 'Mercado', ITAU],
    [38, 13, 0, 'despesa', 1250.0, 'Viagem', 'Lazer', NU],
    [40, 19, 30, 'despesa', 420.0, 'Restaurante', 'Gastronomia', NU],
  ];

  const contaPorExterno = new Map(contas.map((c) => [c.id_externo, c]));
  const transacoes = rows.map(([days, hour, minute, tipo, valor, descricao, categoria, contaExterna], index) => ({
    id: index + 1,
    id_externo: `tx-${String(index + 1).padStart(3, '0')}`,
    conexao_id: contaPorExterno.get(contaExterna).conexao_id,
    conta_id_externo: contaExterna,
    tipo,
    valor,
    data: ago(days, hour, minute),
    descricao,
    categoria,
  }));

  return {
    conexoes_open_finance: conexoes,
    contas_financeiras: contas,
    ativos_financeiros: ativos,
    investimentos_financeiros: investimentos,
    cartoes_financeiros: cartoes,
    faturas_financeiras: faturas,
    emprestimos_financeiros: emprestimos,
    transacoes_financeiras: transacoes,
  };
}

function main() {
  const dbPath = path.join(__dirname, '..', 'db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

  Object.assign(db, buildSeed());

  // A meta de exemplo passa a pertencer ao usuário e ganha valores plausíveis
  const meta = (db.metas || []).find((m) => m.id === 1);
  if (meta) {
    Object.assign(meta, {
      usuario_id: USER_ID,
      valor_desejado: 10000,
      valor_total: 3500,
      percentual_progresso: 35,
      status: 'em_andamento',
    });
  }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  console.log('Seed do dashboard aplicado em db.json');
}

if (require.main === module) main();

module.exports = { buildSeed };
