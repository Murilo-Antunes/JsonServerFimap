/**
 * Sessões: criação, rotação do refresh, busca pelo cookie e middleware `requireAuth`.
 * Os tokens nunca são gravados: só o hash SHA-256 fica em `sessoes`.
 */
const { sha256, randomToken } = require('./security');
const { sendError } = require('./errors');

function publicUser(user) {
  // eslint-disable-next-line no-unused-vars
  const { senha_hash, cpf, ...rest } = user;
  return rest;
}

function createSessions({ store, config, cookies, now = () => new Date() }) {
  const { ttl } = config;
  const expiresIn = (ms) => new Date(now().getTime() + ms).toISOString();
  const isExpired = (iso) => !iso || new Date(iso) < now();

  function create(userId, req) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    store.insert('sessoes', {
      usuario_id: userId,
      access_hash: sha256(accessToken),
      access_expira_em: expiresIn(ttl.accessMs),
      refresh_hash: sha256(refreshToken),
      refresh_expira_em: expiresIn(ttl.refreshMs),
      user_agent: (req.get && req.get('user-agent')) || null,
      data_criacao: now().toISOString(),
    });
    return { accessToken, refreshToken };
  }

  /** Troca access + refresh (rotação). Devolve null se o refresh for inválido/expirado. */
  function rotate(refreshToken) {
    const session = store.find('sessoes', (s) => s.refresh_hash === sha256(refreshToken));
    if (!session) return null;
    if (isExpired(session.refresh_expira_em)) {
      store.removeWhere('sessoes', (s) => s.id === session.id);
      return null;
    }
    const accessToken = randomToken();
    const nextRefresh = randomToken();
    store.update('sessoes', session.id, {
      access_hash: sha256(accessToken),
      access_expira_em: expiresIn(ttl.accessMs),
      refresh_hash: sha256(nextRefresh),
    });
    return { accessToken, refreshToken: nextRefresh };
  }

  function destroy({ access, refresh }) {
    if (access) store.removeWhere('sessoes', (s) => s.access_hash === sha256(access));
    if (refresh) store.removeWhere('sessoes', (s) => s.refresh_hash === sha256(refresh));
  }

  function destroyAllOf(userId) {
    store.removeWhere('sessoes', (s) => s.usuario_id === userId);
  }

  /**
   * Resolve o usuário a partir do cookie de acesso.
   * Retorna { user, session } ou { error: 'AUSENTE' | 'EXPIRADA' | 'USUARIO' }.
   */
  function resolve(req) {
    const { access } = cookies.readTokens(req);
    if (!access) return { error: 'AUSENTE' };
    const session = store.find('sessoes', (s) => s.access_hash === sha256(access));
    if (!session || isExpired(session.access_expira_em)) return { error: 'EXPIRADA' };
    const user = store.find('usuarios', (u) => u.id === session.usuario_id);
    if (!user) return { error: 'USUARIO' };
    return { user, session };
  }

  function requireAuth(req, res, next) {
    const result = resolve(req);
    if (result.error === 'AUSENTE') {
      return sendError(res, 401, 'NAO_AUTENTICADO', 'Sessão não encontrada.');
    }
    if (result.error === 'EXPIRADA') {
      return sendError(res, 401, 'SESSAO_EXPIRADA', 'Sessão expirada.');
    }
    if (result.error) return sendError(res, 401, 'NAO_AUTENTICADO', 'Usuário não encontrado.');
    req.session = result.session;
    req.user = result.user;
    return next();
  }

  return { create, rotate, destroy, destroyAllOf, resolve, requireAuth };
}

module.exports = { createSessions, publicUser };
