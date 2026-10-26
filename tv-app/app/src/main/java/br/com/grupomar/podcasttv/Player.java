package br.com.grupomar.podcasttv;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
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
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.VideoView;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Toca em loop as fotos e vídeos da playlist do painel. É a tela inicial da TV do podcast. */
public class Player extends Activity {
  private static final long SINCRONIA = 30_000, STATUS = 30_000, FADE = 600;

  private final Handler ui = new Handler(Looper.getMainLooper());
  private final ExecutorService rede = Executors.newSingleThreadExecutor();
  private Midia midia;

  private VideoView video;
  private ImageView fotoA, fotoB;
  private boolean fotoAFrente = true;
  private View vazio;
  private TextView vazioStatus;

  private int pos = -1;
  private Midia.Item atual;
  private boolean tocando;
  private volatile int baixando;
  private int larguraTela, alturaTela;

  // ================= ciclo de vida =================

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    DisplayMetrics dm = getResources().getDisplayMetrics();
    larguraTela = Math.max(dm.widthPixels, dm.heightPixels);
    alturaTela = Math.min(dm.widthPixels, dm.heightPixels);

    FrameLayout raiz = new FrameLayout(this);
    raiz.setBackgroundColor(Color.BLACK);
    video = new VideoView(this);
    raiz.addView(video, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));
    fotoA = foto();
    fotoB = foto();
    raiz.addView(fotoA, new FrameLayout.LayoutParams(-1, -1));
    raiz.addView(fotoB, new FrameLayout.LayoutParams(-1, -1));
    vazio = telaVazia();
    raiz.addView(vazio, new FrameLayout.LayoutParams(-1, -1));
    setContentView(raiz);

    video.setOnCompletionListener(mp -> proximo());
    video.setOnErrorListener((mp, w, e) -> { ui.postDelayed(this::proximo, 1000); return true; });

    midia = new Midia(getFilesDir());
    midia.carregarCopia();
  }

  @Override protected void onStart() {
    super.onStart();
    ui.post(sincronia);
    ui.postDelayed(status, 5000);
    if (!tocando) proximo();
  }

  @Override protected void onStop() {
    super.onStop();
    ui.removeCallbacksAndMessages(null);
    video.stopPlayback();
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
    return super.onKeyDown(code, e);
  }

  // ================= sincronia com o painel =================

  private final Runnable sincronia = new Runnable() {
    @Override public void run() {
      ui.postDelayed(this, SINCRONIA);
      rede.execute(() -> {
        try {
          midia.atualizar();
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
        } catch (Exception ignored) {
          // sem internet: segue tocando o que já tem
        }
        ui.post(() -> { if (!tocando) proximo(); atualizarVazio(); });
      });
    }
  };

  private final Runnable status = new Runnable() {
    @Override public void run() {
      ui.postDelayed(this, STATUS);
      final String item = atual != null && tocando ? atual.id : "";
      rede.execute(() -> {
        try {
          JSONObject j = new JSONObject();
          j.put("item", item);
          j.put("versao", midia.versao);
          j.put("app", versao());
          j.put("baixando", baixando);
          j.put("livreMb", midia.livreMb());
          Midia.http(Midia.SITE + "/api/tv", j.toString());
        } catch (Exception ignored) { }
      });
    }
  };

  private String versao() {
    try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
    catch (Exception e) { return "?"; }
  }

  // ================= reprodução =================

  private final Runnable fimFoto = this::proximo;

  private void proximo() {
    ui.removeCallbacks(fimFoto);
    List<Midia.Item> lista = midia.prontos();
    if (lista.isEmpty()) {
      tocando = false;
      atual = null;
      video.stopPlayback();
      video.setVisibility(View.INVISIBLE);
      fotoA.setImageDrawable(null);
      fotoB.setImageDrawable(null);
      atualizarVazio();
      vazio.setVisibility(View.VISIBLE);
      return;
    }
    vazio.setVisibility(View.GONE);
    tocando = true;
    pos = (pos + 1) % lista.size();
    atual = lista.get(pos);

    if (atual.video()) {
      final Midia.Item it = atual;
      final boolean sozinho = lista.size() == 1;
      fotoA.animate().alpha(0f).setDuration(FADE).start();
      fotoB.animate().alpha(0f).setDuration(FADE).start();
      video.setVisibility(View.VISIBLE);
      video.setOnPreparedListener(mp -> {
        float v = it.som ? 1f : 0f;
        mp.setVolume(v, v);
        mp.setLooping(sozinho);
        mp.setVideoScalingMode(MediaPlayer.VIDEO_SCALING_MODE_SCALE_TO_FIT);
      });
      video.setVideoPath(it.arquivo.getAbsolutePath());
      video.start();
    } else {
      Bitmap bmp = abrirFoto(atual);
      if (bmp == null) { ui.postDelayed(this::proximo, 500); return; }
      ImageView entra = fotoAFrente ? fotoB : fotoA, sai = fotoAFrente ? fotoA : fotoB;
      fotoAFrente = !fotoAFrente;
      entra.setImageBitmap(bmp);
      entra.bringToFront();
      vazio.bringToFront();
      entra.setAlpha(0f);
      entra.animate().alpha(1f).setDuration(FADE).withEndAction(() -> {
        sai.setImageDrawable(null); // solta a foto anterior
        sai.setAlpha(0f);
        if (video.isPlaying() || video.getVisibility() == View.VISIBLE) {
          video.stopPlayback();
          video.setVisibility(View.INVISIBLE);
        }
      }).start();
      ui.postDelayed(fimFoto, atual.duracao * 1000L);
    }
  }

  /** Abre a foto já reduzida ao tamanho da tela (a TV tem pouca memória). */
  private Bitmap abrirFoto(Midia.Item it) {
    try {
      BitmapFactory.Options o = new BitmapFactory.Options();
      o.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(it.arquivo.getAbsolutePath(), o);
      int amostra = 1;
      while (o.outWidth / (amostra * 2) >= larguraTela && o.outHeight / (amostra * 2) >= alturaTela) amostra *= 2;
      o = new BitmapFactory.Options();
      o.inSampleSize = amostra;
      return BitmapFactory.decodeFile(it.arquivo.getAbsolutePath(), o);
    } catch (Throwable t) {
      return null;
    }
  }

  // ================= telas =================

  private ImageView foto() {
    ImageView i = new ImageView(this);
    i.setScaleType(ImageView.ScaleType.FIT_CENTER);
    i.setBackgroundColor(Color.TRANSPARENT);
    i.setAlpha(0f);
    return i;
  }

  private View telaVazia() {
    float k = larguraTela / 960f;
    LinearLayout l = new LinearLayout(this);
    l.setOrientation(LinearLayout.VERTICAL);
    l.setGravity(Gravity.CENTER);
    l.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR,
        new int[] {0xFFFDF3E3, 0xFFEEF2F7, 0xFFDCE8F0}));
    ImageView logo = new ImageView(this);
    logo.setImageResource(R.drawable.logo);
    logo.setAdjustViewBounds(true);
    l.addView(logo, new LinearLayout.LayoutParams(-2, Math.round(90 * k)));
    TextView t = texto(26 * k, 0xFF141B2A);
    t.setText("TV do Podcast");
    LinearLayout.LayoutParams pt = new LinearLayout.LayoutParams(-2, -2);
    pt.topMargin = Math.round(28 * k);
    l.addView(t, pt);
    TextView d = texto(14 * k, 0xA6141B2A);
    d.setText("Envie fotos e vídeos pelo painel: " + Midia.SITE.replace("https://", ""));
    LinearLayout.LayoutParams pd = new LinearLayout.LayoutParams(-2, -2);
    pd.topMargin = Math.round(10 * k);
    l.addView(d, pd);
    vazioStatus = texto(11 * k, 0xFFC87300);
    LinearLayout.LayoutParams ps = new LinearLayout.LayoutParams(-2, -2);
    ps.topMargin = Math.round(18 * k);
    l.addView(vazioStatus, ps);
    return l;
  }

  private void atualizarVazio() {
    if (vazioStatus == null) return;
    if (baixando > 0) vazioStatus.setText("Baixando " + baixando + (baixando == 1 ? " arquivo…" : " arquivos…"));
    else if (!midia.itens.isEmpty() && midia.prontos().isEmpty()) vazioStatus.setText("Sem espaço livre na TV para os arquivos");
    else vazioStatus.setText("");
  }

  private TextView texto(float px, int cor) {
    TextView t = new TextView(this);
    t.setTextSize(TypedValue.COMPLEX_UNIT_PX, px);
    t.setTextColor(cor);
    t.setGravity(Gravity.CENTER);
    return t;
  }
}
