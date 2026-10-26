// Pareamento de uma TV nova (sem login: quem chama é o app da TV).
//   POST { codigo, segredo }  → a TV anuncia o código que está mostrando na tela (vale 15 min)
//   GET  ?codigo=&segredo=    → a TV pergunta se o gestor já usou o código; quando sim, recebe
//                               { tv, nome, token } uma vez só.
// O segredo nunca aparece na tela: quem só vê o código não consegue pegar o token da TV.
const { redis, json } = require("./_lib");

const CODIGO = /^[A-Z2-9]{6}$/;
const SEGREDO = /^[a-f0-9]{32}$/;

module.exports = async (req, res) => {
  try {
    if (req.method === "POST") {
      const { codigo, segredo } = req.body || {};
      if (!CODIGO.test(codigo) || !SEGREDO.test(segredo)) return json(res, 400, { erro: "inválido" });
      const ok = await redis("SET", "podcast:par:" + codigo, JSON.stringify({ segredo }), "EX", 900, "NX");
      return json(res, ok ? 200 : 409, ok ? { ok: true } : { erro: "código em uso" });
    }
    if (req.method === "GET") {
      const codigo = String(req.query.codigo || ""), segredo = String(req.query.segredo || "");
      if (!CODIGO.test(codigo) || !SEGREDO.test(segredo)) return json(res, 400, { erro: "inválido" });
      const txt = await redis("GET", "podcast:par:" + codigo);
      if (!txt) return json(res, 410, { erro: "expirou" });
      const p = JSON.parse(txt);
      if (p.segredo !== segredo) return json(res, 403, {});
      if (!p.token) return json(res, 202, { aguardando: true });
      await redis("DEL", "podcast:par:" + codigo);
      return json(res, 200, { tv: p.tv, nome: p.nome, token: p.token });
    }
    json(res, 405, {});
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
};
