const test = require('node:test');
const assert = require('node:assert/strict');
const { createRawDbGuard, stripSensitive } = require('../lib/raw-db');
const { createMemoryStore } = require('./helpers/memory-store');
const { createReq, createRes } = require('./helpers/fake-express');

const store = createMemoryStore({
  usuarios: [{ id: 1 }, { id: 2 }],
  conexoes_open_finance: [{ id: 1, usuario_id: 1 }, { id: 2, usuario_id: 2 }],
  contas_financeiras: [{ id: 1, conexao_id: 1 }, { id: 2, conexao_id: 2 }],
  metas: [{ id: 1, usuario_id: 1 }, { id: 2, usuario_id: 2 }],
  ativos_financeiros: [{ id: 1, codigo: 'PETR4' }],
});
const guard = createRawDbGuard(store);

function run(method, path, extra = {}) {
  const req = createReq({ method, path, query: {}, ...extra });
  req.user = { id: 1 };
  const res = createRes();
  let passed = false;
  guard(req, res, () => { passed = true; });
  return { req, res, passed };
}

test('coleções sensíveis e o dump "/db" não são acessíveis', () => {
  for (const path of ['/usuarios', '/sessoes', '/codigos_otp', '/db', '/', '/usuarios/1']) {
    const { res, passed } = run('GET', path);
    assert.equal(passed, false, path);
    assert.equal(res.statusCode, 404, path);
  }
});

test('GET em coleção do usuário força o filtro por dono (ignora o que o cliente enviou)', () => {
  const { req, passed } = run('GET', '/metas', { query: { usuario_id: '2' } });
  assert.equal(passed, true);
  assert.equal(req.query.usuario_id, '1');
});

test('dados do Open Finance são filtrados pelas conexões do usuário e são somente leitura', () => {
  const { req } = run('GET', '/contas_financeiras', { query: { conexao_id: '2' } });
  assert.deepEqual(req.query.conexao_id, ['1']);
  assert.equal(run('POST', '/contas_financeiras').res.statusCode, 405);
  assert.equal(run('DELETE', '/contas_financeiras/1').res.statusCode, 405);
});

test('registro de outro usuário => 404; escrita impõe o dono', () => {
  assert.equal(run('GET', '/metas/2').res.statusCode, 404);
  assert.equal(run('PATCH', '/metas/2', { body: {} }).res.statusCode, 404);
  const own = run('PATCH', '/metas/1', { body: { usuario_id: 2, nome: 'x' } });
  assert.equal(own.passed, true);
  assert.equal(own.req.body.usuario_id, 1);
  assert.equal(run('POST', '/metas', { body: { usuario_id: 2 } }).req.body.usuario_id, 1);
});

test('catálogos são somente leitura', () => {
  assert.equal(run('GET', '/ativos_financeiros').passed, true);
  assert.equal(run('POST', '/ativos_financeiros').res.statusCode, 405);
});

test('stripSensitive remove senha_hash e cpf em qualquer nível', () => {
  assert.deepEqual(stripSensitive([{ id: 1, senha_hash: 'x', cpf: '1', aninhado: { cpf: '2', ok: true } }]), [{ id: 1, aninhado: { ok: true } }]);
});
