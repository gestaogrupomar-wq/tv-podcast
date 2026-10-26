// GET: está logado?  POST {senha}: entra.  DELETE: sai.
const { redis, logado, abrirSessao, fecharSessao, senhaCerta, json } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method === "GET") return json(res, 200, { logado: logado(req) });
  if (req.method === "DELETE") { fecharSessao(res); return json(res, 200, { ok: true }); }
  if (req.method !== "POST") return json(res, 405, {});

  if (!process.env.PAINEL_SENHA) return json(res, 500, { erro: "Senha do painel não configurada na Vercel." });
  // até 10 tentativas erradas por IP a cada 15 min
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  const chave = "podcast:tentativas:" + ip;
  const erros = Number(await redis("GET", chave)) || 0;
  if (erros >= 10) return json(res, 429, { erro: "Muitas tentativas. Espere 15 minutos." });

  if (!senhaCerta(req.body && req.body.senha)) {
    await redis("INCR", chave);
    await redis("EXPIRE", chave, 900);
    return json(res, 401, { erro: "Senha errada." });
  }
  await redis("DEL", chave);
  abrirSessao(res);
  json(res, 200, { ok: true });
};
