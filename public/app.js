const $ = (id) => document.getElementById(id);
let playlist = { versao: 0, itens: [] };
let statusTv = null;

// ---------------- sessão ----------------

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, {
    ...opcoes,
    headers: { "Content-Type": "application/json", ...(opcoes.headers || {}) },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  if (r.status === 401 && caminho !== "/api/sessao") { mostrarEntrada(); throw new Error("sessão"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || "Erro " + r.status);
  return j;
}

function mostrarEntrada() {
  $("painel").hidden = true;
  $("entrar").hidden = false;
  $("senha").focus();
}

async function iniciar() {
  const s = await api("/api/sessao").catch(() => ({ logado: false }));
  if (!s.logado) return mostrarEntrada();
  $("entrar").hidden = true;
  $("painel").hidden = false;
  await carregar();
  atualizarStatus();
  setInterval(atualizarStatus, 10000);
}

$("form-entrar").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("erro-entrar").textContent = "";
  try {
    await api("/api/sessao", { method: "POST", body: { senha: $("senha").value } });
    $("senha").value = "";
    iniciar();
  } catch (err) {
    $("erro-entrar").textContent = err.message;
  }
});

$("sair").addEventListener("click", async () => {
  await api("/api/sessao", { method: "DELETE" }).catch(() => {});
  mostrarEntrada();
});

// ---------------- playlist ----------------

async function carregar() {
  playlist = await api("/api/playlist");
  desenharLista();
  reiniciarPrevia();
}

let salvando = null;
function salvarDepois() {
  clearTimeout(salvando);
  salvando = setTimeout(async () => {
    try {
      playlist = await api("/api/playlist", {
        method: "POST",
        body: { acao: "salvar", itens: playlist.itens.map(({ id, nome, duracao, som, ativo }) => ({ id, nome, duracao, som, ativo })) },
      });
    } catch (e) { if (e.message !== "sessão") alert("Não salvou: " + e.message); }
  }, 500);
  desenharLista();
  reiniciarPrevia();
}

function mb(bytes) {
  return bytes > 1048576 ? (bytes / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.round(bytes / 1024) + " KB";
}

function desenharLista() {
  const ol = $("itens");
  ol.innerHTML = "";
  const ativos = playlist.itens.filter((i) => i.ativo);
  $("resumo").textContent = playlist.itens.length
    ? `${ativos.length} de ${playlist.itens.length} passando` : "";
  if (!playlist.itens.length) {
    ol.innerHTML = '<li class="lista-vazia">Nenhum item ainda. Envie a primeira foto ou vídeo acima.</li>';
    return;
  }
  playlist.itens.forEach((it, idx) => {
    const li = document.createElement("li");
    li.className = "item" + (it.ativo ? "" : " pausado");
    li.draggable = true;
    li.dataset.idx = idx;

    const mini = it.tipo === "video"
      ? `<video class="miniatura" src="${it.url}#t=1" muted preload="metadata"></video>`
      : `<img class="miniatura" src="${it.url}" alt="" loading="lazy">`;
    const ajuste = it.tipo === "video"
      ? `<label><input type="checkbox" data-campo="som" ${it.som ? "checked" : ""}> com som</label>`
      : `<label><input type="number" min="3" max="600" value="${it.duracao}" data-campo="duracao"> s na tela</label>`;
    li.innerHTML = `
      <span class="alca" title="Arraste para reordenar">⠿</span>
      ${mini}
      <div class="info">
        <div class="nome" title="${escapar(it.nome)}">${escapar(it.nome)}</div>
        <div class="detalhes">
          <span class="tag ${it.tipo}">${it.tipo === "video" ? "VÍDEO" : "FOTO"}</span>
          ${ajuste}
          <span>${mb(it.bytes || 0)}</span>
        </div>
      </div>
      <div class="acoes">
        <button data-acao="subir" title="Subir">↑</button>
        <button data-acao="descer" title="Descer">↓</button>
        <button data-acao="ativo" title="${it.ativo ? "Pausar" : "Voltar a passar"}">${it.ativo ? "⏸" : "▶"}</button>
        <button data-acao="apagar" class="apagar" title="Apagar">✕</button>
      </div>`;
    ol.appendChild(li);
  });
}

function escapar(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("itens").addEventListener("change", (e) => {
  const li = e.target.closest(".item");
  if (!li) return;
  const it = playlist.itens[li.dataset.idx];
  if (e.target.dataset.campo === "som") it.som = e.target.checked;
  if (e.target.dataset.campo === "duracao") it.duracao = Math.min(600, Math.max(3, Number(e.target.value) || 10));
  salvarDepois();
});

$("itens").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-acao]");
  if (!b) return;
  const idx = Number(b.closest(".item").dataset.idx);
  const it = playlist.itens[idx];
  const acao = b.dataset.acao;
  if (acao === "subir" && idx > 0) mover(idx, idx - 1);
  else if (acao === "descer" && idx < playlist.itens.length - 1) mover(idx, idx + 1);
  else if (acao === "ativo") { it.ativo = !it.ativo; salvarDepois(); }
  else if (acao === "apagar") {
    if (!confirm(`Apagar "${it.nome}"? O arquivo sai da TV e do armazenamento.`)) return;
    try {
      playlist = await api("/api/playlist", { method: "POST", body: { acao: "apagar", id: it.id } });
      desenharLista();
      reiniciarPrevia();
    } catch (err) { if (err.message !== "sessão") alert(err.message); }
  }
});

function mover(de, para) {
  const [it] = playlist.itens.splice(de, 1);
  playlist.itens.splice(para, 0, it);
  salvarDepois();
}

// arrastar para reordenar
let arrastando = null;
$("itens").addEventListener("dragstart", (e) => {
  const li = e.target.closest(".item");
  if (!li) return;
  arrastando = Number(li.dataset.idx);
  li.classList.add("arrastado");
  e.dataTransfer.effectAllowed = "move";
});
$("itens").addEventListener("dragover", (e) => {
  const li = e.target.closest(".item");
  if (arrastando === null || !li) return;
  e.preventDefault();
  document.querySelectorAll(".item.alvo").forEach((x) => x.classList.remove("alvo"));
  li.classList.add("alvo");
});
$("itens").addEventListener("drop", (e) => {
  const li = e.target.closest(".item");
  if (arrastando === null || !li) return;
  e.preventDefault();
  const para = Number(li.dataset.idx);
  if (para !== arrastando) mover(arrastando, para);
  arrastando = null;
});
$("itens").addEventListener("dragend", () => {
  arrastando = null;
  document.querySelectorAll(".item").forEach((x) => x.classList.remove("arrastado", "alvo"));
});

// ---------------- envio ----------------

const TIPOS = ["image/jpeg", "image/png", "image/webp", "video/mp4"];
const MAX = 60 * 1024 * 1024;

$("arquivos").addEventListener("change", (e) => { enviar([...e.target.files]); e.target.value = ""; });
const envio = $("envio");
envio.addEventListener("dragover", (e) => { if (arrastando === null) { e.preventDefault(); envio.classList.add("arrastando"); } });
envio.addEventListener("dragleave", () => envio.classList.remove("arrastando"));
envio.addEventListener("drop", (e) => {
  if (arrastando !== null) return;
  e.preventDefault();
  envio.classList.remove("arrastando");
  enviar([...e.dataTransfer.files]);
});

async function enviar(arquivos) {
  const barra = $("progresso");
  for (const [n, f] of arquivos.entries()) {
    if (!TIPOS.includes(f.type)) { alert(`"${f.name}": só JPG, PNG, WebP ou vídeo MP4.`); continue; }
    if (f.size > MAX) { alert(`"${f.name}" tem ${mb(f.size)}. O limite é 60 MB.`); continue; }
    barra.hidden = false;
    const titulo = envio.querySelector("strong");
    titulo.textContent = `Enviando ${n + 1} de ${arquivos.length}: ${f.name}`;
    try {
      const nome = f.name.replace(/[^\w.\-]+/g, "-").toLowerCase();
      // carregada só aqui: se o CDN falhar, o resto do painel continua funcionando
      const { upload } = await import("https://cdn.jsdelivr.net/npm/@vercel/blob@2.8.1/client/+esm");
      const blob = await upload("podcast/" + nome, f, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: f.type,
        multipart: f.size > 8 * 1024 * 1024,
        onUploadProgress: (p) => { barra.firstElementChild.style.width = p.percentage + "%"; },
      });
      playlist = await api("/api/playlist", {
        method: "POST",
        body: { acao: "adicionar", item: { url: blob.url, pathname: blob.pathname, contentType: f.type, nome: f.name.replace(/\.[^.]+$/, ""), bytes: f.size } },
      });
      desenharLista();
      reiniciarPrevia();
    } catch (e) {
      if (e.message !== "sessão") alert(`Não consegui enviar "${f.name}": ${e.message}`);
    }
  }
  barra.hidden = true;
  barra.firstElementChild.style.width = "0";
  envio.querySelector("strong").textContent = "Enviar fotos ou vídeos";
}

// ---------------- prévia (mesma ordem e tempos da TV, sem som) ----------------

let previaPos = -1, previaTimer = null;

function reiniciarPrevia() {
  clearTimeout(previaTimer);
  previaPos = -1;
  proximaPrevia();
}

function proximaPrevia() {
  clearTimeout(previaTimer);
  const tela = $("previa");
  const ativos = playlist.itens.filter((i) => i.ativo);
  if (!ativos.length) { tela.innerHTML = '<div class="vazio">Nada passando: a playlist está vazia ou pausada</div>'; return; }
  previaPos = (previaPos + 1) % ativos.length;
  const it = ativos[previaPos];
  if (it.tipo === "video") {
    const v = document.createElement("video");
    v.src = it.url; v.muted = true; v.autoplay = true; v.playsInline = true;
    v.onended = proximaPrevia;
    v.onerror = () => { previaTimer = setTimeout(proximaPrevia, 2000); };
    if (ativos.length === 1) v.loop = true;
    tela.replaceChildren(v);
  } else {
    const img = new Image();
    img.src = it.url; img.alt = "";
    tela.replaceChildren(img);
    previaTimer = setTimeout(proximaPrevia, it.duracao * 1000);
  }
}

// ---------------- status da TV ----------------

async function atualizarStatus() {
  try { statusTv = await api("/api/tv?status=1"); } catch { return; }
  const pilula = $("status-pilula"), txt = $("status-texto");
  if (!statusTv) {
    pilula.className = "pilula off"; pilula.textContent = "TV offline";
    txt.textContent = "A TV ainda não deu sinal. Confira se ela está ligada, na internet e com o app aberto.";
    return;
  }
  const seg = Math.round((Date.now() - statusTv.em) / 1000);
  const online = seg < 90;
  pilula.className = "pilula " + (online ? "on" : "off");
  pilula.textContent = online ? "TV online" : "TV offline";
  const item = playlist.itens.find((i) => i.id === statusTv.item);
  const quando = seg < 60 ? `há ${seg} s` : seg < 3600 ? `há ${Math.round(seg / 60)} min` : "há mais de 1 h";
  const partes = [];
  partes.push(online && item ? `Agora na TV: <strong>${escapar(item.nome)}</strong>` : online ? "TV ligada, sem item tocando" : `Último sinal ${quando}`);
  if (online) partes.push(`último sinal ${quando}`);
  if (statusTv.versao && statusTv.versao < playlist.versao) partes.push("atualizando a playlist…");
  if (statusTv.baixando) partes.push(`baixando ${statusTv.baixando} arquivo${statusTv.baixando > 1 ? "s" : ""}`);
  if (statusTv.livreMb) partes.push(`${(statusTv.livreMb / 1024).toFixed(1).replace(".", ",")} GB livres na TV`);
  txt.innerHTML = partes.join(" · ");
}

iniciar();
