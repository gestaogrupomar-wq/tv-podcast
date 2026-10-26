# TV do Podcast — Grupo Mar

Painel web (Vercel) para mandar fotos e vídeos que passam em loop na TV da sala de podcast, e o app
Android da TV que toca a playlist.

- `public/` painel (senha única) · `api/` funções: sessao, upload (token do Vercel Blob), playlist, tv
- `tv-app/` app da TV (Java puro). TV: TCL MT5867 em **192.168.0.157:5555**, app é a tela inicial
  (`com.google.android.tvlauncher` desativado; voltar com `pm enable`).

## Vercel (projeto tv-podcast-grupomar)
Variáveis: `PAINEL_SENHA`, `BLOB_READ_WRITE_TOKEN` (Blob store ligado ao projeto) e `KV_REST_API_URL` /
`KV_REST_API_TOKEN` (o mesmo Upstash da Redação TV; chaves `podcast:*`).
Commits precisam ter autor da conta gestaogrupomar-wq (Hobby bloqueia outros) — já configurado no repo.

## App da TV
Baixa cada arquivo uma vez (files/midia), toca do disco, confere a playlist a cada 30 s e avisa o
status em `/api/tv`. MENU no controle abre as Configurações da TV.
Build: `JAVA_HOME=C:/Users/owmat/Android/jdk-17.0.20.1+1 gradle :app:assembleRelease` em tv-app/.
Chave `chave-podcast.jks` + `chave.properties` ficam só aqui (fora do git).

## Limpeza da TV (26/10/2026)
Desinstalados: Apple TV, ViX, Paramount (cbs.ca), Disney+, Star+, Globoplay, Spotify, Pluto. Removidos p/
usuário 0 (com atualizações e dados): os mesmos de fábrica da TV da redação. Mantidos: Downloader e
Adeus Pendrive. Espaço livre: 103 MB → 1,2 GB.
