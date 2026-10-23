/** GET /menu/resumo  (exige sessão) */
const { computeMenuSummary } = require('../services/menu.service');

function createMenuRoutes({ express, store }) {
  const router = express.Router();
  router.get('/resumo', (req, res) => res.json(computeMenuSummary((name) => store.all(name), req.user.id)));
  return router;
}

module.exports = { createMenuRoutes };
