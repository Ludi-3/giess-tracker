# 🌱 Gieß-Tracker

Kleine Web-App, die zeigt, welche Pflanzen heute gegossen werden müssen.
Läuft komplett im Browser, die Daten liegen im `localStorage`.

## Lokal testen
`index.html` im Browser öffnen, fertig.

## Auf GitHub Pages veröffentlichen
1. Neues Repository auf GitHub anlegen (öffentlich), z. B. `giess-tracker`
2. Die Dateien `index.html`, `style.css`, `app.js` und `README.md` hochladen
   (über „Add file → Upload files“ oder per `git push`)
3. **Settings → Pages → Branch: `main` / Ordner: `/ (root)`** → Save
4. Nach ca. 1 Minute erreichbar unter
   `https://<dein-username>.github.io/giess-tracker/`

## Ideen für die nächsten Schritte
- Pflanzen bearbeiten (Name/Intervall ändern)
- Gieß-Historie pro Pflanze speichern
- Export/Import als JSON (Backup, Gerätewechsel)
- Als PWA installierbar machen (App-Icon auf dem Handy)
- Umstieg auf Supabase → gleiche Daten auf allen Geräten
