/** Limite de tentativas em memória (suficiente para o mock; reinicia junto com o servidor). */
function createRateLimiter(now = () => Date.now()) {
  const attempts = new Map();

  return function tooManyAttempts(key, limit = 10, windowMs = 15 * 60 * 1000) {
    const current = now();

    // Descarta entradas vencidas de vez em quando para o Map não crescer indefinidamente
    if (attempts.size > 5000) {
      for (const [entryKey, entry] of attempts) if (current > entry.resetAt) attempts.delete(entryKey);
    }

    const entry = attempts.get(key) || { count: 0, resetAt: current + windowMs };
    if (current > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = current + windowMs;
    }
    entry.count += 1;
    attempts.set(key, entry);
    return entry.count > limit;
  };
}

module.exports = { createRateLimiter };
