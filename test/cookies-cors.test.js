const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCookies, cookieAttributes } = require('../lib/cookies');
const { createCors } = require('../lib/cors');
const { createConfig } = require('../lib/config');
const { createReq, createRes } = require('./helpers/fake-express');

test('parseCookies tolera valor malformado', () => {
  assert.deepEqual(parseCookies('a=1; b=%E0%A4%A; c=x%20y'), { a: '1', b: '%E0%A4%A', c: 'x y' });
});

test('front em outro domínio via HTTPS => SameSite=None + Secure', () => {
  const req = createReq({ headers: { origin: 'http://localhost:5173' }, secure: true, hostname: 'api.onrender.com' });
  const attrs = cookieAttributes(req);
  assert.equal(attrs.sameSite, 'none');
  assert.equal(attrs.secure, true);
  assert.equal(attrs.crossSite, true);
});

test('mesmo host em HTTP (dev) => Lax sem Secure', () => {
  const req = createReq({ headers: { origin: 'http://localhost:5173' }, secure: false, hostname: 'localhost' });
  assert.deepEqual(
    (({ sameSite, secure }) => ({ sameSite, secure }))(cookieAttributes(req)),
    { sameSite: 'lax', secure: false },
  );
});

test('SameSite=None sempre força Secure; variáveis de ambiente têm prioridade', () => {
  const req = createReq({ secure: false });
  assert.deepEqual(
    (({ sameSite, secure }) => ({ sameSite, secure }))(cookieAttributes(req, { sameSite: 'none', secure: false })),
    { sameSite: 'none', secure: true },
  );
});

test('createConfig lê CORS_ORIGINS e remove barras finais', () => {
  const cfg = createConfig({ CORS_ORIGINS: 'https://app.exemplo.com/, http://localhost:5173' });
  assert.deepEqual(cfg.corsOrigins, ['https://app.exemplo.com', 'http://localhost:5173']);
  assert.equal(cfg.exposeRawDb, true);
  assert.equal(createConfig({ NODE_ENV: 'production' }).exposeRawDb, false);
});

test('CORS: origem permitida recebe cabeçalhos; não permitida não pode escrever; preflight 204', () => {
  const cors = createCors({ corsOrigins: ['http://localhost:5173'] });

  let res = createRes();
  let called = false;
  cors.middleware(createReq({ method: 'POST', headers: { origin: 'http://localhost:5173' } }), res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(res.headers['access-control-allow-credentials'], 'true');

  res = createRes();
  cors.middleware(createReq({ method: 'POST', headers: { origin: 'https://malicioso.com' } }), res, () => assert.fail('não deveria passar'));
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['access-control-allow-origin'], undefined);

  res = createRes();
  cors.middleware(createReq({ method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }), res, () => assert.fail());
  assert.equal(res.statusCode, 204);
});
