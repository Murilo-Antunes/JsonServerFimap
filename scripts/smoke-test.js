/**
 * Teste de ponta a ponta contra a API em execução (Node 18+, sem dependências).
 *
 *   npm start                                  (em outro terminal)
 *   npm run smoke
 *   API_URL=https://sua-api.onrender.com FRONT_ORIGIN=http://localhost:5173 npm run smoke
 *
 * Simula um navegador: guarda os cookies que a API manda e os reenvia. Se o login passa mas a
 * checagem seguinte falha, o problema é o cookie (SameSite/Secure/CORS) e o relatório diz qual.
 */
const API = (process.env.API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const ORIGIN = process.env.FRONT_ORIGIN || 'http://localhost:5173';
const IDENT = process.env.SMOKE_USER || 'murilo';
const SENHA = process.env.SMOKE_PASSWORD || process.env.DEMO_PASSWORD || 'Fimap@2026';

const jar = new Map();
let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'FALHA'} ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures += 1;
};

async function call(method, path, body) {
  const headers = { Origin: ORIGIN, 'Content-Type': 'application/json' };
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const [name, value] = pair.split('=');
    if (/max-age=0|expires=thu, 01 jan 1970/i.test(line) || value === '') jar.delete(name);
    else jar.set(name, value);
  }
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data, setCookies, headers: res.headers };
}

(async () => {
  console.log(`API: ${API}   Origin: ${ORIGIN}\n`);

  const health = await call('GET', '/health');
  ok(health.status === 200, 'GET /health');
  ok(health.headers.get('access-control-allow-origin') === ORIGIN, 'CORS libera a origem do frontend',
    `recebido: ${health.headers.get('access-control-allow-origin')}  -> inclua em CORS_ORIGINS se faltar`);

  const anon = await call('GET', '/auth/session');
  ok(anon.status === 200 && anon.data.autenticado === false, 'GET /auth/session sem login => 200 autenticado:false');

  const login = await call('POST', '/auth/login', { identificador: IDENT, senha: SENHA });
  ok(login.status === 200, 'POST /auth/login', `status ${login.status} ${login.data && login.data.codigo ? login.data.codigo : ''}`);
  login.setCookies.forEach((c) => console.log(`      Set-Cookie: ${c.replace(/=[^;]+/, '=<token>')}`));
  ok(login.setCookies.length === 2, 'login definiu 2 cookies');

  const session = await call('GET', '/auth/session');
  ok(session.status === 200 && session.data.autenticado === true, 'GET /auth/session depois do login (cookie persistiu)');

  const dash = await call('GET', '/dashboard');
  ok(dash.status === 200 && dash.data.resumo, 'GET /dashboard', `status ${dash.status}`);
  const evo = await call('GET', '/dashboard/evolucao?periodo=semana');
  ok(evo.status === 200 && evo.data.pontos.length === 7, 'GET /dashboard/evolucao?periodo=semana');
  const menu = await call('GET', '/menu/resumo');
  ok(menu.status === 200 && menu.data.itens, 'GET /menu/resumo');

  for (const path of ['/db', '/db/usuarios', '/db/sessoes', '/usuarios']) {
    const res = await call('GET', path);
    ok(res.status === 404 || res.status === 403, `GET ${path} bloqueado`, `status ${res.status}`);
  }

  const refresh = await call('POST', '/auth/refresh');
  ok(refresh.status === 204, 'POST /auth/refresh');
  const logout = await call('POST', '/auth/logout');
  ok(logout.status === 204, 'POST /auth/logout');
  const after = await call('GET', '/dashboard');
  ok(after.status === 401, 'GET /dashboard depois do logout => 401');

  console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTudo certo.');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(`Não foi possível falar com ${API}: ${error.message}`);
  process.exit(1);
});
