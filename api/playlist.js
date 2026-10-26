// Playlist de uma TV (precisa de login). Toda chamada leva ?tv=<id> (GET) ou { tv } (POST).
//   GET                                     → playlist completa
//   POST { acao: "adicionar", item }        → depois do upload no Blob
//   POST { acao: "salvar", itens }          → nova ordem / tempo / som / ativo
//   POST { acao: "copiar", id, para: [tv] } → põe o mesmo arquivo na playlist de outras TVs
//   POST { acao: "apagar", id }             → tira da playlist; o arquivo só é apagado se
//                                             nenhuma outra TV usa
const crypto = require("crypto");
const { del } = require("@vercel/blob");
const { MAX_BYTES, lerTvs, lerPlaylist, salvarPlaylist, json, exigirLogin } = require("./_lib");

const DOMINIO_BLOB = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//;

function limpar(i) {
  return {
    duracao: Math.min(600, Math.max(3, Math.round(Number(i.duracao) || 10))),
    som: i.som !== false,
    ativo: i.ativo !== false,
  };
}

const novoId = () => crypto.randomBytes(6).toString("hex");

module.exports = async (req, res) => {
  if (!exigirLogin(req, res)) return;
  try {
    const b = req.body || {};
    const tvs = await lerTvs();
    const tv = String(req.method === "GET" ? req.query.tv : b.tv || "");
    if (!tvs.some((t) => t.id === tv)) return json(res, 404, { erro: "TV não encontrada." });

    if (req.method === "GET") return json(res, 200, await lerPlaylist(tv));
    if (req.method !== "POST") return json(res, 405, {});
    const p = await lerPlaylist(tv);

    if (b.acao === "adicionar") {
      const i = b.item || {};
      if (!DOMINIO_BLOB.test(String(i.url))) return json(res, 400, { erro: "Arquivo inválido." });
      p.itens.push({
        id: novoId(),
        url: i.url,
        pathname: String(i.pathname || ""),
        tipo: String(i.contentType || "").startsWith("video/") ? "video" : "foto",
        nome: String(i.nome || "sem nome").slice(0, 120),
        bytes: Math.min(MAX_BYTES, Number(i.bytes) || 0),
        ...limpar({ duracao: 10 }),
      });
      return json(res, 200, await salvarPlaylist(tv, p));
    }

    if (b.acao === "salvar") {
      // só reordena e ajusta itens que já existem (não aceita URL nova por aqui)
      const porId = new Map(p.itens.map((i) => [i.id, i]));
      const novos = [];
      for (const i of Array.isArray(b.itens) ? b.itens : []) {
        const atual = porId.get(i.id);
        if (!atual) continue;
        porId.delete(i.id);
        novos.push({ ...atual, ...limpar(i), nome: String(i.nome || atual.nome).slice(0, 120) });
      }
      p.itens = novos.concat([...porId.values()]); // o que não veio na lista fica no fim
      return json(res, 200, await salvarPlaylist(tv, p));
    }

    if (b.acao === "copiar") {
      const item = p.itens.find((i) => i.id === b.id);
      if (!item) return json(res, 404, { erro: "Item não encontrado." });
      for (const destino of Array.isArray(b.para) ? b.para : []) {
        if (destino === tv || !tvs.some((t) => t.id === destino)) continue;
        const q = await lerPlaylist(destino);
        if (q.itens.some((i) => i.url === item.url)) continue;
        q.itens.push({ ...item, id: novoId() });
        await salvarPlaylist(destino, q);
      }
      return json(res, 200, p);
    }

    if (b.acao === "apagar") {
      const item = p.itens.find((i) => i.id === b.id);
      if (!item) return json(res, 404, { erro: "Item não encontrado." });
      p.itens = p.itens.filter((i) => i.id !== b.id);
      await salvarPlaylist(tv, p);
      let usado = false;
      for (const t of tvs) {
        if (t.id !== tv && (await lerPlaylist(t.id)).itens.some((i) => i.url === item.url)) { usado = true; break; }
      }
      if (!usado) { try { await del(item.url); } catch (e) { /* arquivo já sumiu */ } }
      return json(res, 200, p);
    }

    json(res, 400, { erro: "Ação desconhecida." });
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
};
