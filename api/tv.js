// Usado pelo app da TV (sem login: só lê a playlist ativa e avisa o que está passando).
//   GET                              → { versao, itens ativos }
//   POST { item, nome, versao, app } → status "estou viva" (guardado 1 h)
// Painel: GET ?status=1 (com login) → último status da TV.
const { redis, lerPlaylist, json, logado } = require("./_lib");

module.exports = async (req, res) => {
  try {
    if (req.method === "GET" && req.query.status) {
      if (!logado(req)) return json(res, 401, {});
      const s = await redis("GET", "podcast:tv");
      return json(res, 200, s ? JSON.parse(s) : null);
    }
    if (req.method === "GET") {
      const p = await lerPlaylist();
      return json(res, 200, {
        versao: p.versao,
        itens: p.itens.filter((i) => i.ativo).map(({ id, url, tipo, duracao, som, bytes }) =>
          ({ id, url, tipo, duracao, som, bytes })),
      });
    }
    if (req.method === "POST") {
      const b = req.body || {};
      const status = {
        em: Date.now(),
        item: String(b.item || "").slice(0, 40),
        versao: Number(b.versao) || 0,
        app: String(b.app || "").slice(0, 20),
        baixando: Number(b.baixando) || 0,
        livreMb: Number(b.livreMb) || 0,
      };
      await redis("SET", "podcast:tv", JSON.stringify(status), "EX", 3600);
      return json(res, 200, { ok: true });
    }
    json(res, 405, {});
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
};
