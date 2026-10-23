/**
 * CORS com credenciais (cookies) + checagem de origem em requisições que alteram dados.
 *
 * - CORS_ORIGINS vazio: qualquer origem é aceita (prático em desenvolvimento).
 * - CORS_ORIGINS definido: só essas origens recebem os cabeçalhos CORS e podem chamar rotas que
 *   alteram dados (POST/PUT/PATCH/DELETE). Isso, junto do cookie SameSite, reduz o risco de CSRF.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function createCors(config) {
  const allowed = new Set(config.corsOrigins);
  const allowAny = allowed.size === 0;

  const isAllowed = (origin) => allowAny || allowed.has(String(origin).replace(/\/+$/, ''));

  function middleware(req, res, next) {
    const origin = req.get('origin');

    if (origin && isAllowed(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.set('Access-Control-Allow-Headers', req.get('access-control-request-headers') || 'Content-Type');
      res.set('Access-Control-Max-Age', '600');
    }

    // Pré-voo (preflight): responde aqui e não passa adiante
    if (req.method === 'OPTIONS') return res.status(204).end();

    // Requisição que altera dados vinda de uma origem não autorizada
    if (origin && !SAFE_METHODS.has(req.method) && !isAllowed(origin)) {
      return res.status(403).json({
        codigo: 'ORIGEM_NAO_PERMITIDA',
        mensagem: 'Origem não autorizada. Inclua o endereço do frontend em CORS_ORIGINS.',
      });
    }
    return next();
  }

  return { middleware, isAllowed, allowAny };
}

module.exports = { createCors };
