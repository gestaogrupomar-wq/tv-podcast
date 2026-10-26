"""Copia o APK de release para o gestor (pasta public/) com a versão, para a Vercel publicar.

Uso (depois do gradle :app:assembleRelease):  python publicar-apk.py
Depois: git add public && git commit && git push  → a Vercel publica sozinha.
"""
import json, re, shutil, datetime, os

aqui = os.path.dirname(os.path.abspath(__file__))
apk = os.path.join(aqui, "tv-app/app/build/outputs/apk/release/app-release.apk")
gradle = open(os.path.join(aqui, "tv-app/app/build.gradle"), encoding="utf-8").read()
versao = re.search(r'versionName "([^"]+)"', gradle).group(1)

shutil.copyfile(apk, os.path.join(aqui, "public/tv-estudio.apk"))
kb = os.path.getsize(apk) / 1024
info = {"versao": versao, "data": datetime.date.today().strftime("%d/%m/%Y"),
        "tamanho": f"{kb / 1024:.1f} MB" if kb > 1024 else f"{kb:.0f} KB"}
json.dump(info, open(os.path.join(aqui, "public/versao.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("public/tv-estudio.apk atualizado:", info)
