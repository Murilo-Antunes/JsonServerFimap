/**
 * Monta a aplicação. Recebe as dependências de fora (express, router do json-server) para que
 * server.js seja só a "ponta" que lê o ambiente e sobe a porta.
 *
 * Mapa de rotas (o contrato do app):
 *   público   GET /health · /auth/*  (GET /auth/session responde 200 mesmo sem login)
 *   privado   GET /dashboard · GET /dashboard/evolucao · GET /menu/resumo
 *   dev       /db/<coleção>  (somente com EXPOSE_RAW_DB=true; lista de permissão em lib/raw-db.js)
 */
const { sendError } = require('./errors');
const { createCookieJar } = require('./cookies');
const { createCors } = require('./cors');
const { createRateLimiter } = require('./rate-limit');
const { createSessions } = require('./session');
const { createStore, ensureCollections } = require('./store');
const { createRawDbGuard, stripSensitive } = require('./raw-db');
const { hashPassword } = require('./security');
const { createAuthRoutes } = require('../routes/auth.routes');
const { createDashboardRoutes } = require('../routes/dashboard.routes');
const { createMenuRoutes } = require('../routes/menu.routes');

const REQUIRED_COLLECTIONS = [
  'usuarios',
  'sessoes',
  'codigos_otp',
  'conexoes_open_finance',
  'contas_financeiras',
  'transacoes_financeiras',
  'investimentos_financeiros',
  'cartoes_financeiros',
  'faturas_financeiras',
  'emprestimos_financeiros',
  'ativos_financeiros',
  'metas',
  'patrimonio_historico',
  'oportunidades',
];

function createApp({ express, db, jsonServerRouter, config, log = console.log }) {
  const app = express();
  app.set('trust proxy', 1); // Render: IP real e req.secure vindos do proxy
  app.disable('x-powered-by');

  const store = createStore(db);
  ensureCollections(db, REQUIRED_COLLECTIONS);

  // Usuário de demonstração sem senha no db.json recebe DEMO_PASSWORD (só para testes)
  const demo = store.find('usuarios', (u) => u.id === 1);
  if (demo && !demo.senha_hash) {
    store.update('usuarios', demo.id, { senha_hash: hashPassword(config.demoPassword) });
    log(`Usuário demo "${demo.username}" configurado com a senha de DEMO_PASSWORD.`);
  }

  const cookies = createCookieJar(config);
  const sessions = createSessions({ store, config, cookies });
  const cors = createCors(config);
  const tooManyAttempts = createRateLimiter();

  app.use(cors.middleware);
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/auth', createAuthRoutes({ express, store, config, cookies, sessions, tooManyAttempts, log }));

  // Daqui para baixo tudo exige sessão
  app.use(sessions.requireAuth);
  app.use('/dashboard', createDashboardRoutes({ express, store }));
  app.use('/menu', createMenuRoutes({ express, store }));

  if (config.exposeRawDb && jsonServerRouter) {
    jsonServerRouter.render = (req, res) => res.jsonp(stripSensitive(res.locals.data));
    app.use('/db', createRawDbGuard(store), jsonServerRouter);
    log('Coleções cruas disponíveis em /db/* (EXPOSE_RAW_DB).');
  }

  app.use((req, res) => sendError(res, 404, 'NAO_ENCONTRADO', 'Rota não encontrada.'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return sendError(res, 400, 'JSON_INVALIDO', 'Corpo da requisição inválido.');
    }
    log('[erro]', err && err.stack ? err.stack : err);
    return sendError(res, 500, 'ERRO_INTERNO', 'Erro interno do servidor.');
  });

  return app;
}

module.exports = { createApp, REQUIRED_COLLECTIONS };
