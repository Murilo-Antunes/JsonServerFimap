const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthRoutes } = require('../routes/auth.routes');
const { createCookieJar } = require('../lib/cookies');
const { createSessions } = require('../lib/session');
const { createConfig } = require('../lib/config');
const { hashPassword } = require('../lib/security');
const { createRateLimiter } = require('../lib/rate-limit');
const { express, invoke } = require('./helpers/fake-express');
const { createMemoryStore } = require('./helpers/memory-store');

function setup({ clock } = {}) {
  const config = createConfig({ NODE_ENV: 'development', DEV_EXPOSE_OTP: 'true' });
  const store = createMemoryStore({
    usuarios: [{ id: 1, nome: 'Murilo Antunes', cpf: '12345678909', email: 'murilo@example.com', username: 'murilo', senha_hash: hashPassword('Fimap@2026') }],
  });
  const cookies = createCookieJar(config);
  const now = clock || (() => new Date());
  const sessions = createSessions({ store, config, cookies, now });
  const logs = [];
  const router = createAuthRoutes({ express, store, config, cookies, sessions, tooManyAttempts: createRateLimiter(), log: (m) => logs.push(m), now });
  const call = (method, path, extra = {}) => invoke(router, { method, path, ...extra });
  const cookieHeader = (res) => res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { store, call, cookieHeader, logs, config };
}
const LOGIN = { identificador: 'Murilo', senha: 'Fimap@2026' };

test('login ok: devolve usuário sem senha/cpf e define os dois cookies HttpOnly', () => {
  const { call } = setup();
  const { res } = call('POST', '/login', { body: LOGIN });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.usuario.username, 'murilo');
  assert.equal('senha_hash' in res.body.usuario, false);
  assert.equal('cpf' in res.body.usuario, false);
  const [access, refresh] = res.cookies;
  assert.equal(access.name, 'fimap_access');
  assert.equal(access.options.path, '/');
  assert.equal(refresh.options.path, '/auth');
  assert.ok(res.cookies.every((c) => c.options.httpOnly));
});

test('login cross-site por HTTPS usa SameSite=None; Secure (causa clássica do 401 pós-login)', () => {
  const { call, logs } = setup();
  const { res } = call('POST', '/login', {
    body: LOGIN, secure: true, hostname: 'api.onrender.com', headers: { origin: 'http://localhost:5173' },
  });
  assert.equal(res.cookies[0].options.sameSite, 'none');
  assert.equal(res.cookies[0].options.secure, true);
  assert.match(logs.join('\n'), /SameSite=none Secure=true cross-site=true/);
});

test('login com senha errada ou usuário inexistente => 401 CREDENCIAIS_INVALIDAS', () => {
  const { call } = setup();
  for (const body of [{ identificador: 'murilo', senha: 'errada123' }, { identificador: 'ninguem', senha: 'Fimap@2026' }]) {
    const { res } = call('POST', '/login', { body });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.codigo, 'CREDENCIAIS_INVALIDAS');
  }
});

test('/session: sem cookies => 200 autenticado:false (sem erro 401 no console)', () => {
  const { call } = setup();
  const { res } = call('GET', '/session');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { autenticado: false });
});

test('/session e /me com cookie válido; /me sem cookie => 401', () => {
  const { call, cookieHeader } = setup();
  const login = call('POST', '/login', { body: LOGIN }).res;
  const headers = { cookie: cookieHeader(login) };
  assert.equal(call('GET', '/session', { headers }).res.body.autenticado, true);
  assert.equal(call('GET', '/me', { headers }).res.statusCode, 200);
  assert.equal(call('GET', '/me').res.statusCode, 401);
});

test('/session com access vencido e refresh presente => 401 SESSAO_EXPIRADA (cliente renova)', () => {
  let current = new Date('2026-10-23T10:00:00-03:00');
  const { call, cookieHeader } = setup({ clock: () => current });
  const login = call('POST', '/login', { body: LOGIN }).res;
  const headers = { cookie: cookieHeader(login) };
  current = new Date('2026-10-23T10:20:00-03:00'); // 20 min depois: access (15 min) venceu
  const { res } = call('GET', '/session', { headers });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.codigo, 'SESSAO_EXPIRADA');
  // refresh renova e o access volta a valer
  const refreshed = call('POST', '/refresh', { headers }).res;
  assert.equal(refreshed.statusCode, 204);
  const next = { cookie: cookieHeader(refreshed) };
  assert.equal(call('GET', '/session', { headers: next }).res.body.autenticado, true);
  // o refresh antigo foi rotacionado e não vale mais
  assert.equal(call('POST', '/refresh', { headers }).res.statusCode, 401);
});

test('logout apaga a sessão e limpa os cookies', () => {
  const { call, cookieHeader, store } = setup();
  const login = call('POST', '/login', { body: LOGIN }).res;
  const out = call('POST', '/logout', { headers: { cookie: cookieHeader(login) } }).res;
  assert.equal(out.statusCode, 204);
  assert.equal(out.cleared.length, 2);
  assert.equal(store.all('sessoes').length, 0);
});

test('guarda só o hash do token na sessão', () => {
  const { call, store } = setup();
  const login = call('POST', '/login', { body: LOGIN }).res;
  const token = login.cookies[0].value;
  assert.ok(!JSON.stringify(store.all('sessoes')).includes(token));
});

test('cadastro valida campos e rejeita duplicados', () => {
  const { call } = setup();
  let { res } = call('POST', '/register', { body: { nome: 'A', cpf: '111', email: 'x', username: '!!', senha: '123' } });
  assert.equal(res.statusCode, 422);
  assert.deepEqual(Object.keys(res.body.campos).sort(), ['cpf', 'email', 'nome', 'senha', 'username']);

  ({ res } = call('POST', '/register', { body: { nome: 'Outra Pessoa', cpf: '12345678909', email: 'murilo@example.com', username: 'murilo', senha: 'SenhaBoa123' } }));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(Object.keys(res.body.campos).sort(), ['cpf', 'email', 'username']);

  ({ res } = call('POST', '/register', { body: { nome: 'Outra Pessoa', cpf: '529.982.247-25', email: 'outra@example.com', username: 'outra', senha: 'SenhaBoa123' } }));
  assert.equal(res.statusCode, 201);
  assert.equal('senha_hash' in res.body.usuario, false);
});

test('recuperação de senha: código -> token -> nova senha derruba sessões', () => {
  const { call, cookieHeader, store } = setup();
  const login = call('POST', '/login', { body: LOGIN }).res;
  assert.equal(store.all('sessoes').length, 1);

  const forgot = call('POST', '/forgot-password', { body: { email: 'murilo@example.com' } }).res;
  assert.equal(forgot.statusCode, 202);
  const codigo = forgot.body.codigo_dev;
  assert.match(codigo, /^\d{6}$/);

  assert.equal(call('POST', '/verify-otp', { body: { email: 'murilo@example.com', codigo: codigo === '000000' ? '111111' : '000000' } }).res.statusCode, 400);
  const verify = call('POST', '/verify-otp', { body: { email: 'murilo@example.com', codigo } }).res;
  assert.equal(verify.statusCode, 200);
  assert.equal(call('POST', '/verify-otp', { body: { email: 'murilo@example.com', codigo } }).res.statusCode, 400); // não reutilizável

  const reset = call('POST', '/reset-password', { body: { email: 'murilo@example.com', reset_token: verify.body.reset_token, nova_senha: 'NovaSenha123' } }).res;
  assert.equal(reset.statusCode, 204);
  assert.equal(store.all('sessoes').length, 0);
  assert.equal(call('GET', '/me', { headers: { cookie: cookieHeader(login) } }).res.statusCode, 401);
  assert.equal(call('POST', '/login', { body: { identificador: 'murilo', senha: 'NovaSenha123' } }).res.statusCode, 200);
});

test('forgot-password não revela se o e-mail existe', () => {
  const { call } = setup();
  const known = call('POST', '/forgot-password', { body: { email: 'murilo@example.com' } }).res;
  const unknown = call('POST', '/forgot-password', { body: { email: 'ninguem@example.com' } }).res;
  assert.equal(unknown.statusCode, known.statusCode);
  assert.equal(unknown.body.mensagem, known.body.mensagem);
  assert.equal('codigo_dev' in unknown.body, false);
});
