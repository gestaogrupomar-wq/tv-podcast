package br.com.grupomar.podcasttv;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Tela inicial das TVs do estúdio. Sem conexão, mostra um código para cadastrar no gestor; com
 * conexão, toca em loop as fotos e vídeos da playlist daquela TV. Tudo fica dentro do "palco",
 * que gira quando a TV está presa em pé (rotação escolhida no gestor).
 */
public class Player extends Activity {
  private static final long SINCRONIA = 30_000, STATUS = 30_000, PAREAR = 3_000;
  private static final String LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  private final Handler ui = new Handler(Looper.getMainLooper());
  private final ExecutorService rede = Executors.newSingleThreadExecutor();
  private final SecureRandom sorteio = new SecureRandom();
  private Midia midia;
  private File arqConexao;

  private FrameLayout raiz, palco;
  /** Uma camada de vídeo: TextureView + o player que desenha nela. São duas, para o próximo
   *  vídeo carregar escondido atrás do atual e entrar sem corte. */
  private static final class Camada {
    TextureView tv;
    Surface sup;
    MediaPlayer mp;
    String id;
    boolean carregado, querTocar, comecou, tentouDeNovo;
  }
  private final Camada[] cam = {new Camada(), new Camada()};
  private int frente; // camada que está no ar
  private ImageView fotoA, fotoB;
  private boolean fotoAFrente = true;
  private View telaCodigo, telaVazia;
  private TextView codigoTxt, codigoDica, vazioNome, vazioStatus;

  private int pos = -1;
  private Midia.Item atual;
  private boolean tocando;
  private volatile int baixando;
  private int largura, altura, rotacao = -1;
  private float k;

  private String codigo, segredo;
  private long codigoDesde;

  // ================= ciclo de vida =================

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    DisplayMetrics dm = getResources().getDisplayMetrics();
    largura = Math.max(dm.widthPixels, dm.heightPixels);
    altura = Math.min(dm.widthPixels, dm.heightPixels);

    raiz = new FrameLayout(this);
    raiz.setBackgroundColor(Color.BLACK);
    palco = new FrameLayout(this);
    raiz.addView(palco);

    for (int n = 0; n < 2; n++) {
      final Camada c = cam[n];
      c.tv = new TextureView(this);
      c.tv.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
        @Override public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) {
          c.sup = new Surface(st);
          if (atual != null && atual.video() && tocandoVideo() == null) tocarVideo(atual);
        }
        @Override public void onSurfaceTextureSizeChanged(SurfaceTexture st, int w, int h) { }
        @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture st) {
          soltar(c);
          if (c.sup != null) c.sup.release();
          c.sup = null;
          return true;
        }
        @Override public void onSurfaceTextureUpdated(SurfaceTexture st) { }
      });
      palco.addView(c.tv, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
    }
    fotoA = foto();
    fotoB = foto();
    palco.addView(fotoA, new FrameLayout.LayoutParams(-1, -1));
    palco.addView(fotoB, new FrameLayout.LayoutParams(-1, -1));
    setContentView(raiz);

    midia = new Midia(getFilesDir());
    arqConexao = new File(getFilesDir(), "tv.json");
    lerConexao();
    midia.carregarCopia();
    aplicarRotacao(midia.rotacao != 0 ? midia.rotacao : rotacaoLocal);
  }

  @Override protected void onStart() {
    super.onStart();
    if (midia.token == null) { mostrarCodigo(); return; }
    ui.post(sincronia);
    ui.postDelayed(status, 5000);
    if (!tocando) proximo();
  }

  @Override protected void onStop() {
    super.onStop();
    ui.removeCallbacksAndMessages(null);
    soltar(cam[0]);
    soltar(cam[1]);
    tocando = false;
    pos = -1;
  }

  @Override public void onBackPressed() { /* tela inicial: não sai */ }

  @Override public boolean onKeyDown(int code, KeyEvent e) {
    if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_SETTINGS) {
      try { startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
      catch (Exception ignored) { }
      return true;
    }
    // sem conexão: OK gira a tela, para dar para ler o código numa TV presa em pé
    if (midia.token == null && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER)) {
      rotacaoLocal = (rotacao + 90) % 360;
      salvarConexao();
      aplicarRotacao(rotacaoLocal);
      return true;
    }
    return super.onKeyDown(code, e);
  }

  // ================= rotação =================

  private int rotacaoLocal;

  /** Gira o palco inteiro. Em retrato ele fica com as medidas trocadas e roda em volta do centro. */
  private void aplicarRotacao(int r) {
    r = ((r % 360) + 360) % 360;
    if (r == rotacao) return;
    rotacao = r;
    boolean emPe = r == 90 || r == 270;
    int w = emPe ? altura : largura, h = emPe ? largura : altura;
    k = w / (emPe ? 540f : 960f);
    palco.setLayoutParams(new FrameLayout.LayoutParams(w, h, Gravity.CENTER));
    palco.setRotation(r);
    // as telas de texto são remontadas para o novo tamanho
    if (telaCodigo != null) { palco.removeView(telaCodigo); telaCodigo = null; }
    if (telaVazia != null) { palco.removeView(telaVazia); telaVazia = null; }
    if (midia.token == null) mostrarCodigo();
    else if (!tocando) mostrarVazia();
    ajustarVideo();
  }

  // ================= conexão com o gestor =================

  private void lerConexao() {
    try {
      if (!arqConexao.exists()) return;
      byte[] b = new byte[(int) arqConexao.length()];
      try (FileInputStream in = new FileInputStream(arqConexao)) { in.read(b); }
      JSONObject j = new JSONObject(new String(b, StandardCharsets.UTF_8));
      String t = j.optString("token");
      midia.token = t.matches("[a-f0-9]{64}") ? t : null;
      rotacaoLocal = j.optInt("rotacao");
    } catch (Exception ignored) { }
  }

  private void salvarConexao() {
    try {
      JSONObject j = new JSONObject();
      if (midia.token != null) j.put("token", midia.token);
      j.put("rotacao", rotacaoLocal);
      try (FileOutputStream o = new FileOutputStream(arqConexao)) { o.write(j.toString().getBytes(StandardCharsets.UTF_8)); }
    } catch (Exception ignored) { }
  }

  /** O gestor removeu esta TV: esquece tudo e volta a mostrar um código. */
  private void desconectada() {
    midia.token = null;
    salvarConexao();
    ui.removeCallbacksAndMessages(null);
    soltar(cam[0]);
    soltar(cam[1]);
    tocando = false;
    atual = null;
    fotoA.setImageDrawable(null);
    fotoB.setImageDrawable(null);
    rede.execute(midia::apagarTudo);
    mostrarCodigo();
  }

  private void mostrarCodigo() {
    if (telaVazia != null) telaVazia.setVisibility(View.GONE);
    if (telaCodigo == null) { telaCodigo = montarTelaCodigo(); palco.addView(telaCodigo, new FrameLayout.LayoutParams(-1, -1)); }
    telaCodigo.setVisibility(View.VISIBLE);
    telaCodigo.bringToFront();
    if (codigo == null || System.currentTimeMillis() - codigoDesde > 14 * 60_000L) novoCodigo();
    else {
      codigoTxt.setText(codigo.substring(0, 3) + " " + codigo.substring(3));
      codigoDica.setText("O código vale por 15 minutos · OK no controle gira a tela");
    }
    ui.removeCallbacks(esperaPar);
    ui.postDelayed(esperaPar, PAREAR);
  }

  private void novoCodigo() {
    StringBuilder c = new StringBuilder();
    for (int i = 0; i < 6; i++) c.append(LETRAS.charAt(sorteio.nextInt(LETRAS.length())));
    byte[] s = new byte[16];
    sorteio.nextBytes(s);
    StringBuilder h = new StringBuilder();
    for (byte x : s) h.append(String.format("%02x", x));
    codigo = c.toString();
    segredo = h.toString();
    codigoDesde = System.currentTimeMillis();
    codigoTxt.setText(codigo.substring(0, 3) + " " + codigo.substring(3));
    codigoDica.setText("Conectando…");
    final String cod = codigo, seg = segredo;
    rede.execute(() -> {
      try {
        JSONObject j = new JSONObject();
        j.put("codigo", cod);
        j.put("segredo", seg);
        Midia.http(Midia.SITE + "/api/parear", j.toString(), null);
        ui.post(() -> { if (cod.equals(codigo)) codigoDica.setText("O código vale por 15 minutos · OK no controle gira a tela"); });
      } catch (Exception e) {
        // sem internet ou código repetido: tenta outro daqui a pouco
        ui.post(() -> { if (cod.equals(codigo)) { codigoDica.setText("Sem conexão com a internet. Tentando de novo…"); codigoDesde = 0; } });
      }
    });
  }

  private final Runnable esperaPar = new Runnable() {
    @Override public void run() {
      if (midia.token != null) return;
      if (System.currentTimeMillis() - codigoDesde > 14 * 60_000L) novoCodigo();
      ui.postDelayed(this, PAREAR);
      final String cod = codigo, seg = segredo;
      rede.execute(() -> {
        try {
          String r = Midia.http(Midia.SITE + "/api/parear?codigo=" + cod + "&segredo=" + seg, null, null);
          if (r.isEmpty()) return; // ainda esperando o gestor
          JSONObject j = new JSONObject(r);
          String token = j.optString("token");
          if (!token.matches("[a-f0-9]{64}")) return;
          ui.post(() -> conectada(token));
        } catch (Exception e) {
          if (String.valueOf(e.getMessage()).startsWith("HTTP 410")) ui.post(() -> codigoDesde = 0); // expirou
        }
      });
    }
  };

  private void conectada(String token) {
    if (midia.token != null) return;
    midia.token = token;
    salvarConexao();
    ui.removeCallbacks(esperaPar);
    codigo = null;
    if (telaCodigo != null) telaCodigo.setVisibility(View.GONE);
    mostrarVazia();
    ui.post(sincronia);
    ui.postDelayed(status, 3000);
  }

  // ================= sincronia com o painel =================

  private final Runnable sincronia = new Runnable() {
    @Override public void run() {
      ui.postDelayed(this, SINCRONIA);
      rede.execute(() -> {
        try {
          midia.atualizar();
          ui.post(() -> aplicarRotacao(midia.rotacao));
          midia.limpar();
          List<Midia.Item> falta = midia.faltando();
          baixando = falta.size();
          for (Midia.Item it : falta) {
            if (it.bytes / (1024 * 1024) + 50 > midia.livreMb()) continue; // sem espaço: pula
            try { midia.baixar(it); } catch (Exception ignored) { }
            baixando--;
            ui.post(() -> { if (!tocando) proximo(); });
          }
          baixando = midia.faltando().size();
        } catch (Midia.Desconectada d) {
          ui.post(Player.this::desconectada);
          return;
        } catch (Exception ignored) {
          // sem internet: segue tocando o que já tem
        }
        ui.post(() -> { if (!tocando) proximo(); atualizarVazia(); });
      });
    }
  };

  private final Runnable status = new Runnable() {
    @Override public void run() {
      ui.postDelayed(this, STATUS);
      final String item = atual != null && tocando ? atual.id : "";
      final String token = midia.token;
      if (token == null) return;
      // sequência com a duração de cada item: o gestor calcula sozinho o que está no ar a cada
      // segundo, sem a TV precisar avisar a cada troca
      final long decorrido = android.os.SystemClock.elapsedRealtime() - itemDesde;
      final org.json.JSONArray seq = new org.json.JSONArray();
      for (Midia.Item i : midia.prontos()) {
        if (seq.length() >= 100) break;
        Long d = i.video() ? duracoes.get(i.id) : Long.valueOf(i.duracao * 1000L);
        seq.put(new org.json.JSONArray().put(i.id).put(d == null ? 0 : d));
      }
      rede.execute(() -> {
        try {
          JSONObject j = new JSONObject();
          j.put("item", item);
          j.put("decorrido", decorrido);
          j.put("seq", seq);
          j.put("versao", midia.versao);
          j.put("app", versao());
          j.put("baixando", baixando);
          j.put("livreMb", midia.livreMb());
          Midia.http(Midia.SITE + "/api/tv", j.toString(), token);
        } catch (Midia.Desconectada d) {
          ui.post(Player.this::desconectada);
        } catch (Exception ignored) { }
      });
    }
  };

  private String versao() {
    try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
    catch (Exception e) { return "?"; }
  }

  // ================= reprodução =================
  //
  // Nenhuma troca pode aparecer: corte seco, sem tela preta e sem travada. O trabalho pesado é
  // feito ANTES da troca, enquanto o item atual passa:
  //  - próxima foto: aberta em segundo plano;
  //  - próximo vídeo: carregado na camada de trás (a partir dos últimos 3 s do vídeo atual, ou
  //    1,5 s antes do fim da foto). Na troca ele começa atrás e só vem para a frente quando o
  //    primeiro quadro já está desenhado; até lá fica na tela o último quadro do anterior.
  // As fotos têm fundo preto e cobrem os vídeos por inteiro.

  private final Runnable fimFoto = this::proximo;
  private long itemDesde;                                              // quando o item atual entrou
  private final java.util.Map<String, Long> duracoes = new java.util.HashMap<>(); // vídeos (ms)
  private final ExecutorService preparo = Executors.newSingleThreadExecutor();
  private volatile String fotoProntaId;
  private volatile Bitmap fotoPronta;

  private Camada atras() { return cam[1 - frente]; }

  /** Player do vídeo que está no ar (ou null). */
  private MediaPlayer tocandoVideo() { return cam[frente].comecou ? cam[frente].mp : null; }

  private void proximo() {
    ui.removeCallbacks(fimFoto);
    ui.removeCallbacks(preVideo);
    if (midia.token == null) return;
    List<Midia.Item> lista = midia.prontos();
    if (lista.isEmpty()) {
      tocando = false;
      atual = null;
      soltar(cam[0]);
      soltar(cam[1]);
      descobrir();
      mostrarVazia();
      return;
    }
    if (telaVazia != null) telaVazia.setVisibility(View.GONE);
    tocando = true;
    pos = (pos + 1) % lista.size();
    atual = lista.get(pos);
    itemDesde = android.os.SystemClock.elapsedRealtime();

    if (atual.video()) {
      tocarVideo(atual);
    } else {
      Bitmap bmp = atual.id.equals(fotoProntaId) ? fotoPronta : abrirFoto(atual);
      fotoProntaId = null;
      fotoPronta = null;
      if (bmp == null) { ui.postDelayed(this::proximo, 500); return; }
      cobrir(bmp);
      soltar(cam[frente]); // o vídeo que estava no ar (a foto já cobre)
      ui.postDelayed(fimFoto, atual.duracao * 1000L);
      ui.postDelayed(preVideo, Math.max(0, atual.duracao * 1000L - 1500));
    }
    prepararFotoSeguinte(lista);
  }

  /** Abre em segundo plano a foto que vem depois do item atual. */
  private void prepararFotoSeguinte(List<Midia.Item> lista) {
    final Midia.Item seg = lista.get((pos + 1) % lista.size());
    if (seg.video() || seg.id.equals(fotoProntaId) || seg == atual) return;
    preparo.execute(() -> {
      Bitmap b = abrirFoto(seg);
      if (b != null) { fotoPronta = b; fotoProntaId = seg.id; }
    });
  }

  /** Carrega o próximo vídeo na camada de trás (sem começar). */
  private final Runnable preVideo = () -> {
    List<Midia.Item> lista = midia.prontos();
    if (lista.size() < 2) return;
    Midia.Item seg = lista.get((pos + 1) % lista.size());
    Camada c = atras();
    if (!seg.video() || c.sup == null || seg.id.equals(c.id)) return;
    carregar(c, seg, false);
  };

  private void tocarVideo(Midia.Item it) {
    Camada c = atras();
    if (c.sup == null) return; // toca quando a superfície existir
    if (c.mp != null && it.id.equals(c.id)) {
      if (c.carregado) comecar(c);
      else c.querTocar = true; // começa assim que terminar de carregar
      return;
    }
    carregar(c, it, true);
  }

  private void carregar(Camada c, Midia.Item it, boolean tocarLogo) {
    soltar(c);
    try {
      final MediaPlayer este = new MediaPlayer();
      c.mp = este;
      c.id = it.id;
      c.querTocar = tocarLogo;
      este.setSurface(c.sup);
      este.setDataSource(it.arquivo.getAbsolutePath());
      float v = it.som ? 1f : 0f;
      este.setVolume(v, v);
      este.setOnVideoSizeChangedListener((p, w, h) -> ajustar(c));
      // sem setLooping: no fim de cada vídeo a playlist é conferida de novo (fotos podem ter
      // terminado de baixar). Se o vídeo continua sendo o único item, recomeça sem corte.
      este.setOnCompletionListener(p -> {
        if (c.mp != este) return;
        List<Midia.Item> prontos = midia.prontos();
        if (prontos.size() == 1 && prontos.get(0).id.equals(it.id)) {
          p.seekTo(0);
          p.start();
          itemDesde = android.os.SystemClock.elapsedRealtime();
        } else proximo();
      });
      este.setOnErrorListener((p, a, b) -> {
        if (c.mp != este) return true;
        boolean queria = c.querTocar;
        soltar(c);
        if (queria) {
          // a TV pode não ter decodificador livre para dois vídeos: solta o de frente (o último
          // quadro dele continua na tela) e tenta uma vez de novo; se falhar, pula o item
          if (!c.tentouDeNovo && cam[frente].mp != null) {
            soltar(cam[frente]);
            c.tentouDeNovo = true;
            carregar(c, it, true);
            c.tentouDeNovo = true;
          } else ui.postDelayed(this::proximo, 500);
        }
        return true;
      });
      este.setOnInfoListener((p, oque, extra) -> {
        if (oque == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START && c.mp == este && c.comecou) paraFrente(c);
        return false;
      });
      este.setOnPreparedListener(p -> {
        if (c.mp != este) return;
        if (p.getDuration() > 0) duracoes.put(it.id, (long) p.getDuration());
        c.carregado = true;
        ajustar(c);
        if (c.querTocar) comecar(c);
      });
      este.prepareAsync();
    } catch (Exception e) {
      soltar(c);
      if (tocarLogo) ui.postDelayed(this::proximo, 1000);
    }
  }

  private void comecar(Camada c) {
    c.comecou = true;
    c.querTocar = false;
    itemDesde = android.os.SystemClock.elapsedRealtime();
    c.mp.start();
    final MediaPlayer este = c.mp;
    // segurança: se a TV não avisar o primeiro quadro, traz para a frente logo depois
    ui.postDelayed(() -> { if (c.mp == este) paraFrente(c); }, 800);
  }

  /** O vídeo novo já tem imagem: vem para a frente e o anterior é solto. */
  private void paraFrente(Camada c) {
    int n = c == cam[0] ? 0 : 1;
    if (frente == n && cam[frente].tv.getAlpha() == 1f && fotoA.getAlpha() == 0f && fotoB.getAlpha() == 0f) return;
    Camada velha = cam[frente];
    frente = n;
    c.tv.setAlpha(1f);
    c.tv.bringToFront();
    descobrir();
    if (velha != c) soltar(velha);
    // o vídeo seguinte começa a carregar atrás nos últimos 3 s deste
    Long dur = duracoes.get(c.id);
    ui.removeCallbacks(preVideo);
    if (dur != null) ui.postDelayed(preVideo, Math.max(0, dur - 3000));
  }

  private void soltar(Camada c) {
    if (c.mp != null) {
      try { c.mp.stop(); } catch (Exception ignored) { }
      try { c.mp.release(); } catch (Exception ignored) { }
    }
    c.mp = null;
    c.id = null;
    c.carregado = c.querTocar = c.comecou = c.tentouDeNovo = false;
  }

  /** Põe a imagem por cima de tudo, na hora, e solta a anterior. */
  private void cobrir(Bitmap bmp) {
    ImageView entra = fotoAFrente ? fotoB : fotoA, sai = fotoAFrente ? fotoA : fotoB;
    fotoAFrente = !fotoAFrente;
    entra.setImageBitmap(bmp);
    entra.setAlpha(1f);
    entra.bringToFront();
    sai.setImageDrawable(null);
    sai.setAlpha(0f);
  }

  /** Tira as imagens de cima (o vídeo já está desenhando). */
  private void descobrir() {
    for (ImageView f : new ImageView[] {fotoA, fotoB}) {
      f.setAlpha(0f);
      f.setImageDrawable(null);
    }
  }

  private void ajustarVideo() {
    ajustar(cam[0]);
    ajustar(cam[1]);
  }

  /** Encaixa o vídeo no palco sem distorcer (com faixas pretas se a proporção for outra). */
  private void ajustar(Camada c) {
    if (c.mp == null || palco.getLayoutParams() == null) return;
    int vw, vh;
    try { vw = c.mp.getVideoWidth(); vh = c.mp.getVideoHeight(); } catch (Exception e) { return; }
    if (vw <= 0 || vh <= 0) return;
    FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) palco.getLayoutParams();
    float escala = Math.min((float) lp.width / vw, (float) lp.height / vh);
    c.tv.setLayoutParams(new FrameLayout.LayoutParams(Math.round(vw * escala), Math.round(vh * escala), Gravity.CENTER));
  }

  /** Abre a foto já reduzida ao tamanho da tela (a TV tem pouca memória). */
  private Bitmap abrirFoto(Midia.Item it) {
    try {
      BitmapFactory.Options o = new BitmapFactory.Options();
      o.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(it.arquivo.getAbsolutePath(), o);
      int amostra = 1;
      while (o.outWidth / (amostra * 2) >= largura && o.outHeight / (amostra * 2) >= largura) amostra *= 2;
      o = new BitmapFactory.Options();
      o.inSampleSize = amostra;
      return BitmapFactory.decodeFile(it.arquivo.getAbsolutePath(), o);
    } catch (Throwable t) {
      return null;
    }
  }

  // ================= telas (vidro escuro) =================

  private ImageView foto() {
    ImageView i = new ImageView(this);
    i.setScaleType(ImageView.ScaleType.FIT_CENTER);
    i.setBackgroundColor(Color.BLACK); // cobre o vídeo inteiro, inclusive nas faixas
    i.setAlpha(0f);
    return i;
  }

  private GradientDrawable fundo() {
    GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
        new int[] {0xFF241A0C, 0xFF0B0C12, 0xFF0A1424});
    return g;
  }

  private LinearLayout cartaoVidro() {
    LinearLayout c = new LinearLayout(this);
    c.setOrientation(LinearLayout.VERTICAL);
    c.setGravity(Gravity.CENTER);
    GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
        new int[] {0x24FFFFFF, 0x10FFFFFF});
    g.setCornerRadius(28 * k);
    g.setStroke(Math.max(1, Math.round(k)), 0x2EFFFFFF);
    c.setBackground(g);
    int p = Math.round(36 * k);
    c.setPadding(p, p, p, p);
    return c;
  }

  private View montarTelaCodigo() {
    FrameLayout f = new FrameLayout(this);
    f.setBackground(fundo());
    LinearLayout c = cartaoVidro();
    ImageView logo = new ImageView(this);
    logo.setImageResource(R.drawable.logo_claro);
    logo.setAdjustViewBounds(true);
    c.addView(logo, new LinearLayout.LayoutParams(-2, Math.round(54 * k)));
    TextView t = texto(22 * k, 0xF0FFFFFF, Typeface.create("sans-serif-medium", Typeface.NORMAL));
    t.setText("Conectar esta TV");
    c.addView(t, margem(22));
    TextView d = texto(13 * k, 0x9EEBEBF5, null);
    d.setText("No Gestor de Telas, clique em  + Adicionar TV  e digite:");
    c.addView(d, margem(8));
    codigoTxt = texto(58 * k, Color.WHITE, Typeface.create(Typeface.MONOSPACE, Typeface.BOLD));
    codigoTxt.setLetterSpacing(0.12f);
    c.addView(codigoTxt, margem(16));
    TextView site = texto(12 * k, 0x9EEBEBF5, null);
    site.setText(Midia.SITE.replace("https://", ""));
    c.addView(site, margem(14));
    codigoDica = texto(11 * k, 0x66EBEBF5, null);
    c.addView(codigoDica, margem(6));
    f.addView(c, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
    return f;
  }

  private void mostrarVazia() {
    if (telaVazia == null) {
      FrameLayout f = new FrameLayout(this);
      f.setBackground(fundo());
      LinearLayout c = cartaoVidro();
      ImageView logo = new ImageView(this);
      logo.setImageResource(R.drawable.logo_claro);
      logo.setAdjustViewBounds(true);
      c.addView(logo, new LinearLayout.LayoutParams(-2, Math.round(54 * k)));
      vazioNome = texto(22 * k, 0xF0FFFFFF, Typeface.create("sans-serif-medium", Typeface.NORMAL));
      c.addView(vazioNome, margem(22));
      TextView d = texto(13 * k, 0x9EEBEBF5, null);
      d.setText("Nada no ar. Envie fotos e vídeos pelo Gestor de Telas.");
      c.addView(d, margem(8));
      vazioStatus = texto(11 * k, 0xFFFF9F0A, null);
      c.addView(vazioStatus, margem(12));
      f.addView(c, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
      telaVazia = f;
      palco.addView(telaVazia, new FrameLayout.LayoutParams(-1, -1));
    }
    telaVazia.setVisibility(View.VISIBLE);
    telaVazia.bringToFront();
    atualizarVazia();
  }

  private void atualizarVazia() {
    if (vazioNome == null) return;
    vazioNome.setText(midia.nome.isEmpty() ? "Gestor de Telas" : midia.nome);
    if (baixando > 0) vazioStatus.setText("Baixando " + baixando + (baixando == 1 ? " arquivo…" : " arquivos…"));
    else if (!midia.itens.isEmpty() && midia.prontos().isEmpty()) vazioStatus.setText("Sem espaço livre na TV para os arquivos");
    else vazioStatus.setText("");
  }

  private LinearLayout.LayoutParams margem(float topo) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2);
    p.topMargin = Math.round(topo * k);
    return p;
  }

  private TextView texto(float px, int cor, Typeface fonte) {
    TextView t = new TextView(this);
    t.setTextSize(TypedValue.COMPLEX_UNIT_PX, px);
    t.setTextColor(cor);
    t.setGravity(Gravity.CENTER);
    if (fonte != null) t.setTypeface(fonte);
    return t;
  }
}
