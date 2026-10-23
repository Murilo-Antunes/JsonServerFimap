const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db.json');
const { computeDashboard, computeEvolution } = require('../services/dashboard.service');
const { computeMenuSummary } = require('../services/menu.service');
const { verifyPassword } = require('../lib/security');
const { isValidCpf } = require('../lib/validators');
const { REQUIRED_COLLECTIONS } = require('../lib/app');

const get = (name) => db[name] || [];
// "Agora" fixo: o seed gera datas relativas ao dia em que foi executado, então este teste só
// vale com um db.json recém-gerado (npm run seed). Fora disso, só as verificações estruturais.
const finite = (value, path = '') => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} não é finito`);
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => finite(v, `${path}.${k}`));
};

test('db.json tem todas as coleções que a API exige', () => {
  REQUIRED_COLLECTIONS.forEach((name) => assert.ok(Array.isArray(db[name]), name));
});

test('todos os usuários têm CPF válido e a senha de demonstração', () => {
  assert.equal(db.usuarios.length, 8);
  db.usuarios.forEach((u) => {
    assert.ok(isValidCpf(u.cpf), u.username);
    assert.ok(verifyPassword('Fimap@2026', u.senha_hash), u.username);
  });
  assert.equal(new Set(db.usuarios.map((u) => u.email)).size, 8);
});

test('integridade referencial do Open Finance', () => {
  const conexoes = new Set(get('conexoes_open_finance').map((c) => c.id));
  ['contas_financeiras', 'transacoes_financeiras', 'investimentos_financeiros', 'cartoes_financeiros', 'faturas_financeiras', 'emprestimos_financeiros']
    .forEach((t) => get(t).forEach((row) => assert.ok(conexoes.has(row.conexao_id), `${t}#${row.id}`)));
  get('conexoes_open_finance').forEach((c) => assert.ok(db.usuarios.some((u) => u.id === c.usuario_id)));
  const ativos = new Set(get('ativos_financeiros').map((a) => a.codigo));
  get('investimentos_financeiros').forEach((i) => assert.ok(ativos.has(i.ativo_codigo)));
});

test('dashboard e menu de todos os usuários só têm números finitos', () => {
  const now = new Date();
  db.usuarios.forEach((u) => {
    finite(computeDashboard(get, u.id, now), `dashboard#${u.id}`);
    finite(computeMenuSummary(get, u.id, now), `menu#${u.id}`);
    ['dia', 'semana', 'mes'].forEach((p) => finite(computeEvolution(get, u.id, p, now), `${p}#${u.id}`));
  });
});

test('isolamento: cada usuário só enxerga as próprias transações', () => {
  const now = new Date();
  const mine = computeDashboard(get, 1, now).transacoes;
  const owned = new Set(get('conexoes_open_finance').filter((c) => c.usuario_id === 1).map((c) => c.id));
  mine.forEach((t) => assert.ok(owned.has(get('transacoes_financeiras').find((x) => x.id === t.id).conexao_id)));
});

test('usuário do demo (murilo) tem dados em todos os blocos do dashboard', () => {
  const d = computeDashboard(get, 1, new Date());
  assert.ok(d.resumo.patrimonio.total > 0);
  assert.ok(d.resumo.receita_mensal.valor > 0);
  assert.ok(d.nucleo.cartoes.quantidade_cartoes >= 1);
  assert.ok(d.nucleo.carteira.quantidade_ativos >= 1);
  assert.equal(d.nucleo.emprestimos.contratos_ativos, 1);
  assert.equal(d.transacoes.length, 5);
  assert.notEqual(d.resumo.patrimonio.variacao_mes_percentual, null);
});

test('usuário sem contas ativas recebe zeros (não erro)', () => {
  const d = computeDashboard(get, 5, new Date());
  assert.equal(d.resumo.patrimonio.total, 0);
  assert.deepEqual(d.transacoes, []);
});

test('menu: chaves iguais às de config/navigation.ts', () => {
  const { itens } = computeMenuSummary(get, 1, new Date());
  assert.deepEqual(Object.keys(itens).sort(), ['accounts', 'cards', 'investments', 'loans', 'opportunities', 'settings']);
});
