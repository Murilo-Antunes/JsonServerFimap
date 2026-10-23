/**
 * Configuração da API, lida das variáveis de ambiente (.env).
 * `createConfig(env)` recebe o objeto de ambiente para poder ser testada com valores diferentes.
 */
const path = require('path');

const toBool = (value, fallback) =>
  value === undefined || value === '' ? fallback : String(value).trim().toLowerCase() === 'true';

const toList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);

function createConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';

  return {
    isProd,
    port: Number(env.PORT) || 3000,
    // Arquivo do banco. No Render, aponte para um disco persistente se quiser manter os dados.
    dbFile: path.resolve(env.DB_FILE || path.join(__dirname, '..', 'db.json')),

    // Senha do usuário "murilo" (só é usada se ele ainda não tiver senha_hash no db.json).
    demoPassword: env.DEMO_PASSWORD || 'Fimap@2026',

    cookieNames: { access: 'fimap_access', refresh: 'fimap_refresh' },
    // Se COOKIE_SAMESITE / COOKIE_SECURE não forem definidos, os atributos são escolhidos a cada
    // requisição (veja lib/cookies.js): "none+secure" para front em outro domínio, "lax" no resto.
    cookies: {
      sameSite: env.COOKIE_SAMESITE ? String(env.COOKIE_SAMESITE).toLowerCase() : null,
      secure: env.COOKIE_SECURE === undefined || env.COOKIE_SECURE === '' ? null : toBool(env.COOKIE_SECURE),
    },

    // Origens do frontend autorizadas (CORS + checagem de origem). Vazio = qualquer origem.
    corsOrigins: toList(env.CORS_ORIGINS),

    exposeOtp: toBool(env.DEV_EXPOSE_OTP, !isProd),
    // Coleções cruas do json-server em /db/* (somente desenvolvimento por padrão).
    exposeRawDb: toBool(env.EXPOSE_RAW_DB, !isProd),

    ttl: {
      accessMs: 15 * 60 * 1000, // 15 minutos
      refreshMs: 7 * 24 * 60 * 60 * 1000, // 7 dias
      otpMs: 10 * 60 * 1000, // 10 minutos
      resetMs: 10 * 60 * 1000, // 10 minutos
    },
    otpMaxAttempts: 5,
  };
}

module.exports = { createConfig };
