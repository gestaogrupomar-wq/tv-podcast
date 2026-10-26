// Playlist do painel (precisa de login).
//   GET                                  → playlist completa
//   POST { acao: "adicionar", item }     → depois do upload no Blob
//   POST { acao: "salvar", itens }       → nova ordem / tempo / som / ativo
//   POST { acao: "apagar", id }          → tira da playlist e apaga o arquivo
const { del } = require("@vercel/blob");
const { MAX_BYTES, lerPlaylist, salvarPlaylist, json, exigirLogin } = require("./_lib");

const DOMINIO_BLOB = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//;

function limpar(i) {
  return {
    duracao: Math.min(600, Math.max(3, Math.round(Number(i.duracao) || 10))),
    som: i.som !== false,
    ativo: i.ativo !== false,
  };
}

module.exports = async (req, res) => {
  if (!exigirLogin(req, res)) return;
  try {
    if (req.method === "GET") return json(res, 200, await lerPlaylist());
    if (req.method !== "POST") return json(res, 405, {});
    const b = req.body || {};
    const p = await lerPlaylist();

    if (b.acao === "adicionar") {
      const i = b.item || {};
      if (!DOMINIO_BLOB.test(String(i.url))) return json(res, 400, { erro: "Arquivo inválido." });
      const tipo = String(i.contentType || "").startsWith("video/") ? "video" : "foto";
      p.itens.push({
        id: require("crypto").randomBytes(6).toString("hex"),
        url: i.url,
        pathname: String(i.pathname || ""),
        tipo,
        nome: String(i.nome || "sem nome").slice(0, 120),
        bytes: Math.min(MAX_BYTES, Number(i.bytes) || 0),
        ...limpar({ duracao: 10 }),
      });
      return json(res, 200, await salvarPlaylist(p));
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
      return json(res, 200, await salvarPlaylist(p));
    }

    if (b.acao === "apagar") {
      const item = p.itens.find((i) => i.id === b.id);
      if (!item) return json(res, 404, { erro: "Item não encontrado." });
      p.itens = p.itens.filter((i) => i.id !== b.id);
      await salvarPlaylist(p);
      try { await del(item.url); } catch (e) { /* arquivo já sumiu: segue */ }
      return json(res, 200, p);
    }

    json(res, 400, { erro: "Ação desconhecida." });
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
};
