/** Formato único de erro da API: { codigo, mensagem, campos? } */
function sendError(res, status, codigo, mensagem, campos) {
  const body = { codigo, mensagem };
  if (campos) body.campos = campos;
  return res.status(status).json(body);
}

module.exports = { sendError };
