/**
 * Acesso às coleções cruas do json-server, montado em /db/* (somente desenvolvimento por padrão).
 *
 * O contrato do app são as rotas de domínio (/auth, /dashboard, /menu, ...). Estas rotas genéricas
 * existem só para inspecionar/explorar dados e seguem uma lista de permissão:
 *
 *  - CATALOGS:           dados públicos do sistema (leitura)
 *  - OWNED_BY_USER:      registros com `usuario_id`; o servidor impõe o dono
 *  - OWNED_BY_CONNECTION: dados do Open Finance; o dono é o `usuario_id` da conexão (somente leitura)
 *  - qualquer outra coisa (usuarios, sessoes, codigos_otp, e o próprio "/db" que despejaria o banco
 *    inteiro) responde 404.
 */
const { sendError } = require('./errors');

const CATALOGS = [
  'ativos_financeiros',
  'categorias_meta',
  'categorias_denuncia',
  'categorias_recomendacao',
  'badges',
  'oportunidades',
];
const OWNED_BY_USER = [
  'conexoes_open_finance',
  'metas',
  'notificacoes',
  'simulacoes_investimentos',
  'simulacoes_amortizacoes',
  'patrimonio_historico',
  'recomendacoes_ia',
  'chats',
  'dispositivos',
  'badges_usuarios',
];
const OWNED_BY_CONNECTION = [
  'contas_financeiras',
  'transacoes_financeiras',
  'investimentos_financeiros',
  'cartoes_financeiros',
  'faturas_financeiras',
  'emprestimos_financeiros',
];

function createRawDbGuard(store) {
  const connectionIdsOf = (userId) =>
    store.all('conexoes_open_finance').filter((c) => c.usuario_id === userId).map((c) => c.id);

  return function rawDbGuard(req, res, next) {
    const [, collection, rawId] = req.path.split('/');
    const byUser = OWNED_BY_USER.includes(collection);
    const byConnection = OWNED_BY_CONNECTION.includes(collection);
    const catalog = CATALOGS.includes(collection);

    if (!byUser && !byConnection && !catalog) {
      return sendError(res, 404, 'NAO_ENCONTRADO', 'Recurso não encontrado.');
    }
    if ((byConnection || catalog) && req.method !== 'GET') {
      return sendError(res, 405, 'SOMENTE_LEITURA', 'Este recurso é somente leitura.');
    }
    if (catalog) return next();

    const userId = req.user.id;

    if (rawId) {
      const record = store.find(collection, (row) => String(row.id) === String(rawId));
      if (!record) return next(); // o json-server responde 404
      const owns = byUser ? record.usuario_id === userId : connectionIdsOf(userId).includes(record.conexao_id);
      if (!owns) return sendError(res, 404, 'NAO_ENCONTRADO', 'Registro não encontrado.');
      if (byUser && (req.method === 'PUT' || req.method === 'PATCH')) {
        req.body = { ...(req.body || {}), usuario_id: userId };
      }
      return next();
    }

    if (req.method === 'GET') {
      // Sobrescreve qualquer filtro do cliente: ele só enxerga os próprios dados
      if (byUser) req.query.usuario_id = String(userId);
      else {
        const ids = connectionIdsOf(userId);
        req.query.conexao_id = ids.length ? ids.map(String) : ['-1'];
      }
    } else if (req.method === 'POST' && byUser) {
      req.body = { ...(req.body || {}), usuario_id: userId };
    }
    return next();
  };
}

/** Remove campos sensíveis de qualquer resposta do json-server. */
function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'senha_hash' && key !== 'cpf')
        .map(([key, val]) => [key, stripSensitive(val)]),
    );
  }
  return value;
}

module.exports = { createRawDbGuard, stripSensitive, CATALOGS, OWNED_BY_USER, OWNED_BY_CONNECTION };
