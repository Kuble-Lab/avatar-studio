let avatarImage = "";
const loginPanel = document.querySelector("#login-panel");
const settingsPanel = document.querySelector("#settings-panel");
const loginForm = document.querySelector("#login-form");
const passwordInput = document.querySelector("#admin-password");
const settingsForm = document.querySelector("#settings-form");
const promptEditor = document.querySelector("#system-prompt-editor");
const statusText = document.querySelector("#admin-status");
const metaText = document.querySelector("#settings-meta");
const resetButton = document.querySelector("#reset-button");
const logoutButton = document.querySelector("#logout-button");
const ragStats = document.querySelector("#rag-stats");
const ragSourceList = document.querySelector("#rag-source-list");
const ragSourceCount = document.querySelector("#rag-source-count");
const ragVersionList = document.querySelector("#rag-version-list");
const ragUploadForm = document.querySelector("#rag-upload-form");
const ragFileInput = document.querySelector("#rag-file-input");
const ragSourceForm = document.querySelector("#rag-source-form");
const ragSourcePath = document.querySelector("#rag-source-path");
const ragSourceContent = document.querySelector("#rag-source-content");
const ragSourceHeading = document.querySelector("#source-editor-heading");
const sourceCancelButton = document.querySelector("#source-cancel-button");
const ragRebuildButton = document.querySelector("#rag-rebuild-button");

let builtInSystemPrompt = "";
let maxSystemPromptLength = 24000;
let csrfToken = "";
let ragState = null;
let ragPollTimer = null;

function setStatus(message) {
  statusText.textContent = message;
}

function setAuthenticated(isAuthenticated) {
  loginPanel.hidden = isAuthenticated;
  settingsPanel.hidden = !isAuthenticated;
  if (!isAuthenticated) {
    stopRagPolling();
    requestAnimationFrame(() => passwordInput.focus());
  }
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" && csrfToken ? { "X-Avatar-CSRF": csrfToken } : {}),
      ...(options.headers || {})
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || result.error || `${path} failed`);
  }
  return result;
}

function renderSettings(settings) {
  const avatar = settings.avatar || {};
  document.getElementById("profile-name").value = avatar.name || "Alex";
  document.getElementById("profile-description").value = avatar.description || "";
  document.getElementById("profile-accent").value = avatar.accent || "#5369e8";
  document.getElementById("profile-voice").value = avatar.voice || "marin";
  document.getElementById("profile-mode").value = avatar.answerMode || "avatar";
  document.getElementById("profile-greeting").value = avatar.greeting || "";
  document.getElementById("profile-style").value = avatar.voiceStyle || "";
  avatarImage = avatar.image || "";
  renderAvatarImage();
  csrfToken = settings.csrfToken || csrfToken;
  builtInSystemPrompt = settings.builtInSystemPrompt || "";
  maxSystemPromptLength = settings.maxSystemPromptLength || maxSystemPromptLength;
  promptEditor.maxLength = maxSystemPromptLength;
  promptEditor.value = settings.systemPrompt || "";
  promptEditor.setSelectionRange(0, 0);
  promptEditor.scrollTop = 0;
  const count = promptEditor.value.length;
  const source = settings.usingOverride ? "Custom Prompt aktiv" : "Default Prompt aktiv";
  const updated = settings.updatedAt
    ? ` · gespeichert ${new Date(settings.updatedAt).toLocaleString("de-CH")}`
    : "";
  metaText.textContent = `${source} · ${count}/${settings.maxSystemPromptLength} Zeichen${updated}`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "Noch nicht erstellt";
  return new Date(value).toLocaleString("de-CH");
}

function statCard(label, value, tone = "") {
  const card = document.createElement("div");
  card.className = `stat-card${tone ? ` ${tone}` : ""}`;
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = value;
  card.append(labelNode, valueNode);
  return card;
}

function sourceButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function renderSources(sources = []) {
  ragSourceList.replaceChildren();
  ragSourceCount.textContent = `${sources.length} Dateien`;
  if (!sources.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Noch keine Wissensquellen vorhanden.";
    ragSourceList.append(empty);
    return;
  }

  sources.forEach((source) => {
    const row = document.createElement("article");
    row.className = "source-row";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = source.path;
    const meta = document.createElement("span");
    meta.textContent = `${formatBytes(source.size)} · ${source.chunks} Chunks · ${formatDate(source.updatedAt)}`;
    info.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(sourceButton("Bearbeiten", "ghost-button small-button", () => editSource(source.path)));
    if (!source.protected) {
      actions.append(sourceButton("Löschen", "danger-button small-button", () => deleteSource(source.path)));
    }
    row.append(info, actions);
    ragSourceList.append(row);
  });
}

function renderVersions(versions = []) {
  ragVersionList.replaceChildren();
  if (!versions.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Noch keine frühere Version archiviert.";
    ragVersionList.append(empty);
    return;
  }
  versions.forEach((version) => {
    const row = document.createElement("article");
    row.className = "version-row";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = formatDate(version.archivedAt);
    const meta = document.createElement("span");
    meta.textContent = `${version.chunks} Chunks · ${version.sources} Dateien · ${version.reason}`;
    info.append(title, meta);
    row.append(info, sourceButton("Wiederherstellen", "ghost-button small-button", () => rollbackVersion(version.id)));
    ragVersionList.append(row);
  });
}

function renderRag(rag) {
  ragState = rag;
  const build = rag.build || {};
  const running = build.status === "running";
  ragRebuildButton.disabled = running;
  ragRebuildButton.textContent = running ? "Index wird aufgebaut …" : "Änderungen veröffentlichen";

  ragStats.replaceChildren(
    statCard("Status", running ? "Wird aufgebaut" : rag.dirty ? "Änderungen offen" : "Aktuell", rag.dirty ? "warning" : "success"),
    statCard("Index", `${rag.index?.chunks || 0} Chunks`),
    statCard("Letzte Veröffentlichung", formatDate(rag.index?.generatedAt)),
    statCard("Embeddings", rag.index?.hasEmbeddings ? rag.index.embeddingModel || "Aktiv" : "Nicht vorhanden", rag.index?.hasEmbeddings ? "success" : "warning")
  );
  renderSources(rag.sources || []);
  renderVersions(rag.versions || []);

  if (build.status === "failed") setStatus(`RAG-Aufbau fehlgeschlagen: ${build.error}`);
  if (running) startRagPolling();
  else stopRagPolling();
}

async function loadSettings() {
  const settings = await api("/api/admin/settings");
  renderSettings(settings);
}

async function loadRag({ quiet = false } = {}) {
  try {
    const rag = await api("/api/admin/rag");
    renderRag(rag);
    return rag;
  } catch (error) {
    if (!quiet) setStatus(error.message);
    throw error;
  }
}

function startRagPolling() {
  if (ragPollTimer) return;
  ragPollTimer = window.setInterval(async () => {
    try {
      const previousStatus = ragState?.build?.status;
      const rag = await loadRag({ quiet: true });
      if (previousStatus === "running" && rag.build?.status === "succeeded") {
        setStatus("Das zentrale RAG wurde veröffentlicht. Alle Avatar verwenden jetzt diesen Stand.");
      }
    } catch {
      // The visible status is preserved while the next poll retries.
    }
  }, 2000);
}

function stopRagPolling() {
  if (!ragPollTimer) return;
  window.clearInterval(ragPollTimer);
  ragPollTimer = null;
}

async function boot() {
  try {
    const status = await api("/api/admin/status");
    if (!status.configured) {
      setAuthenticated(false);
      setStatus("Admin-Passwort ist nicht konfiguriert.");
      return;
    }
    csrfToken = status.csrfToken || "";
    setAuthenticated(status.authenticated);
    if (status.authenticated) {
      await Promise.all([loadSettings(), loadRag()]);
      setStatus("");
    }
  } catch (error) {
    setAuthenticated(false);
    setStatus(error.message);
  }
}

async function editSource(path) {
  setStatus("Quelle wird geladen …");
  try {
    const source = await api(`/api/admin/rag/source?path=${encodeURIComponent(path)}`);
    ragSourceHeading.textContent = source.path;
    ragSourcePath.value = source.path;
    ragSourceContent.value = source.content;
    ragSourceForm.hidden = false;
    ragSourceForm.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
}

async function deleteSource(path) {
  if (!window.confirm(`Wissensquelle „${path}“ wirklich löschen? Die Änderung wird erst nach dem Veröffentlichen aktiv.`)) return;
  setStatus("Quelle wird gelöscht …");
  try {
    const result = await api("/api/admin/rag/source", {
      method: "DELETE",
      body: JSON.stringify({ path })
    });
    renderRag(result.rag);
    setStatus("Quelle gelöscht. Bitte Änderungen veröffentlichen.");
  } catch (error) {
    setStatus(error.message);
  }
}

async function rollbackVersion(versionId) {
  if (!window.confirm("Diese frühere RAG-Version inklusive Wissensdateien wiederherstellen?")) return;
  setStatus("Frühere RAG-Version wird wiederhergestellt …");
  try {
    const result = await api("/api/admin/rag/rollback", {
      method: "POST",
      body: JSON.stringify({ versionId })
    });
    renderRag(result.rag);
    setStatus("Frühere RAG-Version wurde wiederhergestellt und ist sofort aktiv.");
  } catch (error) {
    setStatus(error.message);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Login wird geprüft …");
  try {
    const result = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: passwordInput.value })
    });
    csrfToken = result.csrfToken || "";
    passwordInput.value = "";
    setAuthenticated(true);
    await Promise.all([loadSettings(), loadRag()]);
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Konfiguration wird gespeichert …");
  try {
    const settings = await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ systemPrompt: promptEditor.value, avatar: {
 name: document.getElementById("profile-name").value,
 description: document.getElementById("profile-description").value,
 accent: document.getElementById("profile-accent").value,
 voice: document.getElementById("profile-voice").value,
 answerMode: document.getElementById("profile-mode").value,
 greeting: document.getElementById("profile-greeting").value,
 voiceStyle: document.getElementById("profile-style").value,
 image: avatarImage
} })
    });
    renderSettings(settings);
    setStatus("Konfiguration gespeichert. Öffne den Avatar neu, um die Änderungen zu sehen.");
  } catch (error) {
    setStatus(error.message);
  }
});

ragUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = Array.from(ragFileInput.files || []);
  if (!files.length) {
    setStatus("Bitte mindestens eine Markdown- oder Textdatei auswählen.");
    return;
  }
  setStatus(`${files.length} Wissensdatei${files.length === 1 ? "" : "en"} werden übernommen …`);
  try {
    for (const file of files) {
      const path = `03-rag-quellen/${file.name}`;
      await api("/api/admin/rag/source", {
        method: "PUT",
        body: JSON.stringify({ path, content: await file.text() })
      });
    }
    ragFileInput.value = "";
    await loadRag();
    setStatus("Dateien übernommen. Bitte Änderungen veröffentlichen.");
  } catch (error) {
    setStatus(error.message);
  }
});

ragSourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Wissensquelle wird gespeichert …");
  try {
    const result = await api("/api/admin/rag/source", {
      method: "PUT",
      body: JSON.stringify({ path: ragSourcePath.value, content: ragSourceContent.value })
    });
    renderRag(result.rag);
    ragSourceForm.hidden = true;
    setStatus("Quelle gespeichert. Bitte Änderungen veröffentlichen.");
  } catch (error) {
    setStatus(error.message);
  }
});

sourceCancelButton.addEventListener("click", () => {
  ragSourceForm.hidden = true;
});

ragRebuildButton.addEventListener("click", async () => {
  setStatus("Der neue zentrale RAG-Index wird gestartet …");
  try {
    const rag = await api("/api/admin/rag/rebuild", { method: "POST", body: "{}" });
    renderRag(rag);
    setStatus("Der Index wird im Hintergrund aufgebaut. Der bisherige Stand bleibt bis zum Abschluss aktiv.");
  } catch (error) {
    setStatus(error.message);
  }
});

resetButton.addEventListener("click", () => {
  promptEditor.value = builtInSystemPrompt;
  promptEditor.setSelectionRange(0, 0);
  promptEditor.scrollTop = 0;
  metaText.textContent = `Default geladen · ${promptEditor.value.length} Zeichen · noch nicht gespeichert`;
});

logoutButton.addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST", body: "{}" }).catch(() => null);
  csrfToken = "";
  setAuthenticated(false);
  setStatus("");
});

promptEditor.addEventListener("input", () => {
  metaText.textContent = `${promptEditor.value.length}/${maxSystemPromptLength} Zeichen`;
});

boot();


function renderAvatarImage() {
 const preview = document.getElementById("profile-image-preview");
 preview.hidden = !avatarImage;
 if (avatarImage) preview.src = avatarImage; else preview.removeAttribute("src");
}
document.getElementById("profile-image-file").addEventListener("change", async event => {
 const file = event.target.files[0]; if (!file) return;
 if (file.size > 1000000 || !["image/png","image/jpeg","image/webp"].includes(file.type)) {
   setStatus("Bitte PNG, JPEG oder WebP mit maximal 1 MB wählen."); event.target.value = ""; return;
 }
 const reader = new FileReader();
 reader.onload = () => { avatarImage = reader.result; renderAvatarImage(); setStatus("Bild ausgewählt. Konfiguration speichern, um es zu übernehmen."); };
 reader.onerror = () => setStatus("Bild konnte nicht gelesen werden.");
 reader.readAsDataURL(file);
});
document.getElementById("remove-avatar-image").addEventListener("click", () => {
 avatarImage = ""; document.getElementById("profile-image-file").value = ""; renderAvatarImage();
});
