// app.js — Liaison UI <-> moteur (engine.js)

let outputEl, inputEl, toastsEl, sidebarEl, statusEl, promptLabelEl, themeToggleEl, soundToggleEl;
let fxToggleEl, badgesEl, xpFillEl, xpLabelEl, particlesCanvasEl, ambientToggleEl, voiceToggleEl;

const THEME_KEY = "ctf_lab_theme_v1";
const SOUND_KEY = "ctf_lab_sound_v1";
const FX_KEY = "ctf_lab_fx_v1";
const AMBIENT_KEY = "ctf_lab_ambient_v1";
const VOICE_KEY = "ctf_lab_voice_v1";
let soundEnabled = true;
let fxEnabled = true;
let ambientEnabled = false;
let voiceEnabled = false;
let audioCtx = null;
let ambientNodes = null;
let ambientCurrentKey = null;

// Un preset par palier de difficulté : plus c'est dur, plus le fond sonore descend et se tend
// (fréquence de base plus basse, détune plus large, filtre plus fermé, LFO plus rapide).
const AMBIENT_PRESETS = {
  attacker:  { base: 130, spread: [1, 1.5, 2],     detune: 2,  filterHz: 1200, filterQ: 0.5, lfoHz: 0.05, gain: 0.03,  wave: "sine" },
  Facile:    { base: 110, spread: [1, 1.5, 2],      detune: 3,  filterHz: 900,  filterQ: 0.7, lfoHz: 0.07, gain: 0.035, wave: "sine" },
  Moyen:     { base: 98,  spread: [1, 1.5, 2.01],   detune: 6,  filterHz: 750,  filterQ: 1.0, lfoHz: 0.10, gain: 0.035, wave: "sine" },
  Difficile: { base: 82,  spread: [1, 1.5, 1.98],   detune: 10, filterHz: 600,  filterQ: 1.4, lfoHz: 0.16, gain: 0.032, wave: "triangle" },
  Expert:    { base: 73,  spread: [1, 1.49, 2.01],  detune: 16, filterHz: 480,  filterQ: 1.8, lfoHz: 0.22, gain: 0.030, wave: "triangle" },
  Insane:    { base: 65,  spread: [1, 1.48, 2.02],  detune: 26, filterHz: 380,  filterQ: 2.4, lfoHz: 0.32, gain: 0.028, wave: "sawtooth" },
};

function loadTheme() {
  try { return localStorage.getItem(THEME_KEY) || "dark"; } catch (e) { return "dark"; }
}
const THEME_CYCLE = ["dark", "light", "contrast"];
const THEME_ICONS = { dark: "🌙", light: "☀️", contrast: "◐" };
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  if (themeToggleEl) {
    themeToggleEl.textContent = THEME_ICONS[theme] || "🌙";
    themeToggleEl.title = theme === "contrast" ? "Thème contraste élevé (accessibilité)" : "Changer de thème";
  }
}
function loadSoundPref() {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === null ? true : v === "on";
  } catch (e) { return true; }
}
function applySoundToggleUI() {
  if (soundToggleEl) soundToggleEl.textContent = soundEnabled ? "🔈" : "🔇";
}
function playFlagSound() {
  if (!soundEnabled) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.15, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    });
  } catch (e) {}
}
function loadFxPref() {
  try {
    const v = localStorage.getItem(FX_KEY);
    return v === null ? true : v === "on";
  } catch (e) { return true; }
}
function applyFx() {
  document.documentElement.classList.toggle("fx-on", fxEnabled);
  if (fxToggleEl) fxToggleEl.textContent = fxEnabled ? "✨" : "🚫";
}

function loadAmbientPref() {
  try { return localStorage.getItem(AMBIENT_KEY) === "on"; } catch (e) { return false; }
}
function applyAmbientToggleUI() {
  if (!ambientToggleEl) return;
  ambientToggleEl.textContent = ambientEnabled ? "🎵" : "🎧";
  ambientToggleEl.classList.toggle("active", ambientEnabled);
  ambientToggleEl.title = ambientEnabled
    ? "Ambiance sonore continue (activée — clique pour couper)"
    : "Ambiance sonore continue (générée, varie selon la difficulté)";
}
function stopAmbient() {
  if (!ambientNodes || !audioCtx) { ambientNodes = null; ambientCurrentKey = null; return; }
  try {
    const now = audioCtx.currentTime;
    const nodes = ambientNodes;
    nodes.masterGain.gain.cancelScheduledValues(now);
    nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
    nodes.masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.4);
    setTimeout(() => {
      nodes.oscs.forEach((o) => { try { o.stop(); } catch (e) {} });
      try { nodes.lfo.stop(); } catch (e) {}
    }, 450);
  } catch (e) {}
  ambientNodes = null;
  ambientCurrentKey = null;
}
function startAmbient(presetKey) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const preset = AMBIENT_PRESETS[presetKey] || AMBIENT_PRESETS.attacker;
    const now = audioCtx.currentTime;

    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(preset.gain, now + 1.2);

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = preset.filterHz;
    filter.Q.value = preset.filterQ;
    filter.connect(masterGain).connect(audioCtx.destination);

    const oscs = preset.spread.map((mult, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = preset.wave;
      osc.frequency.value = preset.base * mult;
      osc.detune.value = (i - 1) * preset.detune;
      const oscGain = audioCtx.createGain();
      oscGain.gain.value = 1 / preset.spread.length;
      osc.connect(oscGain).connect(filter);
      osc.start(now);
      return osc;
    });

    // LFO qui module doucement la coupure du filtre, pour un fond "vivant" plutôt qu'un drone figé.
    const lfo = audioCtx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = preset.lfoHz;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = preset.filterHz * 0.35;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start(now);

    ambientNodes = { oscs, lfo, filter, masterGain };
    ambientCurrentKey = presetKey;
  } catch (e) {}
}
// Bascule le preset d'ambiance selon la machine courante (silencieux si le mode est désactivé).
function updateAmbientForContext() {
  if (!ambientEnabled) return;
  let key = "attacker";
  if (typeof SESSION !== "undefined" && SESSION.ctx && SESSION.ctx !== "attacker" && typeof MACHINES !== "undefined") {
    const m = MACHINES.find((mm) => mm.id === SESSION.ctx);
    if (m) key = m.difficulty;
  }
  if (key === ambientCurrentKey) return;
  stopAmbient();
  startAmbient(key);
}

// ── Narration vocale (SpeechSynthesis, zéro dépendance) ──────────────────────
// Lit à voix haute les indices (hint/chint) et les messages importants (toasts : flags,
// badges, déblocages). Ne lit jamais les listings bruts (ls, cat, nmap...) pour rester utile.
function loadVoicePref() {
  try { return localStorage.getItem(VOICE_KEY) === "on"; } catch (e) { return false; }
}
function applyVoiceToggleUI() {
  if (!voiceToggleEl) return;
  voiceToggleEl.classList.toggle("active", voiceEnabled);
  voiceToggleEl.title = voiceEnabled
    ? "Narration vocale des indices et messages importants (activée — clique pour couper)"
    : "Narration vocale des indices et messages importants";
}
function stripForSpeech(text) {
  return String(text)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "") // emojis
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
function speak(text) {
  if (!voiceEnabled || !("speechSynthesis" in window)) return;
  const clean = stripForSpeech(text);
  if (!clean) return;
  try {
    window.speechSynthesis.cancel(); // évite d'empiler les phrases si plusieurs messages arrivent vite
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = "fr-FR";
    utter.rate = 1.0;
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}
function spawnFlagParticles() {
  if (!fxEnabled || !particlesCanvasEl) return;
  const canvas = particlesCanvasEl;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.display = "block";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ["#3ddc84", "#4fd8e6", "#f2c94c", "#b98cf2"];
  const originX = window.innerWidth / 2;
  const originY = window.innerHeight / 2.6;
  const particles = Array.from({ length: 90 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    return {
      x: originX, y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      life: 1,
      decay: 0.008 + Math.random() * 0.012,
      size: 2 + Math.random() * 3,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });

  let raf;
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach((p) => {
      if (p.life <= 0) return;
      alive = true;
      p.vy += 0.06; // gravité légère
      p.x += p.vx; p.y += p.vy;
      p.life -= p.decay;
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1;
    if (alive) {
      raf = requestAnimationFrame(tick);
    } else {
      canvas.style.display = "none";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  cancelAnimationFrame(raf);
  tick();
}

function downloadText(filename, text, mimeType) {
  try {
    const blob = new Blob([text], { type: (mimeType || "text/markdown") + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {}
}

// ── Éditeur de machines (Phase 4) ────────────────────────────────────────────
const EDITOR_TEMPLATE = JSON.stringify({
  id: "sandbox",
  name: "SANDBOX",
  ip: "10.99.0.1",
  difficulty: "Facile",
  os: "Linux (Debian 12)",
  briefing: "Une machine de démonstration créée dans l'éditeur.",
  ports: [{ port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 9.2p1" }],
  web: {},
  ftp: { enabled: false },
  sshUsers: { guest: { password: "guest123" } },
  targetFS: {
    hostname: "sandbox",
    homeDir: "/home/guest",
    users: {
      guest: {
        home: "/home/guest",
        fs: {
          "user.txt": { type: "file", content: "FLAG{sandbox_user}", perms: "-rw-r-----", owner: "guest" },
        },
      },
    },
    extraFS: {},
    sudoL: "L'utilisateur guest peut lancer :\n    (root) NOPASSWD: /usr/bin/less",
  },
  privesc: {
    type: "sudo-gtfobins",
    exploitCmdRegex: "^sudo\\s+(/usr/bin/)?less\\s+/etc/hostname$",
    pagerEscapeRegex: "^!/?(bin/)?sh$|^!bash$",
    enterMsg: "(pager root ouvert — tape !sh pour un shell)",
  },
  rootFile: { path: "/root/root.txt", content: "FLAG{sandbox_root}" },
  hints: {
    recon: ["Scanne les ports (`nmap 10.99.0.1`)."],
    access: ["Connecte-toi avec `ssh guest@10.99.0.1` (mot de passe guest123)."],
    privesc: ["`sudo less /etc/hostname` puis `!sh` dans le pager."],
  },
}, null, 2);

function editorEl(id) { return document.getElementById(id); }
function openEditor() {
  const ta = editorEl("editor-json");
  if (ta && !ta.value.trim()) ta.value = EDITOR_TEMPLATE;
  editorEl("editor-modal").classList.remove("hidden");
  if (ta) ta.focus();
}
function closeEditor() { editorEl("editor-modal").classList.add("hidden"); }
function setEditorMsg(html, cls) {
  const el = editorEl("editor-msg");
  el.className = "editor-msg" + (cls ? " " + cls : "");
  el.innerHTML = html;
}
function loadFromEditor() {
  const json = editorEl("editor-json").value;
  const res = loadCustomMachine(json);
  if (!res.ok) {
    setEditorMsg("❌ Machine refusée :<ul>" + res.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("") + "</ul>", "err");
    return;
  }
  setEditorMsg(`✅ « ${escapeHtml(res.machine.name)} » chargée et déverrouillée — bascule sur le terminal pour la jouer.`, "ok");
  renderSidebar();
  closeEditor();
  inputEl.value = "use " + res.machine.id;
  submitInput();
  printLine(`🛠️ Machine custom « ${res.machine.name} » ajoutée au lab (bac à sable, non sauvegardée). Tape \`machines\` pour la voir.`, "t-hint");
}
function downloadFromEditor() {
  const json = editorEl("editor-json").value;
  let id = "machine";
  try { id = (JSON.parse(json).id || "machine").replace(/[^a-z0-9_-]/gi, "") || "machine"; } catch (e) {}
  downloadText(`${id}.json`, json, "application/json");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Export / import de sauvegarde chiffrée (Web Crypto, zéro backend) ───────
// Format du fichier .json.enc : { format: "ctf-lab-save", v: 1, salt, iv, data } (tout en base64
// sauf format/v). Chiffrement AES-GCM 256, clé dérivée de la passphrase via PBKDF2-SHA256
// (150000 itérations). La passphrase n'est jamais stockée ni envoyée nulle part.
let PENDING_IMPORT = false;
let pendingImportEnvelope = null;

function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }

async function deriveSaveKey(passphrase, salt, usages) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}
async function encryptSaveBlob(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveSaveKey(passphrase, salt, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { format: "ctf-lab-save", v: 1, salt: bufToB64(salt), iv: bufToB64(iv), data: bufToB64(ciphertext) };
}
async function decryptSaveBlob(envelope, passphrase) {
  const key = await deriveSaveKey(passphrase, b64ToBuf(envelope.salt), ["decrypt"]);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(envelope.iv) }, key, b64ToBuf(envelope.data));
  return new TextDecoder().decode(plainBuf);
}

async function handleExportCommand(args) {
  const passphrase = args.join(" ").trim();
  if (!passphrase) { printLine("usage: export <passphrase>", "t-err"); return; }
  if (passphrase.length < 4) { printLine("La passphrase doit faire au moins 4 caractères.", "t-err"); return; }
  if (!(window.crypto && window.crypto.subtle)) {
    printLine("Web Crypto indisponible dans ce navigateur (nécessite un contexte sécurisé, https ou localhost).", "t-err");
    return;
  }
  printLine("🔐 Chiffrement de la sauvegarde en cours...", "t-hint");
  try {
    const envelope = await encryptSaveBlob(JSON.stringify(GAME), passphrase);
    const filename = `ctf-lab-save-${new Date().toISOString().slice(0, 10)}.json.enc`;
    downloadText(filename, JSON.stringify(envelope), "application/json");
    printLine(`💾 Sauvegarde chiffrée exportée (${filename}). Garde bien la passphrase : elle n'est stockée nulle part et ne peut pas être récupérée.`, "t-ok");
  } catch (e) {
    printLine("❌ Échec du chiffrement de la sauvegarde.", "t-err");
  }
}

function handleImportCommand() {
  if (!(window.crypto && window.crypto.subtle)) {
    printLine("Web Crypto indisponible dans ce navigateur (nécessite un contexte sécurisé, https ou localhost).", "t-err");
    return;
  }
  const inputFile = document.createElement("input");
  inputFile.type = "file";
  inputFile.accept = ".enc,.json,application/json";
  inputFile.style.display = "none";
  inputFile.addEventListener("change", () => {
    const file = inputFile.files && inputFile.files[0];
    document.body.removeChild(inputFile);
    if (!file) { printLine("Import annulé (aucun fichier choisi).", "t-hint"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      let envelope;
      try { envelope = JSON.parse(reader.result); } catch (e) { envelope = null; }
      if (!envelope || envelope.format !== "ctf-lab-save" || !envelope.salt || !envelope.iv || !envelope.data) {
        printLine("Fichier invalide : ce n'est pas une sauvegarde CTF Lab exportée valide.", "t-err");
        return;
      }
      pendingImportEnvelope = envelope;
      PENDING_IMPORT = true;
      printLine(`Fichier "${file.name}" chargé. Entre la passphrase utilisée à l'export :`, "t-hint");
      updatePromptLabel();
    };
    reader.onerror = () => printLine("Impossible de lire ce fichier.", "t-err");
    reader.readAsText(file);
  });
  document.body.appendChild(inputFile);
  inputFile.click();
}

async function finishImport(passphrase) {
  PENDING_IMPORT = false;
  const envelope = pendingImportEnvelope;
  pendingImportEnvelope = null;
  if (!envelope) { printLine("Aucun fichier en attente d'import.", "t-err"); return; }
  try {
    const plaintext = await decryptSaveBlob(envelope, passphrase);
    const data = JSON.parse(plaintext);
    GAME = sanitizeGameState(data);
    persistSave();
    renderSidebar();
    updatePromptLabel();
    printLine(`✅ Sauvegarde importée avec succès (score : ${GAME.score} pts). Progression, badges et défis Jeopardy restaurés.`, "t-ok");
  } catch (e) {
    printLine("❌ Échec de l'import : passphrase incorrecte, ou fichier corrompu/altéré. Retape `import` pour réessayer.", "t-err");
  }
}

let histIndex = -1;

function updatePromptLabel() {
  if (!promptLabelEl) return;
  promptLabelEl.textContent = PENDING_SSH ? "mot de passe :" : promptString();
  inputEl.type = PENDING_SSH ? "password" : "text";
}

const FLAG_RE = /FLAG\{[^}]+\}/;

function printLine(text, cls) {
  if (text === "") return;
  (text || "").split("\n").forEach((l) => {
    const d = document.createElement("div");
    d.className = "t-line " + (cls || "t-out");
    const m = l.match(FLAG_RE);
    if (m) {
      const flag = m[0];
      if (m.index > 0) d.appendChild(document.createTextNode(l.slice(0, m.index)));
      const flagSpan = document.createElement("span");
      flagSpan.className = "flag-value";
      flagSpan.textContent = flag;
      d.appendChild(flagSpan);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "flag-copy-btn";
      btn.textContent = "📋 copier";
      btn.addEventListener("click", (e) => { e.stopPropagation(); copyFlag(flag, btn); });
      d.appendChild(btn);
      const rest = l.slice(m.index + flag.length);
      if (rest) d.appendChild(document.createTextNode(rest));
    } else {
      d.textContent = l;
    }
    outputEl.appendChild(d);
  });
  outputEl.scrollTop = outputEl.scrollHeight;
}
function copyFlag(flag, btn) {
  const original = btn.textContent;
  const onDone = () => {
    btn.textContent = "✅ copié";
    setTimeout(() => { btn.textContent = original; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(flag).then(onDone).catch(() => fallbackCopy(flag, onDone));
  } else {
    fallbackCopy(flag, onDone);
  }
}
function fallbackCopy(text, onDone) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
  onDone();
}
function printPrompt(cmdText) {
  const d = document.createElement("div");
  d.className = "t-line t-prompt";
  d.textContent = promptString() + " " + cmdText;
  outputEl.appendChild(d);
}
function promptString() {
  if (PENDING_SSH) return "";
  if (SESSION.vimMode) return "-- INSERT --";
  if (SESSION.ctx !== "attacker" && getMachine(SESSION.ctx).osType === "windows") {
    return `PS ${winPath(SESSION.cwd)}>`;
  }
  const user = SESSION.user;
  const host = SESSION.host;
  const cwd = displayPath(SESSION.cwd, SESSION.home);
  const sym = user === "root" ? "#" : "$";
  return `${user}@${host}:${cwd}${sym}`;
}
function clearTerminal() { outputEl.innerHTML = ""; }

function toast(msg) {
  const d = document.createElement("div");
  d.className = "toast";
  d.textContent = msg;
  toastsEl.appendChild(d);
  requestAnimationFrame(() => d.classList.add("show"));
  setTimeout(() => {
    d.classList.remove("show");
    setTimeout(() => d.remove(), 400);
  }, 4200);
  speak(msg);
}

function renderSidebar() {
  sidebarEl.innerHTML = "";
  MACHINES.forEach((m) => {
    const locked = !GAME.unlocked.includes(m.id);
    const p = GAME.progress[m.id];
    const card = document.createElement("div");
    card.className = "m-card" + (locked ? " locked" : "") + (p.rootFlag ? " done" : "");
    if (SESSION.activeMachine === m.id) card.classList.add("active");
    const t = GAME.times[m.id] || { startedAt: null, elapsedMs: 0 };
    const timeLabel = p.rootFlag ? formatDuration(t.elapsedMs) : t.startedAt ? formatDuration(Date.now() - t.startedAt) : null;
    const steps = ["recon", "access", "privesc", "rootFlag"];
    const stepEls = steps
      .map((s) => `<span class="step ${p[s] ? "on" : ""}"></span>`)
      .join("");
    card.innerHTML = `
      <div class="m-head">
        <span class="m-icon">${locked ? "🔒" : p.rootFlag ? "✅" : "💻"}</span>
        <span class="m-name">${m.name}</span>
        <span class="m-diff diff-${m.difficulty === "Facile" ? "easy" : m.difficulty === "Moyen" ? "med" : m.difficulty === "Expert" ? "expert" : m.difficulty === "Insane" ? "insane" : "hard"}">${m.difficulty}</span>
      </div>
      <div class="m-ip">${locked ? "cible verrouillée" : m.ip}${timeLabel ? ` · ⏱ ${timeLabel}` : ""}</div>
      <div class="m-steps">${stepEls}</div>
    `;
    if (!locked) {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `Cibler ${m.name} (${m.difficulty})`);
      card.addEventListener("click", () => {
        inputEl.value = "use " + m.id;
        submitInput();
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputEl.value = "use " + m.id;
          submitInput();
        }
      });
    }
    sidebarEl.appendChild(card);
  });
  if (statusEl) statusEl.textContent = `Score : ${GAME.score} pts`;
  renderBadges();
}

function renderBadges() {
  const info = levelInfo(GAME.score);
  if (xpLabelEl) xpLabelEl.textContent = `Niveau ${info.level} · ${info.into}/${info.span} XP`;
  if (xpFillEl) xpFillEl.style.width = info.pct + "%";
  if (!badgesEl) return;
  badgesEl.innerHTML = "";
  BADGE_DEFS.forEach((def) => {
    const on = def.scope === "global" ? !!GAME.badges[def.id] : MACHINES.some((m) => GAME.badges[badgeKey(def, m)]);
    const span = document.createElement("span");
    span.className = "badge-pill" + (on ? " on" : "");
    span.title = `${def.label} — ${def.desc}${on ? "" : " (verrouillé)"}`;
    span.setAttribute("aria-label", `Badge ${def.label}${on ? " débloqué" : " verrouillé"}`);
    span.textContent = def.icon;
    badgesEl.appendChild(span);
  });
}

function handleTabComplete() {
  const value = inputEl.value;
  const { partial, matches, replaceFrom } = getCompletions(value);
  if (!matches.length) return;

  if (matches.length === 1) {
    const completed = value.slice(0, replaceFrom) + matches[0] + (matches[0].endsWith("/") ? "" : " ");
    inputEl.value = completed;
    inputEl.setSelectionRange(completed.length, completed.length);
    return;
  }

  const commonPrefix = longestCommonPrefix(matches);
  if (commonPrefix.length > partial.length) {
    const completed = value.slice(0, replaceFrom) + commonPrefix;
    inputEl.value = completed;
    inputEl.setSelectionRange(completed.length, completed.length);
  } else {
    printPrompt(value);
    printLine(matches.join("   "), "t-hint");
  }
}

function submitInput() {
  const val = inputEl.value;
  inputEl.value = "";
  histIndex = -1;

  if (PENDING_SSH) {
    const d = document.createElement("div");
    d.className = "t-line t-prompt";
    d.textContent = "mot de passe : " + "*".repeat(val.length || 0);
    outputEl.appendChild(d);
    const res = tryPassword(val);
    printLine(res.text, res.cls);
    printLine("");
    updatePromptLabel();
    updateAmbientForContext();
    return;
  }

  if (PENDING_IMPORT) {
    const d = document.createElement("div");
    d.className = "t-line t-prompt";
    d.textContent = "passphrase : " + "*".repeat(val.length || 0);
    outputEl.appendChild(d);
    finishImport(val).then(() => { outputEl.scrollTop = outputEl.scrollHeight; });
    return;
  }

  printPrompt(val);

  const firstWord = val.trim().split(/\s+/)[0] || "";
  if (firstWord === "export") {
    handleExportCommand(val.trim().split(/\s+/).slice(1)).then(() => { outputEl.scrollTop = outputEl.scrollHeight; });
    updatePromptLabel();
    return;
  }
  if (firstWord === "import") {
    handleImportCommand();
    updatePromptLabel();
    return;
  }

  const res = runCommand(val);
  if (res) {
    printLine(res.text, res.cls);
    if (res.cls === "t-hint") speak(res.text);
  }
  outputEl.scrollTop = outputEl.scrollHeight;
  updatePromptLabel();
  updateAmbientForContext();
}

function boot() {
  outputEl = document.getElementById("term-output");
  inputEl = document.getElementById("term-input");
  toastsEl = document.getElementById("toasts");
  sidebarEl = document.getElementById("machines-list");
  statusEl = document.getElementById("score-status");
  promptLabelEl = document.getElementById("prompt-label");
  themeToggleEl = document.getElementById("theme-toggle");
  soundToggleEl = document.getElementById("sound-toggle");
  fxToggleEl = document.getElementById("fx-toggle");
  ambientToggleEl = document.getElementById("ambient-toggle");
  voiceToggleEl = document.getElementById("voice-toggle");
  badgesEl = document.getElementById("badges-list");
  xpFillEl = document.getElementById("xp-fill");
  xpLabelEl = document.getElementById("xp-label");
  particlesCanvasEl = document.getElementById("particles-canvas");

  applyTheme(loadTheme());
  soundEnabled = loadSoundPref();
  applySoundToggleUI();
  fxEnabled = loadFxPref();
  applyFx();
  ambientEnabled = loadAmbientPref();
  applyAmbientToggleUI();
  voiceEnabled = loadVoicePref();
  applyVoiceToggleUI();
  if (!("speechSynthesis" in window) && voiceToggleEl) {
    voiceToggleEl.disabled = true;
    voiceToggleEl.title = "Narration vocale indisponible dans ce navigateur";
  }

  themeToggleEl.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme || "dark";
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });
  soundToggleEl.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    try { localStorage.setItem(SOUND_KEY, soundEnabled ? "on" : "off"); } catch (e) {}
    applySoundToggleUI();
    if (soundEnabled) playFlagSound();
  });
  fxToggleEl.addEventListener("click", () => {
    fxEnabled = !fxEnabled;
    try { localStorage.setItem(FX_KEY, fxEnabled ? "on" : "off"); } catch (e) {}
    applyFx();
  });
  ambientToggleEl.addEventListener("click", () => {
    ambientEnabled = !ambientEnabled;
    try { localStorage.setItem(AMBIENT_KEY, ambientEnabled ? "on" : "off"); } catch (e) {}
    applyAmbientToggleUI();
    if (ambientEnabled) updateAmbientForContext();
    else stopAmbient();
  });
  voiceToggleEl.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    try { localStorage.setItem(VOICE_KEY, voiceEnabled ? "on" : "off"); } catch (e) {}
    applyVoiceToggleUI();
    if (voiceEnabled) speak("Narration vocale activée.");
    else if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  });

  document.getElementById("editor-toggle").addEventListener("click", openEditor);
  document.getElementById("editor-close").addEventListener("click", closeEditor);
  document.getElementById("editor-load").addEventListener("click", loadFromEditor);
  document.getElementById("editor-download").addEventListener("click", downloadFromEditor);
  document.getElementById("editor-reset").addEventListener("click", () => { editorEl("editor-json").value = EDITOR_TEMPLATE; setEditorMsg(""); });
  document.getElementById("editor-modal").addEventListener("click", (e) => { if (e.target.id === "editor-modal") closeEditor(); });
  if (location.hash === "#editor") openEditor();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !editorEl("editor-modal").classList.contains("hidden")) closeEditor(); });

  resetSessionToAttacker();
  renderSidebar();
  updatePromptLabel();

  const banner = [
    ["=========================================", "t-banner"],
    ["  CTF LAB — Terminal d'entraînement", "t-banner"],
    ["  Recon -> Accès initial -> Privesc -> Flag", "t-banner"],
    ["=========================================", "t-banner"],
    ["", "t-out"],
    ["Tape `help` pour la liste des commandes, `machines` pour voir les cibles.", "t-out"],
    ["", "t-out"],
  ];
  let i = 0;
  (function typeNext() {
    if (i >= banner.length) return;
    const [text, cls] = banner[i++];
    printLine(text, cls);
    setTimeout(typeNext, text ? 55 : 15);
  })();

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { submitInput(); }
    else if (e.key === "Tab") {
      e.preventDefault();
      handleTabComplete();
    }
    else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      clearTerminal();
    }
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (SESSION.history.length) {
        histIndex = histIndex === -1 ? SESSION.history.length - 1 : Math.max(0, histIndex - 1);
        inputEl.value = SESSION.history[histIndex] || "";
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIndex !== -1) {
        histIndex = Math.min(SESSION.history.length, histIndex + 1);
        inputEl.value = SESSION.history[histIndex] || "";
      }
    }
  });
  document.addEventListener("click", () => inputEl.focus());
  inputEl.focus();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", boot);
