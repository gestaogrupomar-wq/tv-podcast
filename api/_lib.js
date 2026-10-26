// Peças comuns do painel da TV do podcast.
//
// Variáveis de ambiente na Vercel:
//   PAINEL_SENHA                       senha única do painel (trocar a senha derruba as sessões abertas)
//   BLOB_READ_WRITE_TOKEN              criada ao ligar um Blob store ao projeto (aba Storage)
//   KV_REST_API_URL, KV_REST_API_TOKEN Redis (Upstash) — o mesmo da Redação TV, chaves com prefixo "podcast:"
const crypto = require("crypto");

const DIAS_SESSAO = 30;
const MAX_BYTES = 60 * 1024 * 1024;
const TIPOS = ["image/jpeg", "image/png", "image/webp", "video/mp4"];

async function redis(...cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis não configurado na Vercel");
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// ---------- sessão (cookie assinado; a chave depende da senha) ----------

function chave() {
  return crypto.createHash("sha256").update("podcast-tv:" + (process.env.PAINEL_SENHA || "")).digest();
}

function assinar(validade) {
  return validade + "." + crypto.createHmac("sha256", chave()).update(String(validade)).digest("hex");
}

function lerCookie(req, nome) {
  const c = req.headers.cookie || "";
  for (const parte of c.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return v.join("=");
  }
  return "";
}

function logado(req) {
  if (!process.env.PAINEL_SENHA) return false;
  const s = lerCookie(req, "sessao");
  const [validade, assinatura] = s.split(".");
  if (!validade || !assinatura || Number(validade) < Date.now()) return false;
  const certo = assinar(validade).split(".")[1];
  return assinatura.length === certo.length &&
    crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(certo));
}

function abrirSessao(res) {
  const validade = Date.now() + DIAS_SESSAO * 86400e3;
  res.setHeader("Set-Cookie",
    `sessao=${assinar(validade)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS_SESSAO * 86400}`);
}

function fecharSessao(res) {
  res.setHeader("Set-Cookie", "sessao=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
}

function senhaCerta(tentativa) {
  const a = crypto.createHash("sha256").update(String(tentativa || "")).digest();
  const b = crypto.createHash("sha256").update(process.env.PAINEL_SENHA || "\u0000").digest();
  return crypto.timingSafeEqual(a, b) && !!process.env.PAINEL_SENHA;
}

// ---------- playlist ----------
// { versao, itens: [{ id, url, pathname, tipo: "foto"|"video", nome, bytes, duracao, som, ativo }] }

async function lerPlaylist() {
  const txt = await redis("GET", "podcast:playlist");
  return txt ? JSON.parse(txt) : { versao: 0, itens: [] };
}

async function salvarPlaylist(p) {
  p.versao = (p.versao || 0) + 1;
  await redis("SET", "podcast:playlist", JSON.stringify(p));
  return p;
}

// ---------- respostas ----------

function json(res, status, dados) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(dados));
}

function exigirLogin(req, res) {
  if (logado(req)) return true;
  json(res, 401, { erro: "Entre com a senha do painel." });
  return false;
}

module.exports = {
  MAX_BYTES, TIPOS, redis, logado, abrirSessao, fecharSessao, senhaCerta,
  lerPlaylist, salvarPlaylist, json, exigirLogin,
};
