/**
 * Cálculos do dashboard (funções puras: recebem `getCollection(nome)`, o id do usuário e o "agora").
 * Todo dado financeiro pertence ao usuário via `conexoes_open_finance.usuario_id`.
 */
const { DAY_MS, parseDate, toLocalIso, dayOf, monthOf, hourOf, previousMonth, daysBetween } = require('../lib/dates');

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};
const sum = (list, pick) => list.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
const unique = (list) => [...new Set(list.filter(Boolean))];

const percentChange = (current, previous) =>
  previous > 0 ? round(((current - previous) / previous) * 100, 1) : null;

/** Carrega, já filtrado pelo usuário, tudo que o dashboard precisa. */
function loadUserData(getCollection, userId) {
  const conexoes = getCollection('conexoes_open_finance').filter((c) => c.usuario_id === userId);
  const ids = new Set(conexoes.map((c) => c.id));
  const owned = (name) => getCollection(name).filter((row) => ids.has(row.conexao_id));

  const transacoes = owned('transacoes_financeiras')
    .map((t) => {
      const date = parseDate(t.data);
      return date
        ? { ...t, valor: Number(t.valor) || 0, _date: date, _local: toLocalIso(date) }
        : null;
    })
    .filter(Boolean);

  return {
    conexoes,
    contas: owned('contas_financeiras'),
    investimentos: owned('investimentos_financeiros'),
    cartoes: owned('cartoes_financeiros'),
    faturas: owned('faturas_financeiras'),
    emprestimos: owned('emprestimos_financeiros'),
    transacoes,
    ativos: getCollection('ativos_financeiros'),
    metas: getCollection('metas').filter((m) => m.usuario_id === userId),
    historico: getCollection('patrimonio_historico').filter((h) => h.usuario_id === userId),
  };
}

function computeDashboard(getCollection, userId, now = new Date()) {
  const data = loadUserData(getCollection, userId);
  const nowLocal = toLocalIso(now);
  const today = dayOf(nowLocal);
  const currentMonth = monthOf(nowLocal);
  const lastMonth = previousMonth(currentMonth);

  const totalBy = (tipo, month) =>
    sum(
      data.transacoes.filter((t) => t.tipo === tipo && monthOf(t._local) === month),
      (t) => t.valor,
    );
  const receitaAtual = totalBy('receita', currentMonth);
  const receitaAnterior = totalBy('receita', lastMonth);
  const despesaAtual = totalBy('despesa', currentMonth);
  const despesaAnterior = totalBy('despesa', lastMonth);

  // ---- Patrimônio -------------------------------------------------------------------------
  const saldoContas = sum(data.contas, (c) => c.saldo);
  const valorInvestido = sum(data.investimentos, (i) => i.valor_atual);
  const patrimonio = saldoContas + valorInvestido;
  // Variação do mês: patrimônio atual menos o fechamento do mês anterior (`patrimonio_historico`).
  // Sem esse snapshot, usa o saldo líquido do mês (receitas - despesas) como aproximação.
  const fechamentoAnterior = data.historico.find((h) => h.mes === lastMonth);
  const variacaoMes = fechamentoAnterior
    ? patrimonio - Number(fechamentoAnterior.patrimonio)
    : receitaAtual - despesaAtual;
  const patrimonioInicioMes = patrimonio - variacaoMes;

  const conexaoAtiva = new Set(data.conexoes.filter((c) => c.status === 'ativa').map((c) => c.id));

  // ---- Cartões ----------------------------------------------------------------------------
  const faturasAbertas = data.faturas.filter((f) => f.status !== 'paga');
  const totalFaturasAbertas = sum(faturasAbertas, (f) => f.valor_total);
  const limiteTotal = sum(data.cartoes, (c) => c.limite);
  const limiteDisponivel = Math.max(0, limiteTotal - totalFaturasAbertas);

  const proximosFechamentos = faturasAbertas
    .map((f) => parseDate(f.data_fechamento))
    .filter(Boolean)
    .map((d) => daysBetween(today, dayOf(toLocalIso(d))))
    .filter((dias) => dias >= 0);

  // ---- Metas ------------------------------------------------------------------------------
  const metasAtivas = data.metas.filter((m) => m.status === 'em_andamento');
  const percentualMeta = metasAtivas.length
    ? round(sum(metasAtivas, (m) => m.percentual_progresso) / metasAtivas.length, 1)
    : null;

  // ---- Carteira ---------------------------------------------------------------------------
  const tipoPorCodigo = new Map(data.ativos.map((a) => [a.codigo, a.tipo]));
  const aplicado = sum(data.investimentos, (i) => i.valor_investido);
  const todosComAporte =
    data.investimentos.length > 0 && data.investimentos.every((i) => Number(i.valor_investido) > 0);

  // ---- Empréstimos ------------------------------------------------------------------------
  const emprestimosAtivos = data.emprestimos.filter((e) => e.status === 'ativo' || e.status === 'atrasado');
  const unico = emprestimosAtivos.length === 1 ? emprestimosAtivos[0] : null;

  return {
    resumo: {
      patrimonio: {
        total: round(patrimonio),
        variacao_mes: round(variacaoMes),
        variacao_mes_percentual:
          patrimonioInicioMes > 0 ? round((variacaoMes / patrimonioInicioMes) * 100, 1) : null,
        contas_ativas: data.contas.filter((c) => conexaoAtiva.has(c.conexao_id)).length,
      },
      receita_mensal: {
        valor: round(receitaAtual),
        variacao_percentual: percentChange(receitaAtual, receitaAnterior),
        // Quanto da receita do mês anterior já foi alcançada (máx. 100)
        progresso: receitaAnterior > 0 ? round(Math.min(100, (receitaAtual / receitaAnterior) * 100), 1) : receitaAtual > 0 ? 100 : 0,
      },
      despesas: {
        valor: round(despesaAtual),
        variacao_percentual: percentChange(despesaAtual, despesaAnterior),
        // Quanto da receita do mês já foi comprometido com despesas (máx. 100)
        progresso: receitaAtual > 0 ? round(Math.min(100, (despesaAtual / receitaAtual) * 100), 1) : despesaAtual > 0 ? 100 : 0,
      },
      limite_cartoes: {
        disponivel: round(limiteDisponivel),
        percentual_disponivel: limiteTotal > 0 ? round((limiteDisponivel / limiteTotal) * 100, 1) : 0,
      },
      investido: {
        valor: round(valorInvestido),
        percentual_meta: percentualMeta,
      },
    },

    nucleo: {
      cartoes: {
        total_faturas_abertas: round(totalFaturasAbertas),
        quantidade_cartoes: data.cartoes.length,
        dias_para_fechamento: proximosFechamentos.length ? Math.min(...proximosFechamentos) : null,
      },
      contas: {
        saldo_total: round(saldoContas),
        instituicoes: unique(data.contas.map((c) => c.instituicao_nome)),
        conexoes_total: data.conexoes.length,
        todas_sincronizadas: data.conexoes.length > 0 && data.conexoes.every((c) => c.status === 'ativa'),
      },
      carteira: {
        valor_total: round(valorInvestido),
        tipos_ativos: unique(data.investimentos.map((i) => tipoPorCodigo.get(i.ativo_codigo))),
        quantidade_ativos: data.investimentos.length,
        // Rentabilidade acumulada (valor atual x valor investido); null se faltar `valor_investido`
        rentabilidade_percentual: todosComAporte ? round(((valorInvestido - aplicado) / aplicado) * 100, 1) : null,
      },
      emprestimos: {
        parcela_mensal_total: round(sum(emprestimosAtivos, (e) => e.valor_parcela)),
        contratos_ativos: emprestimosAtivos.length,
        parcelas_pagas: unico ? Number(unico.parcelas_pagas) || 0 : null,
        parcelas_total: unico ? Number(unico.parcelas_total) || 0 : null,
        em_dia: emprestimosAtivos.every((e) => e.status !== 'atrasado'),
      },
    },

    transacoes: [...data.transacoes]
      .sort((a, b) => b._date - a._date)
      .slice(0, 5)
      .map((t) => {
        const conta = data.contas.find(
          (c) => c.conexao_id === t.conexao_id && c.id_externo === t.conta_id_externo,
        );
        return {
          id: t.id,
          descricao: t.descricao,
          data: t._date.toISOString(),
          tipo: t.tipo,
          valor: round(t.valor),
          categoria: t.categoria || 'Outros',
          conta: conta ? conta.nome : null,
        };
      }),
  };
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PERIODS = ['dia', 'semana', 'mes'];

function computeEvolution(getCollection, userId, period, now = new Date()) {
  const { transacoes } = loadUserData(getCollection, userId);
  const nowLocal = toLocalIso(now);
  const today = dayOf(nowLocal);

  let labels;
  let bucketOf; // (localIso) => índice do ponto ou -1

  if (period === 'dia') {
    // Hoje, em blocos de 4 horas
    labels = ['00h', '04h', '08h', '12h', '16h', '20h'];
    bucketOf = (local) => (dayOf(local) === today ? Math.floor(hourOf(local) / 4) : -1);
  } else if (period === 'semana') {
    // Últimos 7 dias, terminando hoje
    const days = Array.from({ length: 7 }, (_, i) =>
      dayOf(new Date(Date.parse(`${today}T12:00:00Z`) - (6 - i) * DAY_MS).toISOString()),
    );
    labels = days.map((day) => WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]);
    bucketOf = (local) => days.indexOf(dayOf(local));
  } else {
    // Mês atual, por semanas (dias 1-7, 8-14, ...)
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    labels = Array.from({ length: Math.ceil(daysInMonth / 7) }, (_, i) => `Sem ${i + 1}`);
    bucketOf = (local) =>
      monthOf(local) === monthOf(nowLocal) ? Math.floor((Number(local.slice(8, 10)) - 1) / 7) : -1;
  }

  const pontos = labels.map((label) => ({ label, receitas: 0, despesas: 0 }));
  for (const t of transacoes) {
    const index = bucketOf(t._local);
    if (index < 0 || index >= pontos.length) continue;
    if (t.tipo === 'receita') pontos[index].receitas += t.valor;
    else if (t.tipo === 'despesa') pontos[index].despesas += t.valor;
  }
  pontos.forEach((p) => {
    p.receitas = round(p.receitas);
    p.despesas = round(p.despesas);
  });

  return { periodo: period, pontos };
}


module.exports = { computeDashboard, computeEvolution, loadUserData, PERIODS };
