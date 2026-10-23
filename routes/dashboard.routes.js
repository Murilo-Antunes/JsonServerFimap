/** GET /dashboard · GET /dashboard/evolucao?periodo=dia|semana|mes  (exigem sessão) */
const { sendError } = require('../lib/errors');
const { computeDashboard, computeEvolution, PERIODS } = require('../services/dashboard.service');

function createDashboardRoutes({ express, store }) {
  const router = express.Router();
  const getCollection = (name) => store.all(name);

  router.get('/', (req, res) => res.json(computeDashboard(getCollection, req.user.id)));

  router.get('/evolucao', (req, res) => {
    const period = String(req.query.periodo || 'semana');
    if (!PERIODS.includes(period)) {
      return sendError(res, 422, 'DADOS_INVALIDOS', 'Período inválido. Use dia, semana ou mes.');
    }
    return res.json(computeEvolution(getCollection, req.user.id, period));
  });

  return router;
}

module.exports = { createDashboardRoutes };
