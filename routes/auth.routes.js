/**
 * Rotas de autenticação (montadas em /auth).
 *
 *  POST /register · POST /login · POST /refresh · POST /logout
 *  GET  /session   -> sempre 200 sem sessão ({ autenticado:false }); 401 só se der para renovar
 *  GET  /me        -> 401 sem sessão
 *  POST /forgot-password · POST /verify-otp · POST /reset-password
 */
const { sendError } = require('../lib/errors');
const { sha256, randomToken, randomOtp, hashPassword, verifyPassword } = require('../lib/security');
const { EMAIL_REGEX, USERNAME_REGEX, isValidCpf } = require('../lib/validators');
const { publicUser } = require('../lib/session');

function createAuthRoutes({ express, store, config, cookies, sessions, tooManyAttempts, log = console.log, now = () => new Date() }) {
  const router = express.Router();
  const lower = (value) => String(value || '').trim().toLowerCase();
  const iso = (offsetMs = 0) => new Date(now().getTime() + offsetMs).toISOString();
  const isPast = (value) => !value || new Date(value) < now();

  router.post('/register', (req, res) => {
    const { nome, cpf, email, username, senha } = req.body || {};
    const campos = {};
    if (!nome || String(nome).trim().length < 3) campos.nome = 'Informe seu nome completo.';
    if (!isValidCpf(cpf)) campos.cpf = 'CPF inválido.';
    if (!EMAIL_REGEX.test(String(email || ''))) campos.email = 'E-mail inválido.';
    if (!USERNAME_REGEX.test(lower(username))) {
      campos.username = 'Use de 3 a 30 caracteres: letras, números, "_" ou ".".';
    }
    if (!senha || String(senha).length < 8) campos.senha = 'A senha deve ter no mínimo 8 caracteres.';
    if (Object.keys(campos).length) {
      return sendError(res, 422, 'DADOS_INVALIDOS', 'Verifique os campos informados.', campos);
    }

    const emailNorm = lower(email);
    const usernameNorm = lower(username);
    const cpfNorm = String(cpf).replace(/\D/g, '');
    const users = store.all('usuarios');

    const conflitos = {};
    if (users.some((u) => lower(u.email) === emailNorm)) conflitos.email = 'Este e-mail já está em uso.';
    if (users.some((u) => lower(u.username) === usernameNorm)) conflitos.username = 'Este username já está em uso.';
    if (users.some((u) => u.cpf === cpfNorm)) conflitos.cpf = 'Este CPF já está cadastrado.';
    if (Object.keys(conflitos).length) {
      return sendError(res, 409, 'DADOS_EM_USO', 'Alguns dados já estão em uso.', conflitos);
    }

    const created = store.insert('usuarios', {
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
    });
    return res.status(201).json({ usuario: publicUser(created) });
  });

  router.post('/login', (req, res) => {
    const { identificador, senha } = req.body || {};
    if (!identificador || !senha) {
      return sendError(res, 422, 'DADOS_INVALIDOS', 'Informe usuário/e-mail e senha.');
    }
    const id = lower(identificador);
    if (tooManyAttempts(`login:${req.ip}:${id}`)) {
      return sendError(res, 429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Tente novamente mais tarde.');
    }

    const user = store.find('usuarios', (u) => lower(u.email) === id || lower(u.username) === id);
    if (!user || !verifyPassword(String(senha), user.senha_hash)) {
      return sendError(res, 401, 'CREDENCIAIS_INVALIDAS', 'Usuário ou senha incorretos.');
    }

    cookies.issue(req, res, sessions.create(user.id, req));
    log(`[auth] login ok usuario=${user.username} cookies: ${cookies.describe(req)}`);
    return res.json({ usuario: publicUser(user) });
  });

  router.post('/refresh', (req, res) => {
    const { refresh } = cookies.readTokens(req);
    if (!refresh) return sendError(res, 401, 'NAO_AUTENTICADO', 'Sessão não encontrada.');
    const tokens = sessions.rotate(refresh);
    if (!tokens) {
      cookies.clear(req, res);
      return sendError(res, 401, 'SESSAO_EXPIRADA', 'Sessão expirada. Faça login novamente.');
    }
    cookies.issue(req, res, tokens);
    return res.status(204).end();
  });

  router.post('/logout', (req, res) => {
    sessions.destroy(cookies.readTokens(req));
    cookies.clear(req, res);
    return res.status(204).end();
  });

  router.get('/session', (req, res) => {
    const result = sessions.resolve(req);
    if (!result.error) return res.json({ autenticado: true, usuario: publicUser(result.user) });
    // Access vencido mas ainda há refresh: 401 para o cliente renovar e repetir
    if (cookies.readTokens(req).refresh) {
      return sendError(res, 401, 'SESSAO_EXPIRADA', 'Sessão expirada.');
    }
    return res.json({ autenticado: false });
  });

  router.get('/me', sessions.requireAuth, (req, res) => res.json({ usuario: publicUser(req.user) }));

  router.post('/forgot-password', (req, res) => {
    const email = lower((req.body || {}).email);
    if (!EMAIL_REGEX.test(email)) {
      return sendError(res, 422, 'DADOS_INVALIDOS', 'E-mail inválido.', { email: 'E-mail inválido.' });
    }
    if (tooManyAttempts(`forgot:${req.ip}:${email}`, 5)) {
      return sendError(res, 429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Tente novamente mais tarde.');
    }

    const response = { mensagem: 'Se o e-mail estiver cadastrado, enviaremos um código de verificação.' };
    const user = store.find('usuarios', (u) => lower(u.email) === email);
    if (user) {
      const codigo = randomOtp();
      store.removeWhere('codigos_otp', (o) => o.email === email); // invalida códigos anteriores
      store.insert('codigos_otp', {
        email,
        usuario_id: user.id,
        codigo_hash: sha256(`${email}:${codigo}`),
        expira_em: iso(config.ttl.otpMs),
        tentativas: 0,
        reset_hash: null,
        reset_expira_em: null,
        data_criacao: iso(),
      });
      // Sem provedor de e-mail no mock: o código aparece no log do servidor.
      log(`[OTP] ${email} -> ${codigo}`);
      if (config.exposeOtp) response.codigo_dev = codigo;
    }
    return res.status(202).json(response);
  });

  router.post('/verify-otp', (req, res) => {
    const email = lower((req.body || {}).email);
    const codigo = String((req.body || {}).codigo || '').trim();
    if (!/^\d{6}$/.test(codigo)) {
      return sendError(res, 422, 'DADOS_INVALIDOS', 'Informe o código de 6 dígitos.');
    }

    const otp = store.find('codigos_otp', (o) => o.email === email);
    if (!otp || isPast(otp.expira_em)) {
      return sendError(res, 400, 'CODIGO_INVALIDO', 'Código inválido ou expirado.');
    }
    if (otp.tentativas >= config.otpMaxAttempts) {
      store.removeWhere('codigos_otp', (o) => o.id === otp.id);
      return sendError(res, 429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Solicite um novo código.');
    }

    store.update('codigos_otp', otp.id, { tentativas: otp.tentativas + 1 });
    if (sha256(`${email}:${codigo}`) !== otp.codigo_hash) {
      return sendError(res, 400, 'CODIGO_INVALIDO', 'Código inválido ou expirado.');
    }

    const resetToken = randomToken();
    store.update('codigos_otp', otp.id, {
      codigo_hash: null, // o código não pode ser reutilizado
      reset_hash: sha256(resetToken),
      reset_expira_em: iso(config.ttl.resetMs),
    });
    return res.json({ reset_token: resetToken });
  });

  router.post('/reset-password', (req, res) => {
    const { email: rawEmail, reset_token: resetToken, nova_senha: novaSenha } = req.body || {};
    const email = lower(rawEmail);

    if (!novaSenha || String(novaSenha).length < 8) {
      return sendError(res, 422, 'DADOS_INVALIDOS', 'A senha deve ter no mínimo 8 caracteres.', {
        nova_senha: 'A senha deve ter no mínimo 8 caracteres.',
      });
    }

    const otp = resetToken
      ? store.find('codigos_otp', (o) => o.email === email && o.reset_hash === sha256(String(resetToken)))
      : null;
    if (!otp || isPast(otp.reset_expira_em)) {
      return sendError(res, 400, 'TOKEN_INVALIDO', 'Solicitação expirada. Reinicie a recuperação de senha.');
    }

    store.update('usuarios', otp.usuario_id, { senha_hash: hashPassword(String(novaSenha)) });
    store.removeWhere('codigos_otp', (o) => o.id === otp.id);
    sessions.destroyAllOf(otp.usuario_id); // derruba sessões antigas
    return res.status(204).end();
  });

  return router;
}

module.exports = { createAuthRoutes };
