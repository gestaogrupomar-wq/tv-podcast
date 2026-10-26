// Usado pelo app da TV, que se identifica com "Authorization: Bearer <token>" (recebido no pareamento).
//   GET                                      → { nome, rotacao, versao, itens ativos }
//   POST { item, versao, app, baixando, livreMb } → status "estou viva" (guardado 1 h)
// Token inválido ou TV removida no gestor → 401 (o app volta à tela de código).
const { redis, lerTvs, lerPlaylist, tvDoPedido, json } = require("./_lib");

module.exports = async (req, res) => {
  try {
    const id = await tvDoPedido(req);
    if (!id) return json(res, 401, { erro: "TV não conectada." });

    if (req.method === "GET") {
      const tv = (await lerTvs()).find((t) => t.id === id);
      const p = await lerPlaylist(id);
      return json(res, 200, {
        nome: tv ? tv.nome : "",
        rotacao: tv ? tv.rotacao || 0 : 0,
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
      await redis("SET", "podcast:status:" + id, JSON.stringify(status), "EX", 3600);
      return json(res, 200, { ok: true });
    }
    json(res, 405, {});
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
};
