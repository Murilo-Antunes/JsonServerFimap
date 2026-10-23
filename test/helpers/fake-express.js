/**
 * Mini "express" só para testes: roteia por método/caminho e expõe `invoke`.
 * Não substitui o express real (a API é verificada de ponta a ponta com scripts/smoke-test.js).
 */
function Router() {
  const routes = [];
  const add = (method) => (path, ...handlers) => routes.push({ method, path, handlers });
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') };
}
const express = { Router };

function createRes() {
  const res = {
    statusCode: 200,
    headers: {},
    cookies: [],
    cleared: [],
    body: undefined,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; return this; },
    end() { this.ended = true; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
    clearCookie(name, options) { this.cleared.push({ name, options }); return this; },
  };
  return res;
}

function createReq({ method = 'GET', path = '/', body, headers = {}, query = {}, secure = false, hostname = 'localhost', ip = '127.0.0.1' } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, path, body, headers: lower, query, secure, hostname, ip, get: (name) => lower[name.toLowerCase()] };
}

/** Executa a cadeia de handlers da rota encontrada. */
function invoke(router, options) {
  const req = createReq(options);
  const res = createRes();
  const route = router.routes.find((r) => r.method === req.method && r.path === req.path);
  if (!route) { res.status(404).json({ codigo: 'SEM_ROTA' }); return { req, res }; }
  let index = 0;
  const next = () => { const handler = route.handlers[index++]; if (handler && !res.ended) handler(req, res, next); };
  next();
  return { req, res };
}

module.exports = { express, invoke, createReq, createRes };
