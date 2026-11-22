// ===== Gieß-Tracker =====
// Alle Daten liegen im Browser (localStorage) – kein Server nötig.

const STORAGE_KEY = "giess-tracker-plants";

// ---------- Datum-Helfer ----------
// Daten werden als "YYYY-MM-DD" gespeichert (lokales Datum, keine Zeitzonenprobleme).

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
  const ms = parseDate(toStr) - parseDate(fromStr);
  return Math.round(ms / 86400000); // runden gleicht Sommer-/Winterzeit aus
}

function formatDate(str) {
  return parseDate(str).toLocaleDateString("de-DE");
}

// ---------- Speicher ----------

function loadPlants() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function savePlants(plants) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plants));
  } catch (e) {
    console.warn("Speichern fehlgeschlagen:", e);
  }
}

let plants = loadPlants();

// ---------- Logik ----------

// Tage bis zum nächsten Gießen (negativ = überfällig)
function daysUntilDue(plant) {
  const sinceWatered = daysBetween(plant.lastWatered, todayString());
  return plant.interval - sinceWatered;
}

function statusText(daysLeft) {
  if (daysLeft < 0)  return `Überfällig seit ${-daysLeft} Tag${daysLeft === -1 ? "" : "en"}`;
  if (daysLeft === 0) return "Heute gießen";
  if (daysLeft === 1) return "Morgen gießen";
  return `In ${daysLeft} Tagen gießen`;
}

// ---------- Darstellung ----------

const listEl = document.getElementById("plant-list");
const emptyHint = document.getElementById("empty-hint");

function render() {
  listEl.innerHTML = "";
  emptyHint.hidden = plants.length > 0;

  // Dringendste zuerst
  const sorted = [...plants].sort((a, b) => daysUntilDue(a) - daysUntilDue(b));

  for (const plant of sorted) {
    const daysLeft = daysUntilDue(plant);

    const li = document.createElement("li");
    li.className = "plant";
    if (daysLeft < 0) li.classList.add("overdue");
    else if (daysLeft === 0) li.classList.add("due");

    const info = document.createElement("div");
    info.className = "plant-info";

    const name = document.createElement("div");
    name.className = "plant-name";
    name.textContent = plant.name; // textContent statt innerHTML = sicher gegen HTML-Injection

    const status = document.createElement("div");
    status.className = "plant-status";
    status.textContent =
      `${statusText(daysLeft)} · alle ${plant.interval} Tage · zuletzt ${formatDate(plant.lastWatered)}`;

    info.append(name, status);

    const waterBtn = document.createElement("button");
    waterBtn.textContent = "💧 Gegossen";
    waterBtn.addEventListener("click", () => waterPlant(plant.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "secondary";
    deleteBtn.textContent = "Löschen";
    deleteBtn.addEventListener("click", () => deletePlant(plant.id));

    li.append(info, waterBtn, deleteBtn);
    listEl.append(li);
  }
}

// ---------- Aktionen ----------

function addPlant(name, interval, lastWatered) {
  plants.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    interval,
    lastWatered,
  });
  savePlants(plants);
  render();
}

function waterPlant(id) {
  const plant = plants.find(p => p.id === id);
  if (!plant) return;
  plant.lastWatered = todayString();
  savePlants(plants);
  render();
}

function deletePlant(id) {
  plants = plants.filter(p => p.id !== id);
  savePlants(plants);
  render();
}

// ---------- Formular ----------

const form = document.getElementById("plant-form");
const nameInput = document.getElementById("name");
const intervalInput = document.getElementById("interval");
const lastWateredInput = document.getElementById("last-watered");

lastWateredInput.value = todayString();
lastWateredInput.max = todayString();

form.addEventListener("submit", (event) => {
  event.preventDefault(); // verhindert Neuladen der Seite
  const name = nameInput.value.trim();
  const interval = parseInt(intervalInput.value, 10);
  if (!name || !(interval > 0)) return;

  addPlant(name, interval, lastWateredInput.value);

  form.reset();
  intervalInput.value = 7;
  lastWateredInput.value = todayString();
  nameInput.focus();
});

render();
