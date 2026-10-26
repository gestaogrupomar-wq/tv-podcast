// TVs do gestor (precisa de login).
//   GET                                         → [{ id, nome, criada, status }]
//   POST { acao: "adicionar", codigo, nome }    → usa o código mostrado na TV
//   POST { acao: "configurar", tv, nome, rotacao }  → rotacao: 0, 90, 180 ou 270 (TV presa em pé)
//   POST { acao: "remover", tv }                → desconecta a TV (ela volta a mostrar um código)
const crypto = require("crypto");
const { del } = require("@vercel/blob");
const { redis, sha, lerTvs, salvarTvs, lerPlaylist, json, exigirLogin } = require("./_lib");

const nomeLimpo = (n) => String(n || "").trim().slice(0, 40);

module.exports = async (req, res) => {
  if (!exigirLogin(req, res)) return;
  try {
    const tvs = await lerTvs();

    if (req.method === "GET") {
      const lista = [];
      for (const t of tvs) {
        const s = await redis("GET", "podcast:status:" + t.id);
        lista.push({ ...t, status: s ? JSON.parse(s) : null });
      }
      return json(res, 200, lista);
    }
    if (req.method !== "POST") return json(res, 405, {});
    const b = req.body || {};

    if (b.acao === "adicionar") {
      const codigo = String(b.codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const nome = nomeLimpo(b.nome);
      if (!nome) return json(res, 400, { erro: "Dê um nome para a TV." });
      const txt = await redis("GET", "podcast:par:" + codigo);
      if (!txt) return json(res, 404, { erro: "Código não encontrado ou expirado. Confira o código na tela da TV." });
      const p = JSON.parse(txt);
      if (p.token) return json(res, 409, { erro: "Esse código já foi usado." });

      const id = crypto.randomBytes(5).toString("hex");
      const token = crypto.randomBytes(32).toString("hex");
      await redis("SET", "podcast:token:" + sha(token), id);
      tvs.push({ id, nome, rotacao: 0, criada: Date.now() });
      await salvarTvs(tvs);
      // a TV busca o token em /api/parear (com o segredo dela) nos próximos minutos
      await redis("SET", "podcast:par:" + codigo, JSON.stringify({ ...p, tv: id, nome, token }), "EX", 300);
      return json(res, 200, { id, nome });
    }

    const tv = tvs.find((t) => t.id === b.tv);
    if (!tv) return json(res, 404, { erro: "TV não encontrada." });

    if (b.acao === "configurar") {
      const nome = nomeLimpo(b.nome);
      if (!nome) return json(res, 400, { erro: "Dê um nome para a TV." });
      tv.nome = nome;
      if ([0, 90, 180, 270].includes(Number(b.rotacao))) tv.rotacao = Number(b.rotacao);
      await salvarTvs(tvs);
      return json(res, 200, tv);
    }

    if (b.acao === "remover") {
      // tira da lista (o token dela deixa de valer: /api/tv responde 401 e a TV volta à tela de
      // código) e apaga a playlist; arquivos que nenhuma outra TV usa saem do armazenamento
      const restantes = tvs.filter((t) => t.id !== tv.id);
      const p = await lerPlaylist(tv.id);
      const emUso = new Set();
      for (const t of restantes) for (const i of (await lerPlaylist(t.id)).itens) emUso.add(i.url);
      const apagar = p.itens.map((i) => i.url).filter((u) => !emUso.has(u));
      await salvarTvs(restantes);
      await redis("DEL", "podcast:playlist:" + tv.id, "podcast:status:" + tv.id);
      if (apagar.length) { try { await del(apagar); } catch (e) { /* já sumiram */ } }
      return json(res, 200, { ok: true });
    }

    json(res, 400, { erro: "Ação desconhecida." });
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
};
