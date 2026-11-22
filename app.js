// ===== Gieß-Tracker – Version mit Supabase =====
// Daten liegen in der Supabase-Datenbank, Fotos im Supabase-Speicher.
// Dadurch sehen alle Geräte, die mit demselben Konto angemeldet sind, dieselben Pflanzen.

// ---------- Fehler sichtbar machen statt leerer Seite ----------
let fatalShown = false;
function showFatal(message, force = true) {
  if (fatalShown && !force) return; // erste, genauere Meldung behalten
  fatalShown = true;
  document.getElementById("app-view").hidden = true;
  document.getElementById("login-view").hidden = false;
  const el = document.getElementById("login-error");
  el.textContent = message;
  el.hidden = false;
}
window.addEventListener("error", (e) => showFatal("Fehler: " + e.message, false));
window.addEventListener("unhandledrejection", (e) => showFatal("Fehler: " + (e.reason?.message || e.reason), false));

if (typeof supabase === "undefined") {
  showFatal("Die Supabase-Bibliothek konnte nicht geladen werden. Internetverbindung prüfen und neu laden.");
  throw new Error("supabase-js fehlt");
}
if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_KEY === "undefined") {
  showFatal("config.js ist fehlerhaft – bitte Anführungszeichen und Semikolons prüfen.");
  throw new Error("config.js fehlerhaft");
}

// URL bereinigen: Leerzeichen, "/rest/v1" und Schrägstrich am Ende entfernen
const CLEAN_URL = SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");

const db = supabase.createClient(CLEAN_URL, SUPABASE_KEY.trim());

// Sicherheitsnetz: Falls nach 5 Sekunden noch nichts angezeigt wird, Anmeldung zeigen
setTimeout(() => {
  if (document.getElementById("login-view").hidden && document.getElementById("app-view").hidden) {
    showFatal("Keine Verbindung zu Supabase – bitte URL und Key in config.js prüfen.");
  }
}, 5000);

const BUCKET = "plant-photos";
const PHOTO_MAX_SIZE = 800;          // Fotos werden auf max. 800 px verkleinert
const PHOTO_URL_LIFETIME = 60 * 60;  // Foto-Links gelten 1 Stunde (Sekunden)

let currentUser = null;
let plants = [];
let photoUrls = {};      // Zwischenspeicher: Fotopfad -> { url, expires }
let editingId = null;    // null = neue Pflanze, sonst ID der bearbeiteten Pflanze
let pendingPhoto = null; // neu ausgewähltes (verkleinertes) Foto

// ---------- Kurzschreibweise für Elemente ----------
const $ = (id) => document.getElementById(id);

// ---------- Datum-Helfer ----------
function todayString() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function parseDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysBetween(fromStr, toStr) {
  return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
}
function daysUntilDue(plant) {
  return plant.interval_days - daysBetween(plant.last_watered, todayString());
}
function badgeText(daysLeft) {
  if (daysLeft < 0)   return `Überfällig ${-daysLeft} T.`;
  if (daysLeft === 0) return "Heute gießen";
  if (daysLeft === 1) return "Morgen";
  return `In ${daysLeft} Tagen`;
}

// ---------- Rückmeldung unten ----------
let toastTimer;
function showToast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}

// ======================================================
// Anmeldung
// ======================================================

function showLogin() {
  currentUser = null;
  plants = [];
  $("app-view").hidden = true;
  $("login-view").hidden = false;
}

function showApp() {
  $("login-view").hidden = true;
  $("app-view").hidden = false;
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("login-btn");
  const errorEl = $("login-error");
  errorEl.hidden = true;
  btn.disabled = true;

  const { error } = await db.auth.signInWithPassword({
    email: $("login-email").value.trim(),
    password: $("login-password").value,
  });

  btn.disabled = false;
  if (error) {
    errorEl.textContent = "Anmeldung fehlgeschlagen – E-Mail oder Passwort falsch?";
    errorEl.hidden = false;
  }
  // Bei Erfolg meldet sich onAuthStateChange (unten) automatisch.
});

$("logout-btn").addEventListener("click", () => db.auth.signOut());

// Reagiert auf Anmelden, Abmelden und gespeicherte Sitzung beim App-Start
db.auth.onAuthStateChange((event, session) => {
  // setTimeout: Supabase empfiehlt, hier keine weiteren Aufrufe direkt zu starten
  setTimeout(() => {
    if (!session) {
      showLogin();
    } else if (!currentUser || currentUser.id !== session.user.id) {
      currentUser = session.user;
      showApp();
      loadPlants();
    }
  }, 0);
});

// ======================================================
// Daten laden und anzeigen
// ======================================================

async function loadPlants() {
  const { data, error } = await db.from("plants").select("*").order("created_at");
  if (error) {
    console.error(error);
    showToast("Pflanzen konnten nicht geladen werden");
    return;
  }
  plants = data;
  render();               // erst ohne neue Fotos anzeigen (schnell) …
  await loadPhotoUrls();  // … dann Foto-Links holen
  render();
}

// Fotos sind privat – wir holen zeitlich begrenzte Links dafür
async function loadPhotoUrls() {
  const now = Date.now();
  const needed = plants
    .map((p) => p.photo_path)
    .filter((path) => path && !(photoUrls[path] && photoUrls[path].expires > now));
  if (needed.length === 0) return;

  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(needed, PHOTO_URL_LIFETIME);
  if (error) { console.error(error); return; }

  for (const item of data) {
    if (item.signedUrl) {
      photoUrls[item.path] = {
        url: item.signedUrl,
        expires: now + (PHOTO_URL_LIFETIME - 60) * 1000, // 1 Min. Puffer
      };
    }
  }
}

function photoUrlFor(plant) {
  const entry = plant.photo_path && photoUrls[plant.photo_path];
  return entry ? entry.url : null;
}

function render() {
  const grid = $("plant-grid");
  grid.innerHTML = "";
  $("empty-hint").hidden = plants.length > 0;

  // Zusammenfassung oben
  const dueCount = plants.filter((p) => daysUntilDue(p) <= 0).length;
  $("summary").textContent =
    plants.length === 0 ? "" :
    dueCount === 0      ? "Alles gegossen ✓" :
    dueCount === 1      ? "1 Pflanze braucht Wasser" :
                          `${dueCount} Pflanzen brauchen Wasser`;

  // Dringendste zuerst
  const sorted = [...plants].sort((a, b) => daysUntilDue(a) - daysUntilDue(b));

  for (const plant of sorted) {
    const daysLeft = daysUntilDue(plant);

    const card = document.createElement("div");
    card.className = "plant-card";
    card.addEventListener("click", () => openSheet(plant));

    // Foto oder Platzhalter
    const url = photoUrlFor(plant);
    let photo;
    if (url) {
      photo = document.createElement("img");
      photo.src = url;
      photo.alt = plant.name;
      photo.loading = "lazy";
    } else {
      photo = document.createElement("div");
      photo.textContent = "🪴";
      photo.classList.add("placeholder");
    }
    photo.classList.add("plant-photo");

    const body = document.createElement("div");
    body.className = "plant-body";

    const name = document.createElement("div");
    name.className = "plant-name";
    name.textContent = plant.name;

    const badge = document.createElement("span");
    badge.className = "badge";
    if (daysLeft < 0) badge.classList.add("overdue");
    else if (daysLeft === 0) badge.classList.add("due");
    badge.textContent = badgeText(daysLeft);

    const waterBtn = document.createElement("button");
    waterBtn.className = "water-btn";
    waterBtn.textContent = "💧";
    waterBtn.setAttribute("aria-label", `${plant.name} gegossen`);
    waterBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // sonst öffnet sich zusätzlich das Bearbeiten-Fenster
      waterPlant(plant.id);
    });

    body.append(name, badge);
    card.append(photo, body, waterBtn);
    grid.append(card);
  }
}

// ======================================================
// Aktionen
// ======================================================

async function waterPlant(id) {
  const plant = plants.find((p) => p.id === id);
  if (!plant) return;

  const previous = plant.last_watered;
  plant.last_watered = todayString();
  render(); // sofort anzeigen, nicht auf den Server warten

  const { error } = await db.from("plants").update({ last_watered: plant.last_watered }).eq("id", id);
  if (error) {
    plant.last_watered = previous; // rückgängig machen
    render();
    showToast("Speichern fehlgeschlagen");
    return;
  }
  showToast(`💧 ${plant.name} gegossen`);
}

// ---------- Foto verkleinern ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild nicht lesbar")); };
    img.src = url;
  });
}

async function compressImage(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, PHOTO_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
}

$("photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingPhoto = await compressImage(file);
    showPhotoPreview(URL.createObjectURL(pendingPhoto));
  } catch {
    showToast("Foto konnte nicht gelesen werden");
  }
  e.target.value = ""; // erlaubt, dasselbe Foto nochmal zu wählen
});

function showPhotoPreview(url) {
  $("photo-preview").src = url || "";
  $("photo-preview").hidden = !url;
  $("photo-placeholder").hidden = !!url;
}

// ---------- Fenster öffnen / schließen ----------
function openSheet(plant = null) {
  editingId = plant ? plant.id : null;
  pendingPhoto = null;

  $("sheet-title").textContent = plant ? "Pflanze bearbeiten" : "Neue Pflanze";
  $("name").value = plant ? plant.name : "";
  $("interval").value = plant ? plant.interval_days : 7;
  $("last-watered").value = plant ? plant.last_watered : todayString();
  $("last-watered").max = todayString();
  $("delete-btn").hidden = !plant;
  showPhotoPreview(plant ? photoUrlFor(plant) : null);

  $("sheet-backdrop").hidden = false;
  $("sheet").hidden = false;
  requestAnimationFrame(() => {
    $("sheet-backdrop").classList.add("open");
    $("sheet").classList.add("open");
  });
}

function closeSheet() {
  $("sheet-backdrop").classList.remove("open");
  $("sheet").classList.remove("open");
  setTimeout(() => {
    $("sheet-backdrop").hidden = true;
    $("sheet").hidden = true;
  }, 250);
}

$("add-btn").addEventListener("click", () => openSheet());
$("cancel-btn").addEventListener("click", closeSheet);
$("sheet-backdrop").addEventListener("click", closeSheet);

// ---------- Speichern ----------
$("plant-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const saveBtn = $("save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Speichert …";

  try {
    const id = editingId || crypto.randomUUID();
    const fields = {
      name: $("name").value.trim(),
      interval_days: parseInt($("interval").value, 10),
      last_watered: $("last-watered").value,
    };

    // 1) Neues Foto hochladen (Ordner = Benutzer-ID, so verlangen es die Regeln)
    let oldPhotoPath = null;
    if (pendingPhoto) {
      const path = `${currentUser.id}/${id}-${Date.now()}.jpg`;
      const { error } = await db.storage.from(BUCKET).upload(path, pendingPhoto, { contentType: "image/jpeg" });
      if (error) throw error;
      fields.photo_path = path;
      if (editingId) oldPhotoPath = plants.find((p) => p.id === editingId)?.photo_path || null;
    }

    // 2) Datensatz anlegen oder ändern
    const { error } = editingId
      ? await db.from("plants").update(fields).eq("id", editingId)
      : await db.from("plants").insert({ id, ...fields });
    if (error) throw error;

    // 3) Altes Foto aufräumen
    if (oldPhotoPath) await db.storage.from(BUCKET).remove([oldPhotoPath]);

    closeSheet();
    showToast(editingId ? "Gespeichert" : `🌱 ${fields.name} angelegt`);
    await loadPlants();
  } catch (err) {
    console.error(err);
    showToast("Speichern fehlgeschlagen");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Speichern";
  }
});

// ---------- Löschen ----------
$("delete-btn").addEventListener("click", async () => {
  const plant = plants.find((p) => p.id === editingId);
  if (!plant) return;
  if (!confirm(`„${plant.name}“ wirklich löschen?`)) return;

  const { error } = await db.from("plants").delete().eq("id", plant.id);
  if (error) {
    showToast("Löschen fehlgeschlagen");
    return;
  }
  if (plant.photo_path) await db.storage.from(BUCKET).remove([plant.photo_path]);

  closeSheet();
  showToast(`${plant.name} gelöscht`);
  await loadPlants();
});

// ======================================================
// Sonstiges
// ======================================================

// Beim Zurückkehren in die App neu laden (z. B. wenn deine Frau inzwischen gegossen hat)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentUser) loadPlants();
});

// Service Worker registrieren (macht die Seite als App installierbar)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service Worker:", err));
}

// Hinweis, falls config.js noch nicht ausgefüllt ist
if (SUPABASE_URL.includes("DEIN-PROJEKT")) {
  $("login-view").hidden = false;
  $("login-error").textContent = "Bitte zuerst config.js mit deinen Supabase-Daten ausfüllen.";
  $("login-error").hidden = false;
}
