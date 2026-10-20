const path = require('path');
const crypto = require('crypto');
const express = require('express');
const jsonServer = require('json-server');
const { createDashboardRouter } = require('./dashboard');
require('dotenv').config();

const server = jsonServer.create();
server.set('trust proxy', 1); // Necessário para o Render identificar o IP real do cliente

const router = jsonServer.router(path.join(__dirname, 'db.json'));
const db = router.db; // instância lowdb usada pelo router

// jsonServer.defaults() já habilita CORS com origin refletida e credentials: true
const middlewares = jsonServer.defaults();

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const isProd = process.env.NODE_ENV === 'production';
const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : isProd;
// Em produção com front e API em domínios diferentes é preciso SameSite=None + Secure.
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax');
const EXPOSE_OTP = process.env.DEV_EXPOSE_OTP
  ? process.env.DEV_EXPOSE_OTP === 'true'
  : !isProd;

const ACCESS_TTL_MS = 15 * 60 * 1000; // 15 minutos
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutos
const RESET_TTL_MS = 10 * 60 * 1000; // 10 minutos
const OTP_MAX_ATTEMPTS = 5;

const ACCESS_COOKIE = 'fimap_access';
const REFRESH_COOKIE = 'fimap_refresh';

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('hex');
const nowIso = () => new Date().toISOString();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function parseCookies(header = '') {
  return header.split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index === -1) return acc;
    acc[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return acc;
  }, {});
}

function isValidCpf(value) {
  const cpf = String(value || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (length) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(cpf[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-z0-9_.]{3,30}$/;

function publicUser(user) {
  // eslint-disable-next-line no-unused-vars
  const { senha_hash, cpf, ...rest } = user;
  return rest;
}

function sendError(res, status, codigo, mensagem, campos) {
  const body = { codigo, mensagem };
  if (campos) body.campos = campos;
  return res.status(status).json(body);
}

// Rate limit simples em memória (suficiente para o mock)
const attempts = new Map();
function tooManyAttempts(key, limit = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  attempts.set(key, entry);
  return entry.count > limit;
}

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------
function cookieOptions(maxAge, cookiePath = '/') {
  return {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    maxAge,
    path: cookiePath,
  };
}

function issueSessionCookies(res, accessToken, refreshToken) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_TTL_MS, '/'));
  // O refresh só é enviado para as rotas de /auth
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_TTL_MS, '/auth'));
}

function clearSessionCookies(res) {
  const base = { httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE };
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/auth' });
}

function createSession(userId, req) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  db.get('sessoes')
    .insert({
      usuario_id: userId,
      access_hash: sha256(accessToken),
      access_expira_em: new Date(Date.now() + ACCESS_TTL_MS).toISOString(),
      refresh_hash: sha256(refreshToken),
      refresh_expira_em: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
      user_agent: req.get('user-agent') || null,
      data_criacao: nowIso(),
    })
    .write();
  return { accessToken, refreshToken };
}

function findUserById(id) {
  return db.get('usuarios').find({ id }).value();
}

function requireAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie)[ACCESS_COOKIE];
  if (!token) return sendError(res, 401, 'NAO_AUTENTICADO', 'Sessão não encontrada.');
  const session = db.get('sessoes').find({ access_hash: sha256(token) }).value();
  if (!session || new Date(session.access_expira_em) < new Date()) {
    return sendError(res, 401, 'SESSAO_EXPIRADA', 'Sessão expirada.');
  }
  const user = findUserById(session.usuario_id);
  if (!user) return sendError(res, 401, 'NAO_AUTENTICADO', 'Usuário não encontrado.');
  req.session = session;
  req.user = user;
  return next();
}

// ---------------------------------------------------------------------------
// Seed do usuário de demonstração (senha apenas para ambiente de testes)
// ---------------------------------------------------------------------------
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Fimap@2026';
const demoUser = db.get('usuarios').find({ id: 1 }).value();
if (demoUser && !demoUser.senha_hash) {
  db.get('usuarios').find({ id: 1 }).assign({ senha_hash: hashPassword(DEMO_PASSWORD) }).write();
  console.log(`Usuário demo "${demoUser.username}" configurado com a senha de DEMO_PASSWORD.`);
}

// ---------------------------------------------------------------------------
// Middlewares gerais
// ---------------------------------------------------------------------------
server.use(middlewares);
server.use(jsonServer.bodyParser);

// ---------------------------------------------------------------------------
// Rotas de autenticação
// ---------------------------------------------------------------------------
const auth = express.Router();

// POST /auth/register
auth.post('/register', (req, res) => {
  const { nome, cpf, email, username, senha } = req.body || {};
  const campos = {};

  if (!nome || String(nome).trim().length < 3) campos.nome = 'Informe seu nome completo.';
  if (!isValidCpf(cpf)) campos.cpf = 'CPF inválido.';
  if (!EMAIL_REGEX.test(String(email || ''))) campos.email = 'E-mail inválido.';
  if (!USERNAME_REGEX.test(String(username || '').toLowerCase())) {
    campos.username = 'Use de 3 a 30 caracteres: letras, números, "_" ou ".".';
  }
  if (!senha || String(senha).length < 8) campos.senha = 'A senha deve ter no mínimo 8 caracteres.';
  if (Object.keys(campos).length) {
    return sendError(res, 422, 'DADOS_INVALIDOS', 'Verifique os campos informados.', campos);
  }

  const emailNorm = String(email).trim().toLowerCase();
  const usernameNorm = String(username).trim().toLowerCase();
  const cpfNorm = String(cpf).replace(/\D/g, '');
  const users = db.get('usuarios');

  const conflitos = {};
  if (users.find((u) => String(u.email).toLowerCase() === emailNorm).value()) {
    conflitos.email = 'Este e-mail já está em uso.';
  }
  if (users.find((u) => String(u.username).toLowerCase() === usernameNorm).value()) {
    conflitos.username = 'Este username já está em uso.';
  }
  if (users.find((u) => u.cpf === cpfNorm).value()) {
    conflitos.cpf = 'Este CPF já está cadastrado.';
  }
  if (Object.keys(conflitos).length) {
    return sendError(res, 409, 'DADOS_EM_USO', 'Alguns dados já estão em uso.', conflitos);
  }

  const created = users
    .insert({
      nome: String(nome).trim(),
      cpf: cpfNorm,
      email: emailNorm,
      username: usernameNorm,
      senha_hash: hashPassword(String(senha)),
      xp_usuario: 0,
      nivel_total: 1,
      foto_perfil: null,
      nome_exibicao: String(nome).trim().split(' ')[0],
      username_social: usernameNorm,
      biografia_social: '',
      localizacao_estado: null,
      visibilidade: 'publico',
    })
    .write();

  return res.status(201).json({ usuario: publicUser(created) });
});

// POST /auth/login  { identificador, senha }
auth.post('/login', (req, res) => {
  const { identificador, senha } = req.body || {};
  if (!identificador || !senha) {
    return sendError(res, 422, 'DADOS_INVALIDOS', 'Informe usuário/e-mail e senha.');
  }
  const id = String(identificador).trim().toLowerCase();
  if (tooManyAttempts(`login:${req.ip}:${id}`)) {
    return sendError(res, 429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Tente novamente mais tarde.');
  }

  const user = db
    .get('usuarios')
    .find((u) => String(u.email).toLowerCase() === id || String(u.username).toLowerCase() === id)
    .value();

  if (!user || !verifyPassword(String(senha), user.senha_hash)) {
    return sendError(res, 401, 'CREDENCIAIS_INVALIDAS', 'Usuário ou senha incorretos.');
  }

  const { accessToken, refreshToken } = createSession(user.id, req);
  issueSessionCookies(res, accessToken, refreshToken);
  return res.json({ usuario: publicUser(user) });
});

// POST /auth/refresh  (usa o cookie HttpOnly de refresh e faz rotação)
auth.post('/refresh', (req, res) => {
  const token = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
  if (!token) return sendError(res, 401, 'NAO_AUTENTICADO', 'Sessão não encontrada.');

  const sessions = db.get('sessoes');
  const session = sessions.find({ refresh_hash: sha256(token) }).value();
  if (!session || new Date(session.refresh_expira_em) < new Date()) {
    if (session) sessions.remove({ id: session.id }).write();
    clearSessionCookies(res);
    return sendError(res, 401, 'SESSAO_EXPIRADA', 'Sessão expirada. Faça login novamente.');
  }

  const accessToken = randomToken();
  const refreshToken = randomToken();
  sessions
    .find({ id: session.id })
    .assign({
      access_hash: sha256(accessToken),
      access_expira_em: new Date(Date.now() + ACCESS_TTL_MS).toISOString(),
      refresh_hash: sha256(refreshToken),
    })
    .write();

  issueSessionCookies(res, accessToken, refreshToken);
  return res.status(204).end();
});

// POST /auth/logout
auth.post('/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessions = db.get('sessoes');
  if (cookies[ACCESS_COOKIE]) sessions.remove({ access_hash: sha256(cookies[ACCESS_COOKIE]) }).write();
  if (cookies[REFRESH_COOKIE]) sessions.remove({ refresh_hash: sha256(cookies[REFRESH_COOKIE]) }).write();
  clearSessionCookies(res);
  return res.status(204).end();
});

// GET /auth/me
auth.get('/me', requireAuth, (req, res) => res.json({ usuario: publicUser(req.user) }));

// POST /auth/forgot-password  { email }
auth.post('/forgot-password', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return sendError(res, 422, 'DADOS_INVALIDOS', 'E-mail inválido.', { email: 'E-mail inválido.' });
  }
  if (tooManyAttempts(`forgot:${req.ip}:${email}`, 5)) {
    return sendError(res, 429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Tente novamente mais tarde.');
  }

  const response = { mensagem: 'Se o e-mail estiver cadastrado, enviaremos um código de verificação.' };
  const user = db.get('usuarios').find((u) => String(u.email).toLowerCase() === email).value();

  if (user) {
    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const otps = db.get('codigos_otp');
    otps.remove({ email }).write(); // invalida códigos anteriores
    otps
      .insert({
        email,
        usuario_id: user.id,
        codigo_hash: sha256(`${email}:${codigo}`),
        expira_em: new Date(Date.now() + OTP_TTL_MS).toISOString(),
        tentativas: 0,
        reset_hash: null,
        reset_expira_em: null,
        data_criacao: nowIso(),
      })
      .write();
    // Sem provedor de e-mail no mock: o código aparece no log do servidor.
    console.log(`[OTP] ${email} -> ${codigo}`);
    if (EXPOSE_OTP) response.codigo_dev = codigo;
  }
  return res.status(202).json(response);
});

// POST /auth/verify-otp  { email, codigo }  ->  { reset_token }
auth.post('/verify-otp', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const codigo = String((req.body || {}).codigo || '').trim();
  if (!/^\d{6}$/.test(codigo)) {
    return sendError(res, 422, 'DADOS_INVALIDOS', 'Informe o código de 6 dígitos.');
  }

  const otps = db.get('codigos_otp');
  const otp = otps.find({ email }).value();
  if (!otp || new Date(otp.expira_em) < new Date()) {
    return sendError(res, 400, 'CODIGO_INVALIDO', 'Código inválido ou expirado.');
  }
  if (otp.tentativas >= OTP_MAX_ATTEMPTS) {
    otps.remove({ id: otp.id }).write();
    return sendError(res, 429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Solicite um novo código.');
  }

  otps.find({ id: otp.id }).assign({ tentativas: otp.tentativas + 1 }).write();
  if (sha256(`${email}:${codigo}`) !== otp.codigo_hash) {
    return sendError(res, 400, 'CODIGO_INVALIDO', 'Código inválido ou expirado.');
  }

  const resetToken = randomToken();
  otps
    .find({ id: otp.id })
    .assign({
      codigo_hash: null, // o código não pode ser reutilizado
      reset_hash: sha256(resetToken),
      reset_expira_em: new Date(Date.now() + RESET_TTL_MS).toISOString(),
    })
    .write();
  return res.json({ reset_token: resetToken });
});

// POST /auth/reset-password  { email, reset_token, nova_senha }
auth.post('/reset-password', (req, res) => {
  const { email: rawEmail, reset_token: resetToken, nova_senha: novaSenha } = req.body || {};
  const email = String(rawEmail || '').trim().toLowerCase();

  if (!novaSenha || String(novaSenha).length < 8) {
    return sendError(res, 422, 'DADOS_INVALIDOS', 'A senha deve ter no mínimo 8 caracteres.', {
      nova_senha: 'A senha deve ter no mínimo 8 caracteres.',
    });
  }

  const otps = db.get('codigos_otp');
  const otp = resetToken ? otps.find({ email, reset_hash: sha256(String(resetToken)) }).value() : null;
  if (!otp || !otp.reset_expira_em || new Date(otp.reset_expira_em) < new Date()) {
    return sendError(res, 400, 'TOKEN_INVALIDO', 'Solicitação expirada. Reinicie a recuperação de senha.');
  }

  db.get('usuarios').find({ id: otp.usuario_id }).assign({ senha_hash: hashPassword(String(novaSenha)) }).write();
  otps.remove({ id: otp.id }).write();
  db.get('sessoes').remove({ usuario_id: otp.usuario_id }).write(); // derruba sessões antigas
  return res.status(204).end();
});

server.use('/auth', auth);

// ---------------------------------------------------------------------------
// Proteção das demais coleções
// ---------------------------------------------------------------------------
const BLOCKED_COLLECTIONS = ['/sessoes', '/codigos_otp'];
server.use((req, res, next) => {
  if (BLOCKED_COLLECTIONS.some((prefix) => req.path.startsWith(prefix))) {
    return sendError(res, 403, 'ACESSO_NEGADO', 'Recurso indisponível.');
  }
  return next();
});
server.use(requireAuth);

const OWNED_BY_USER = ['conexoes_open_finance', 'metas'];
const OWNED_BY_CONNECTION = [
  'contas_financeiras',
  'transacoes_financeiras',
  'investimentos_financeiros',
  'cartoes_financeiros',
  'faturas_financeiras',
  'emprestimos_financeiros',
];

const connectionIdsOf = (userId) =>
  db.get('conexoes_open_finance').filter({ usuario_id: userId }).map('id').value();

server.use((req, res, next) => {
  const [, collection, rawId] = req.path.split('/');
  const byUser = OWNED_BY_USER.includes(collection);
  const byConnection = OWNED_BY_CONNECTION.includes(collection);
  if (!byUser && !byConnection) return next();

  const userId = req.user.id;

  if (byConnection && req.method !== 'GET') {
    return sendError(res, 405, 'SOMENTE_LEITURA', 'Estes dados são sincronizados pelo Open Finance.');
  }

  if (rawId) {
    const record = db.get(collection).find({ id: Number(rawId) }).value();
    if (!record) return next(); // o json-server responde 404
    const owns = byUser ? record.usuario_id === userId : connectionIdsOf(userId).includes(record.conexao_id);
    if (!owns) return sendError(res, 404, 'NAO_ENCONTRADO', 'Registro não encontrado.');
    if (byUser && (req.method === 'PUT' || req.method === 'PATCH')) {
      req.body = { ...(req.body || {}), usuario_id: userId };
    }
    return next();
  }

  if (req.method === 'GET') {
    // Sobrescreve qualquer filtro enviado pelo cliente: ele só enxerga os próprios dados
    if (byUser) req.query.usuario_id = String(userId);
    else {
      const ids = connectionIdsOf(userId);
      req.query.conexao_id = ids.length ? ids.map(String) : ['-1'];
    }
  } else if (req.method === 'POST' && byUser) {
    req.body = { ...(req.body || {}), usuario_id: userId };
  }
  return next();
});

server.use('/dashboard', createDashboardRouter(db));

// Nunca devolver senha_hash nem cpf nas coleções genéricas
router.render = (req, res) => {
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== 'senha_hash' && key !== 'cpf')
          .map(([key, val]) => [key, strip(val)]),
      );
    }
    return value;
  };
  res.jsonp(strip(res.locals.data));
};

server.use(router);

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`JSON Server rodando na porta http://localhost:${port}`);
});
