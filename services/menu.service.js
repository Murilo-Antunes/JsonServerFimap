/**
 * Resumo exibido nos itens do menu lateral. As chaves são as mesmas de `config/navigation.ts`
 * no frontend; o texto é montado lá, aqui só saem números e listas.
 */
const { computeDashboard, loadUserData } = require('./dashboard.service');

function computeMenuSummary(getCollection, userId, now = new Date()) {
  const { nucleo } = computeDashboard(getCollection, userId, now);
  const data = loadUserData(getCollection, userId);

  return {
    itens: {
      cards: {
        quantidade: nucleo.cartoes.quantidade_cartoes,
        total_faturas_abertas: nucleo.cartoes.total_faturas_abertas,
        dias_para_fechamento: nucleo.cartoes.dias_para_fechamento,
      },
      accounts: {
        quantidade: data.contas.length,
        instituicoes: nucleo.contas.instituicoes,
        saldo_total: nucleo.contas.saldo_total,
      },
      investments: {
        quantidade_ativos: nucleo.carteira.quantidade_ativos,
        valor_total: nucleo.carteira.valor_total,
      },
      loans: {
        contratos_ativos: nucleo.emprestimos.contratos_ativos,
        parcela_mensal_total: nucleo.emprestimos.parcela_mensal_total,
      },
      settings: {
        conexoes_total: data.conexoes.length,
        conexoes_pendentes: data.conexoes.filter((c) => c.status !== 'ativa').length,
      },
      opportunities: {
        quantidade: getCollection('oportunidades').filter((o) => o.ativa !== false).length,
      },
    },
  };
}

module.exports = { computeMenuSummary };
