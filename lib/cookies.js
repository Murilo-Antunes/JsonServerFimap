/**
 * Cookies de sessão (HttpOnly). Os atributos SameSite/Secure dependem de onde o frontend está:
 *
 *  - Front e API no mesmo "site" (ex.: localhost:5173 -> localhost:3000): SameSite=Lax funciona.
 *  - Front em OUTRO domínio (ex.: localhost -> https://api.onrender.com): o navegador só grava e
 *    envia o cookie se ele for SameSite=None + Secure. Com Lax, o login responde 200, o cookie é
 *    descartado e a requisição seguinte volta 401 — o sintoma mais comum de "não consigo logar".
 *
 * Por isso os atributos são escolhidos a cada requisição, a menos que COOKIE_SAMESITE /
 * COOKIE_SECURE estejam definidos no ambiente.
 */

function parseCookies(header = '') {
  return String(header)
    .split(';')
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index === -1) return acc;
      const name = part.slice(0, index).trim();
      const raw = part.slice(index + 1).trim();
      try {
        acc[name] = decodeURIComponent(raw);
      } catch {
        acc[name] = raw; // cookie malformado: não derruba a requisição
      }
      return acc;
    }, {});
}

const VALID_SAMESITE = new Set(['lax', 'strict', 'none']);

/** Atributos de cookie para ESTA requisição. */
function cookieAttributes(req, overrides = {}) {
  const secureRequest = Boolean(req.secure); // com `trust proxy`, reflete o X-Forwarded-Proto
  let crossSite = false;
  const origin = typeof req.get === 'function' ? req.get('origin') : undefined;
  if (origin) {
    try {
      crossSite = new URL(origin).hostname !== req.hostname;
    } catch {
      crossSite = false;
    }
  }

  let sameSite = overrides.sameSite && VALID_SAMESITE.has(overrides.sameSite) ? overrides.sameSite : null;
  if (!sameSite) sameSite = crossSite && secureRequest ? 'none' : 'lax';

  let secure = typeof overrides.secure === 'boolean' ? overrides.secure : secureRequest;
  if (sameSite === 'none') secure = true; // navegadores rejeitam SameSite=None sem Secure

  return { sameSite, secure, crossSite, secureRequest };
}

function createCookieJar(config) {
  const { access: ACCESS, refresh: REFRESH } = config.cookieNames;

  const base = (req) => {
    const { sameSite, secure } = cookieAttributes(req, config.cookies);
    return { httpOnly: true, sameSite, secure };
  };

  return {
    parse: (req) => parseCookies(req.headers && req.headers.cookie),

    readTokens(req) {
      const cookies = parseCookies(req.headers && req.headers.cookie);
      return { access: cookies[ACCESS], refresh: cookies[REFRESH] };
    },

    issue(req, res, tokens) {
      // O refresh token só viaja nas rotas /auth/*
      res.cookie(ACCESS, tokens.accessToken, { ...base(req), maxAge: config.ttl.accessMs, path: '/' });
      res.cookie(REFRESH, tokens.refreshToken, { ...base(req), maxAge: config.ttl.refreshMs, path: '/auth' });
    },

    clear(req, res) {
      res.clearCookie(ACCESS, { ...base(req), path: '/' });
      res.clearCookie(REFRESH, { ...base(req), path: '/auth' });
    },

    describe: (req) => {
      const { sameSite, secure, crossSite } = cookieAttributes(req, config.cookies);
      return `SameSite=${sameSite} Secure=${secure} cross-site=${crossSite}`;
    },
  };
}

module.exports = { parseCookies, cookieAttributes, createCookieJar };
