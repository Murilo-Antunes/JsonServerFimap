const crypto = require('crypto');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('hex');

/** Senha: scrypt com salt aleatório, no formato "salt:hash". */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !String(stored).includes(':')) return false;
  const [salt, hash] = String(stored).split(':');
  const expected = Buffer.from(hash, 'hex');
  const candidate = crypto.scryptSync(password, salt, expected.length || 64);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/** Código numérico de 6 dígitos (com zeros à esquerda). */
const randomOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

module.exports = { sha256, randomToken, hashPassword, verifyPassword, randomOtp };
