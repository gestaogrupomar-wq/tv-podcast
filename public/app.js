const $ = (id) => document.getElementById(id);
let tvs = [];
let atual = null; // id da TV aberta
let playlist = { versao: 0, itens: [] };

// ---------------- servidor ----------------

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

const playlistApi = (corpo) => api("/api/playlist", { method: "POST", body: { tv: atual, ...corpo } });

function lembrar(chave, valor) {
  try { valor === undefined ? (valor = localStorage.getItem(chave)) : localStorage.setItem(chave, valor); } catch {}
  return valor;
}

// ---------------- sessão ----------------

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
  await carregarTvs();
  setInterval(carregarTvs, 10000);
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

// ---------------- TVs ----------------

const online = (t) => t.status && Date.now() - t.status.em < 90000;

/**
 * O que está no ar agora. A TV avisa a cada 30 s qual item tocava, há quanto tempo e a
 * sequência com a duração de cada item; daqui a conta anda sozinha segundo a segundo.
 */
function noAr(t) {
  const s = t && t.status;
  if (!s || !online(t)) return null;
  const seq = s.seq || [];
  let i = seq.findIndex((x) => x[0] === s.item);
  if (i < 0) return { id: s.item, ms: 0 };
  // TV parada (desligando, em espera): no último aviso ela já estava bem além do fim do item.
  // Aí não dá para saber o que passa; a prévia roda sozinha.
  if (seq[i][1] && seq.length > 1 && (s.decorrido || 0) > seq[i][1] + 10000) return null;
  let ms = Date.now() - s.em + (s.decorrido || 0);
  for (let volta = 0; volta < 2000; volta++) {
    const dur = seq[i][1];
    if (!dur) return { id: seq[i][0], ms: 0 }; // duração ainda desconhecida: do início
    if (ms < dur || seq.length === 1) return { id: seq[i][0], ms: seq.length === 1 ? ms % dur : ms };
    ms -= dur;
    i = (i + 1) % seq.length;
  }
  return { id: seq[i][0], ms: 0 };
}

async function carregarTvs() {
  try { tvs = await api("/api/tvs"); } catch { return; }
  if (!tvs.find((t) => t.id === atual)) {
    const salvo = lembrar("tv");
    atual = (tvs.find((t) => t.id === salvo) || tvs[0] || {}).id || null;
    if (atual) await abrirTv(atual);
  }
  desenharTvs();
  desenharStatus();
}

function desenharTvs() {
  $("sem-tvs").hidden = tvs.length > 0;
  $("mesa").hidden = tvs.length === 0;
  const nav = $("tvs");
  nav.innerHTML = tvs.length ? '<span class="segmentos"></span>' : "";
  const seg = nav.firstElementChild;
  for (const t of tvs) {
    const b = document.createElement("button");
    b.className = "aba" + (t.id === atual ? " atual" : "");
    b.innerHTML = `<span class="led ${online(t) ? "verde" : "vermelho"}"></span>${escapar(t.nome)}`;
    b.title = online(t) ? "Online" : "Offline";
    b.onclick = () => abrirTv(t.id);
    seg.appendChild(b);
  }
  const tv = tvs.find((t) => t.id === atual);
  if (tv) {
    $("nome-tv").textContent = tv.nome;
    $("envio-tv").textContent = tv.nome;
    $("led-tv").className = "led " + (online(tv) ? "verde" : "vermelho");
    $("previa").classList.toggle("retrato", tv.rotacao === 90 || tv.rotacao === 270);
  }
}

async function abrirTv(id) {
  atual = id;
  lembrar("tv", id);
  desenharTvs();
  try { playlist = await api("/api/playlist?tv=" + encodeURIComponent(id)); } catch { return; }
  desenharLista();
  reiniciarPrevia();
  desenharStatus();
}

function desenharStatus() {
  const tv = tvs.find((t) => t.id === atual);
  if (!tv) return;
  const s = tv.status, el = $("status-texto");
  if (!s) {
    el.innerHTML = "<span>A TV ainda não deu sinal. Confira se ela está ligada, na internet e com o app aberto.</span>";
  } else {
    const seg = Math.round((Date.now() - s.em) / 1000);
    const quando = seg < 60 ? `há ${seg} s` : seg < 3600 ? `há ${Math.round(seg / 60)} min` : "há mais de 1 h";
    const partes = [];
    const agora = noAr(tv), itemAgora = agora && playlist.itens.find((i) => i.id === agora.id);
    if (online(tv)) partes.push(itemAgora ? `No ar: <strong data-noar>${escapar(itemAgora.nome)}</strong>` : "<strong>TV ligada</strong>, nada no ar");
    else partes.push(`<strong>Offline</strong>`);
    partes.push(`último sinal ${quando}`);
    if (s.versao && s.versao < playlist.versao) partes.push("atualizando a playlist…");
    if (s.baixando) partes.push(`baixando ${s.baixando} arquivo${s.baixando > 1 ? "s" : ""}`);
    if (s.livreMb) partes.push(`${(s.livreMb / 1024).toFixed(1).replace(".", ",")} GB livres`);
    if (s.app) partes.push(`app ${escapar(s.app)}`);
    el.innerHTML = partes.map((p) => `<span>${p}</span>`).join("");
  }
  marcarNoAr();
}

/** Marca na lista o item no ar e faz a prévia mostrar o mesmo que a TV. Roda a cada segundo. */
function marcarNoAr() {
  const tv = tvs.find((t) => t.id === atual);
  const agora = noAr(tv);
  document.querySelectorAll(".item").forEach((li) => {
    const sim = !!agora && playlist.itens[li.dataset.idx]?.id === agora.id;
    li.classList.toggle("no-ar", sim);
    li.querySelector(".tag.ar")?.toggleAttribute("hidden", !sim);
  });
  const item = agora && playlist.itens.find((i) => i.id === agora.id);
  const txt = document.querySelector("#status-texto span strong");
  if (item && txt && txt.dataset.noar !== undefined) txt.textContent = item.nome;
  if (item && item.ativo) seguirTv(item, agora.ms);
}
setInterval(marcarNoAr, 1000);

// adicionar TV
for (const b of [$("adicionar-tv"), $("adicionar-tv-2")]) {
  b.addEventListener("click", () => {
    $("erro-adicionar").textContent = "";
    $("form-adicionar").reset();
    $("dlg-adicionar").showModal();
    $("codigo").focus();
  });
}
$("form-adicionar").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("erro-adicionar").textContent = "";
  try {
    const tv = await api("/api/tvs", { method: "POST", body: { acao: "adicionar", codigo: $("codigo").value, nome: $("nome-nova").value } });
    $("dlg-adicionar").close();
    await carregarTvs();
    await abrirTv(tv.id);
  } catch (err) { $("erro-adicionar").textContent = err.message; }
});

// opções da TV
$("opcoes-tv").addEventListener("click", () => {
  const tv = tvs.find((t) => t.id === atual);
  if (!tv) return;
  $("renomear").value = tv.nome;
  const r = String(tv.rotacao || 0);
  document.querySelectorAll("#giros input").forEach((i) => { i.checked = i.value === r; });
  $("erro-opcoes").textContent = "";
  $("dlg-opcoes").showModal();
});
$("form-opcoes").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const rotacao = Number((document.querySelector("#giros input:checked") || {}).value || 0);
    await api("/api/tvs", { method: "POST", body: { acao: "configurar", tv: atual, nome: $("renomear").value, rotacao } });
    $("dlg-opcoes").close();
    carregarTvs();
  } catch (err) { $("erro-opcoes").textContent = err.message; }
});
$("remover-tv").addEventListener("click", async () => {
  const tv = tvs.find((t) => t.id === atual);
  if (!tv || !confirm(`Remover "${tv.nome}"? A TV é desconectada e a playlist dela é apagada.`)) return;
  try {
    await api("/api/tvs", { method: "POST", body: { acao: "remover", tv: atual } });
    $("dlg-opcoes").close();
    atual = null;
    carregarTvs();
  } catch (err) { $("erro-opcoes").textContent = err.message; }
});

document.querySelectorAll("[data-fechar]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

// ---------------- playlist ----------------

let salvando = null;
function salvarDepois() {
  clearTimeout(salvando);
  const tv = atual;
  salvando = setTimeout(async () => {
    try {
      const p = await api("/api/playlist", {
        method: "POST",
        body: { tv, acao: "salvar", itens: playlist.itens.map(({ id, nome, duracao, som, ativo }) => ({ id, nome, duracao, som, ativo })) },
      });
      if (tv === atual) playlist = p;
    } catch (e) { if (e.message !== "sessão") alert("Não salvou: " + e.message); }
  }, 500);
  desenharLista();
  reiniciarPrevia();
}

function mb(bytes) {
  return bytes > 1048576 ? (bytes / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.round(bytes / 1024) + " KB";
}

function escapar(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function desenharLista() {
  const ol = $("itens");
  ol.innerHTML = "";
  const ativos = playlist.itens.filter((i) => i.ativo);
  $("resumo").textContent = playlist.itens.length ? `${ativos.length} de ${playlist.itens.length} no ar` : "";
  if (!playlist.itens.length) {
    ol.innerHTML = '<li class="lista-vazia">Playlist vazia. Envie a primeira foto ou vídeo acima.</li>';
    return;
  }
  const outras = tvs.length > 1;
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
      : `<label><input type="number" min="3" max="600" value="${it.duracao}" data-campo="duracao"> s</label>`;
    li.innerHTML = `
      <span class="alca" title="Arraste para reordenar">⠿</span>
      ${mini}
      <div class="info">
        <div class="nome" title="${escapar(it.nome)}">${escapar(it.nome)}</div>
        <div class="detalhes">
          <span class="tag ar" hidden>NO AR</span>
          <span class="tag ${it.tipo}">${it.tipo === "video" ? "VÍDEO" : "FOTO"}</span>
          ${ajuste}
          <span>${mb(it.bytes || 0)}</span>
        </div>
      </div>
      <div class="acoes">
        <button data-acao="subir" title="Subir">↑</button>
        <button data-acao="descer" title="Descer">↓</button>
        ${outras ? '<button data-acao="copiar" title="Copiar para outras TVs">⧉</button>' : ""}
        <button data-acao="ativo" title="${it.ativo ? "Pausar" : "Voltar ao ar"}">${it.ativo ? "⏸" : "▶"}</button>
        <button data-acao="apagar" class="apagar" title="Apagar">✕</button>
      </div>`;
    ol.appendChild(li);
  });
  desenharStatus();
}

$("itens").addEventListener("change", (e) => {
  const li = e.target.closest(".item");
  if (!li) return;
  const it = playlist.itens[li.dataset.idx];
  if (e.target.dataset.campo === "som") it.som = e.target.checked;
  if (e.target.dataset.campo === "duracao") it.duracao = Math.min(600, Math.max(3, Number(e.target.value) || 10));
  salvarDepois();
});

let copiando = null;
$("itens").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-acao]");
  if (!b) return;
  const idx = Number(b.closest(".item").dataset.idx);
  const it = playlist.itens[idx];
  const acao = b.dataset.acao;
  if (acao === "subir" && idx > 0) mover(idx, idx - 1);
  else if (acao === "descer" && idx < playlist.itens.length - 1) mover(idx, idx + 1);
  else if (acao === "ativo") { it.ativo = !it.ativo; salvarDepois(); }
  else if (acao === "copiar") {
    copiando = it;
    $("copiar-nome").textContent = it.nome;
    $("copiar-tvs").innerHTML = tvs.filter((t) => t.id !== atual)
      .map((t) => `<label><input type="checkbox" value="${t.id}"> ${escapar(t.nome)}</label>`).join("");
    $("dlg-copiar").showModal();
  } else if (acao === "apagar") {
    if (!confirm(`Apagar "${it.nome}" desta TV?`)) return;
    try {
      playlist = await playlistApi({ acao: "apagar", id: it.id });
      desenharLista();
      reiniciarPrevia();
    } catch (err) { if (err.message !== "sessão") alert(err.message); }
  }
});

$("form-copiar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const para = [...document.querySelectorAll("#copiar-tvs input:checked")].map((i) => i.value);
  if (copiando && para.length) {
    try { await playlistApi({ acao: "copiar", id: copiando.id, para }); }
    catch (err) { if (err.message !== "sessão") alert(err.message); }
  }
  $("dlg-copiar").close();
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
  const barra = $("progresso"), titulo = envio.querySelector("strong");
  const tv = atual, nomeTv = (tvs.find((t) => t.id === tv) || {}).nome || "esta TV";
  for (const [n, f] of arquivos.entries()) {
    if (!TIPOS.includes(f.type)) { alert(`"${f.name}": só JPG, PNG, WebP ou vídeo MP4.`); continue; }
    if (f.size > MAX) { alert(`"${f.name}" tem ${mb(f.size)}. O limite é 60 MB.`); continue; }
    barra.hidden = false;
    titulo.textContent = `Enviando ${n + 1} de ${arquivos.length}: ${f.name}`;
    try {
      // carregada só aqui: se o CDN falhar, o resto do gestor continua funcionando
      const { upload } = await import("https://cdn.jsdelivr.net/npm/@vercel/blob@2.8.1/client/+esm");
      const nome = f.name.replace(/[^\w.\-]+/g, "-").toLowerCase();
      const blob = await upload("estudio/" + nome, f, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: f.type,
        multipart: f.size > 8 * 1024 * 1024,
        onUploadProgress: (p) => { barra.firstElementChild.style.width = p.percentage + "%"; },
      });
      const p = await api("/api/playlist", {
        method: "POST",
        body: { tv, acao: "adicionar", item: { url: blob.url, pathname: blob.pathname, contentType: f.type, nome: f.name.replace(/\.[^.]+$/, ""), bytes: f.size } },
      });
      if (tv === atual) { playlist = p; desenharLista(); reiniciarPrevia(); }
    } catch (e) {
      if (e.message !== "sessão") alert(`Não consegui enviar "${f.name}": ${e.message}`);
    }
  }
  barra.hidden = true;
  barra.firstElementChild.style.width = "0";
  titulo.innerHTML = `Enviar para <span id="envio-tv">${escapar(nomeTv)}</span>`;
}

// ---------------- prévia (mesma ordem e tempos da TV, sem som) ----------------

let previaPos = -1, previaTimer = null, relogio = null, inicioItem = 0, previaId = null;

/** TV online: a prévia mostra o mesmo item que a TV, no mesmo ponto. */
let terminouId = null, terminouEm = 0;

function seguirTv(it, ms) {
  if (previaId === it.id) return;
  // o item acabou de terminar aqui na prévia: não puxa de volta (era o vaivém do pisca-pisca)
  if (it.id === terminouId && Date.now() - terminouEm < 3000) return;
  const ativos = playlist.itens.filter((i) => i.ativo);
  previaPos = ativos.findIndex((i) => i.id === it.id) - 1;
  proximaPrevia(ms);
}

function reiniciarPrevia() {
  clearTimeout(previaTimer);
  previaPos = -1;
  previaId = null;
  proximaPrevia();
}

function proximaPrevia(desde = 0) {
  clearTimeout(previaTimer);
  const tela = $("previa");
  const ativos = playlist.itens.filter((i) => i.ativo);
  if (!ativos.length) {
    previaId = null;
    tela.innerHTML = '<div class="vazio">Nada no ar</div>';
    $("previa-nome").textContent = "—";
    $("previa-pos").textContent = "";
    $("tc").textContent = "00:00";
    return;
  }
  previaPos = (previaPos + 1) % ativos.length;
  const it = ativos[previaPos];
  previaId = it.id;
  $("previa-nome").textContent = it.nome;
  $("previa-pos").textContent = `${previaPos + 1}/${ativos.length}`;
  inicioItem = Date.now() - desde;
  if (it.tipo === "video") {
    const v = document.createElement("video");
    v.src = it.url; v.muted = true; v.autoplay = true; v.playsInline = true;
    // ponto calculado além do fim do vídeo: começa do início em vez de pular para o fim
    if (desde) v.addEventListener("loadedmetadata", () => { if (desde / 1000 < v.duration - 1) v.currentTime = desde / 1000; }, { once: true });
    v.onended = () => { terminouId = it.id; terminouEm = Date.now(); proximaPrevia(); };
    v.onerror = () => { previaTimer = setTimeout(proximaPrevia, 2000); };
    if (ativos.length === 1) v.loop = true;
    tela.replaceChildren(v);
  } else {
    const img = new Image();
    img.src = it.url; img.alt = "";
    tela.replaceChildren(img);
    previaTimer = setTimeout(() => { terminouId = it.id; terminouEm = Date.now(); proximaPrevia(); },
      Math.max(1000, it.duracao * 1000 - desde));
  }
}

// contador do item na prévia (minutos:segundos)
setInterval(() => {
  if (!inicioItem) return;
  const s = Math.floor((Date.now() - inicioItem) / 1000);
  $("tc").textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}, 250);

iniciar();
