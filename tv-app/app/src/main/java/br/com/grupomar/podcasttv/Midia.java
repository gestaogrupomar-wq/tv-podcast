package br.com.grupomar.podcasttv;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Playlist e arquivos guardados na TV. Cada arquivo é baixado uma vez para files/midia/<id> e
 * toca dali (sem depender da internet); o que sai da playlist é apagado.
 */
final class Midia {
  static final String SITE = "https://tv-podcast-grupomar.vercel.app";

  static final class Item {
    String id, url, tipo;
    int duracao;
    boolean som;
    long bytes;
    File arquivo;

    boolean video() { return "video".equals(tipo); }
  }

  final File pasta, copia;
  int versao;
  List<Item> itens = new ArrayList<>();

  Midia(File filesDir) {
    pasta = new File(filesDir, "midia");
    pasta.mkdirs();
    copia = new File(filesDir, "playlist.json");
  }

  /** Abre a última playlist guardada (a TV liga e já toca, mesmo sem internet). */
  void carregarCopia() {
    try {
      if (copia.exists()) ler(new JSONObject(new String(lerTudo(new java.io.FileInputStream(copia)), StandardCharsets.UTF_8)));
    } catch (Exception ignored) { }
  }

  /** Busca a playlist no painel. Devolve true se mudou. */
  boolean atualizar() throws Exception {
    String txt = http(SITE + "/api/tv", null);
    JSONObject j = new JSONObject(txt);
    if (j.optInt("versao") == versao && !itens.isEmpty()) return false;
    ler(j);
    try (OutputStream o = new FileOutputStream(copia)) { o.write(txt.getBytes(StandardCharsets.UTF_8)); }
    return true;
  }

  private void ler(JSONObject j) {
    versao = j.optInt("versao");
    List<Item> l = new ArrayList<>();
    JSONArray a = j.optJSONArray("itens");
    if (a != null) for (int i = 0; i < a.length(); i++) {
      JSONObject o = a.optJSONObject(i);
      Item it = new Item();
      it.id = o.optString("id").replaceAll("[^a-zA-Z0-9]", "");
      it.url = o.optString("url");
      it.tipo = o.optString("tipo");
      it.duracao = Math.max(3, o.optInt("duracao", 10));
      it.som = o.optBoolean("som", true);
      it.bytes = o.optLong("bytes");
      it.arquivo = new File(pasta, it.id);
      if (!it.id.isEmpty()) l.add(it);
    }
    itens = l;
  }

  /** Itens já baixados, na ordem da playlist. */
  List<Item> prontos() {
    List<Item> l = new ArrayList<>();
    for (Item i : itens) if (i.arquivo.exists()) l.add(i);
    return l;
  }

  List<Item> faltando() {
    List<Item> l = new ArrayList<>();
    for (Item i : itens) if (!i.arquivo.exists()) l.add(i);
    return l;
  }

  /** Apaga arquivos que saíram da playlist (e downloads pela metade). */
  void limpar() {
    Set<String> manter = new HashSet<>();
    for (Item i : itens) manter.add(i.id);
    File[] fs = pasta.listFiles();
    if (fs != null) for (File f : fs) if (!manter.contains(f.getName())) f.delete();
  }

  void baixar(Item it) throws Exception {
    File tmp = new File(pasta, it.id + ".parcial");
    HttpURLConnection c = (HttpURLConnection) new URL(it.url).openConnection();
    c.setConnectTimeout(20000);
    c.setReadTimeout(60000);
    try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
      byte[] buf = new byte[64 * 1024];
      int n;
      while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    } finally {
      c.disconnect();
    }
    if (!tmp.renameTo(it.arquivo)) { tmp.delete(); throw new Exception("não consegui salvar " + it.id); }
  }

  long livreMb() { return pasta.getUsableSpace() / (1024 * 1024); }

  static String http(String url, String jsonPost) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(15000);
    c.setReadTimeout(20000);
    if (jsonPost != null) {
      c.setRequestMethod("POST");
      c.setDoOutput(true);
      c.setRequestProperty("Content-Type", "application/json");
      try (OutputStream o = c.getOutputStream()) { o.write(jsonPost.getBytes(StandardCharsets.UTF_8)); }
    }
    int code = c.getResponseCode();
    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
    String txt = in == null ? "" : new String(lerTudo(in), StandardCharsets.UTF_8);
    c.disconnect();
    if (code >= 400) throw new Exception("HTTP " + code);
    return txt;
  }

  private static byte[] lerTudo(InputStream in) throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    int n;
    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    in.close();
    return out.toByteArray();
  }
}
