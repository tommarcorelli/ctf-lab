// engine.js — Moteur du terminal CTF Lab (vanilla JS, aucune dépendance)

// Garde-fou : valide la structure des machines au chargement. N'empêche jamais
// de jouer (une machine mal formée pourrait planter plus tard, pas ici), mais
// remonte le problème tout de suite dans la console au lieu d'un bug silencieux.
(function checkMachinesSchema() {
  if (typeof validateMachines !== "function") return;
  const errors = validateMachines(MACHINES);
  if (errors.length && typeof console !== "undefined") {
    console.warn(`[ctf-lab] ${errors.length} problème(s) de schéma détecté(s) dans MACHINES :`);
    errors.forEach((e) => console.warn(`  - ${e}`));
  }
})();

const SAVE_KEY = "ctf_lab_save_v1";
const HISTORY_KEY = "ctf_lab_history_v1";
const HISTORY_MAX = 200;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}
function persistHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(SESSION.history.slice(-HISTORY_MAX)));
  } catch (e) {}
}

const SAVE_VERSION = 1; // incrémenté à chaque changement de schéma de GAME nécessitant une migration dédiée

// Prend un objet GAME potentiellement partiel/ancien/étranger (import, vieille sauvegarde...) et
// garantit que tous les champs attendus par le moteur existent, avec des valeurs par défaut sûres.
// Utilisé à la fois par loadSave() (localStorage) et par l'import de sauvegarde chiffrée.
function sanitizeGameState(data) {
  if (!data || typeof data !== "object") throw new Error("format de sauvegarde invalide");
  if (typeof data.score !== "number" || !Number.isFinite(data.score)) data.score = 0;
  if (!Array.isArray(data.unlocked) || !data.unlocked.length) data.unlocked = [MACHINES[0].id];
  data.unlocked = data.unlocked.filter((id) => MACHINES.some((m) => m.id === id));
  if (!data.unlocked.length) data.unlocked = [MACHINES[0].id];
  if (!data.progress || typeof data.progress !== "object") data.progress = {};
  if (!data.hintsUsed || typeof data.hintsUsed !== "object") data.hintsUsed = {};
  if (!data.times || typeof data.times !== "object") data.times = {};
  MACHINES.forEach((m) => {
    if (!data.progress[m.id]) data.progress[m.id] = { recon: false, access: false, privesc: false, userFlag: false, rootFlag: false };
    if (!data.hintsUsed[m.id]) data.hintsUsed[m.id] = { recon: 0, access: 0, privesc: 0 };
    if (!data.times[m.id]) data.times[m.id] = { startedAt: null, elapsedMs: 0 };
  });
  if (!data.badges || typeof data.badges !== "object") data.badges = {}; // migration v1 -> badges
  if (!data.bestTimes || typeof data.bestTimes !== "object") data.bestTimes = {}; // migration v2 -> catégories de speedrun
  if (!data.jeopardy || typeof data.jeopardy !== "object") data.jeopardy = { solved: {}, hintsUsed: {} }; // migration v3 -> mode Jeopardy
  if (!data.jeopardy.solved || typeof data.jeopardy.solved !== "object") data.jeopardy.solved = {};
  if (!data.jeopardy.hintsUsed || typeof data.jeopardy.hintsUsed !== "object") data.jeopardy.hintsUsed = {};
  if (typeof data.insaneMode !== "boolean") data.insaneMode = false; // migration v4 -> mode Insane
  if (!data.blueteam || typeof data.blueteam !== "object") data.blueteam = { solved: {}, answered: {}, hintsUsed: {} }; // migration v5 -> mode Blue Team
  if (!data.blueteam.solved || typeof data.blueteam.solved !== "object") data.blueteam.solved = {};
  if (!data.blueteam.answered || typeof data.blueteam.answered !== "object") data.blueteam.answered = {};
  if (!data.blueteam.hintsUsed || typeof data.blueteam.hintsUsed !== "object") data.blueteam.hintsUsed = {};
  if (!data.firewall || typeof data.firewall !== "object") data.firewall = { solved: {} }; // migration v6 -> pare-feu CLI
  if (!data.firewall.solved || typeof data.firewall.solved !== "object") data.firewall.solved = {};
  if (!data.phishing || typeof data.phishing !== "object") data.phishing = { solved: {}, answered: {} }; // migration v7 -> chapitre phishing
  if (!data.phishing.solved || typeof data.phishing.solved !== "object") data.phishing.solved = {};
  if (!data.phishing.answered || typeof data.phishing.answered !== "object") data.phishing.answered = {};
  if (!data.reverse || typeof data.reverse !== "object") data.reverse = { solved: {}, answered: {} }; // migration v8 -> reverse engineering
  if (!data.reverse.solved || typeof data.reverse.solved !== "object") data.reverse.solved = {};
  if (!data.reverse.answered || typeof data.reverse.answered !== "object") data.reverse.answered = {};
  if (!data.stackpwn || typeof data.stackpwn !== "object") data.stackpwn = { solved: false }; // migration v9 -> défi buffer overflow
  if (typeof data.stackpwn.solved !== "boolean") data.stackpwn.solved = false;
  data.saveVersion = SAVE_VERSION;
  return data;
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return sanitizeGameState(JSON.parse(raw));
  } catch (e) {}
  return sanitizeGameState({ score: 0, unlocked: [MACHINES[0].id], progress: {}, hintsUsed: {}, times: {}, badges: {}, bestTimes: {}, jeopardy: { solved: {}, hintsUsed: {} }, blueteam: { solved: {}, answered: {}, hintsUsed: {} }, firewall: { solved: {} }, phishing: { solved: {}, answered: {} }, reverse: { solved: {}, answered: {} }, stackpwn: { solved: false }, insaneMode: false });
}
function persistSave() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(GAME));
}

let GAME = loadSave();

// Ajoute des points au score, avec le multiplicateur du mode Insane (1.5x) s'il est actif.
function addScore(base) {
  const mult = GAME.insaneMode ? 1.5 : 1;
  GAME.score += Math.round(base * mult);
}

// ── Session runtime (non persistée) ─────────────────────────────────────────
const SESSION = {
  ctx: "attacker",       // "attacker" ou id de machine
  user: "kali",
  host: "kali-atk",
  cwd: "/home/kali",
  home: "/home/kali",
  fs: null,              // fs actif (généré au boot / à chaque login)
  activeMachine: null,   // machine ciblée via `use`
  pagerMode: null,       // { machineId } — en attente de !sh
  cronPlanted: {},       // { machineId: bool }
  cronTicked: {},        // { machineId: bool }
  history: loadHistory(),
  lastExitCode: 0,
  sudoAttempts: {},      // { machineId: count }
  sudoLocked: {},        // { machineId: bool }
  vimMode: null,         // { path, lines, isNew, machineId } — édition en cours
  listening: null,       // port en écoute côté attaquant (nc -lvnp), ou null
  uploaded: {},          // { machineId: bool } — webshell uploadé sur la machine
  tunnel: null,          // { localPort, targetIp, targetPort } — tunnel ssh -L actif (pivot)
  sandbox: false,        // true en mode bac à sable libre (FS custom, sans flag ni score)
  firewall: null,        // { id, policy, rules } — scénario de pare-feu en cours, ou null
};

// Une machine "interne" (machine.internal) n'est routable qu'à travers un tunnel ssh -L
// pointant vers son IP (établi depuis un pivot déjà rooté). Les autres sont toujours joignables.
function isReachable(machine) {
  if (!machine.internal) return true;
  return !!(SESSION.tunnel && SESSION.tunnel.targetIp === machine.ip);
}
function unreachableMsg(machine) {
  return out(
    `Aucune route vers l'hôte ${machine.ip} — hôte interne, non routable directement.\n` +
      "(indice : il faut pivoter à travers une machine déjà compromise, ex. `ssh -L <port>:" +
      `${machine.ip}:22 <user>@<ip_du_pivot>\`)`,
    "t-err",
  );
}

// ── Utilitaires filesystem ──────────────────────────────────────────────────
function normPath(p) {
  const out = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return "/" + out.join("/");
}
function resolvePath(arg, cwd, home) {
  if (!arg || arg === "~") return home;
  // Chemins Windows (C:\Scripts\backup.bat) -> chemins internes façon unix (/Scripts/backup.bat)
  const a = arg.replace(/\\/g, "/").replace(/^[a-zA-Z]:/, "");
  let p;
  if (a.startsWith("/")) p = a;
  else if (a.startsWith("~/")) p = home + a.slice(1);
  else p = cwd + "/" + a;
  return normPath(p);
}
function winPath(p) {
  return "C:" + p.replace(/\//g, "\\");
}
function isWinCtx() {
  return SESSION.ctx !== "attacker" && getMachine(SESSION.ctx).osType === "windows";
}
function parentOf(p) { const i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); }
function baseOf(p) { return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); }
function ensureParents(fs, p) {
  let cur = parentOf(p);
  while (cur !== "/" && !fs[cur]) {
    fs[cur] = { type: "dir", implied: true };
    cur = parentOf(cur);
  }
}
function children(fs, p) {
  const base = p === "/" ? "/" : p + "/";
  const out = [];
  for (const k of Object.keys(fs)) {
    if (!k.startsWith(base) || k === p) continue;
    const rest = k.slice(base.length);
    if (!rest || rest.includes("/")) continue;
    out.push(rest);
  }
  return out;
}
function displayPath(p, home) {
  if (p === home) return "~";
  if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
}
function canWrite(node, isOwner) {
  const perms = node.perms || "";
  if (perms.length < 9) return false;
  if (isOwner && perms[2] === "w") return true;
  if (perms[5] === "w") return true; // group
  if (perms[8] === "w") return true; // other
  return false;
}
function isRootOnly(fs, p) {
  let cur = p;
  while (cur !== "/") {
    const n = fs[cur];
    if (n && n.rootOnly) return true;
    cur = parentOf(cur);
  }
  return false;
}

// ── Construction des filesystems ────────────────────────────────────────────
function buildAttackerFS() {
  const fs = {};
  fs["/"] = { type: "dir" };
  fs["/home"] = { type: "dir" };
  fs["/home/kali"] = { type: "dir" };
  fs["/home/kali/notes.md"] = {
    type: "file",
    perms: "-rw-r--r--",
    owner: "kali",
    content:
      "# Carnet de mission\n\n" +
      "Commandes utiles : nmap <ip>, curl <url>, ftp <ip>, ssh user@ip [-p port]\n" +
      "Tape `machines` pour voir les cibles, `use <nom>` pour cibler une machine, `hint` si tu bloques.\n",
  };
  ensureParents(fs, "/home/kali/notes.md");
  return fs;
}
function buildTargetFS(machine, username) {
  const fs = {};
  const home = machine.targetFS.homeDir;
  const isWin = machine.osType === "windows";
  const superOwner = isWin ? "SYSTEM" : "root";
  fs["/"] = { type: "dir" };
  if (!isWin) fs["/home"] = { type: "dir" };
  fs[home] = { type: "dir", owner: username };
  const rootDir = parentOf(machine.rootFile.path);
  fs[rootDir] = { type: "dir", owner: superOwner, rootOnly: true };
  fs[machine.rootFile.path] = {
    type: "file",
    content: machine.rootFile.content,
    perms: "-rw-------",
    owner: superOwner,
    rootOnly: true,
  };
  if (!isWin) {
    fs["/etc"] = { type: "dir" };
    fs["/etc/hostname"] = { type: "file", perms: "-rw-r--r--", owner: "root", content: machine.targetFS.hostname };
    fs["/etc/passwd"] = {
      type: "file",
      perms: "-rw-r--r--",
      owner: "root",
      content: `root:x:0:0:root:/root:/bin/bash\n${username}:x:1000:1000:${username}:${home}:/bin/bash`,
    };
  }

  const userFiles = machine.targetFS.users[username].fs;
  for (const [rel, node] of Object.entries(userFiles)) {
    const abs = rel.startsWith("/") ? rel : home + "/" + rel;
    fs[abs] = JSON.parse(JSON.stringify(node));
  }
  if (machine.targetFS.extraFS) {
    for (const [abs, node] of Object.entries(machine.targetFS.extraFS)) {
      fs[abs] = JSON.parse(JSON.stringify(node));
    }
  }
  Object.keys(fs).forEach((k) => ensureParents(fs, k));
  return fs;
}

function resetSessionToAttacker() {
  SESSION.ctx = "attacker";
  SESSION.user = "kali";
  SESSION.host = "kali-atk";
  SESSION.home = "/home/kali";
  SESSION.cwd = "/home/kali";
  SESSION.fs = buildAttackerFS();
  SESSION.pagerMode = null;
  SESSION.sandbox = false;
}

// ── Bac à sable libre : FS custom, sans machine, sans flag ni scoring ─────────
// Un spec de FS est une map plate { chemin: contenu }. Une valeur chaîne = fichier,
// un objet/null ou un chemin finissant par "/" = dossier. Chemins relatifs au home
// (/home/hacker) sauf s'ils commencent par "/".
const DEFAULT_SANDBOX_FS = {
  "README.txt": "Bac à sable — entraîne-toi librement aux commandes (ls, cd, cat, find, echo,\nvim, grep, cut, awk, wc, sort...). Aucun flag, aucun score : juste pour pratiquer.\nQuitte avec `sandbox reset` (ou `exit`).",
  "notes/": {},
  "notes/todo.txt": "acheter du cafe\nfinir le rapport trimestriel\nrappeler l'auditrice\nranger le bureau",
  "notes/idees.md": "# Idees\n- automatiser les sauvegardes\n- durcir le pare-feu\n- former l'equipe au phishing",
  "logs/access.log": "10.0.0.4 GET /\n10.0.0.9 POST /login\n10.0.0.4 GET /admin\n10.0.0.9 GET /\n10.0.0.13 POST /login",
  "data/users.csv": "id,name,role\n1,alice,admin\n2,bob,user\n3,carol,user\n4,dan,admin",
  "bin/": {},
};
function buildSandboxFS(spec) {
  const home = "/home/hacker";
  const fs = { "/": { type: "dir" }, "/home": { type: "dir" }, [home]: { type: "dir", owner: "hacker" } };
  const entries = spec && typeof spec === "object" && !Array.isArray(spec) ? spec : {};
  for (const [rawPath, val] of Object.entries(entries)) {
    let p = String(rawPath).trim();
    if (!p) continue;
    const isDir = p.endsWith("/") || (val && typeof val === "object");
    p = p.replace(/\/+$/, "");
    const abs = p.startsWith("/") ? normPath(p) : normPath(home + "/" + p);
    fs[abs] = isDir
      ? { type: "dir", owner: "hacker" }
      : { type: "file", perms: "-rw-r--r--", owner: "hacker", content: val == null ? "" : String(val) };
    ensureParents(fs, abs);
  }
  Object.keys(fs).forEach((k) => ensureParents(fs, k));
  return fs;
}
function mountSandbox(spec) {
  SESSION.fs = buildSandboxFS(spec);
  SESSION.ctx = "attacker"; // pas de machine -> pas de scan de flag ni de scoring
  SESSION.user = "hacker";
  SESSION.host = "sandbox";
  SESSION.home = "/home/hacker";
  SESSION.cwd = "/home/hacker";
  SESSION.activeMachine = null;
  SESSION.pagerMode = null;
  SESSION.vimMode = null;
  SESSION.sandbox = true;
  if (typeof renderSidebar === "function") renderSidebar();
}
function cmdSandbox(args) {
  const sub = (args[0] || "").toLowerCase();
  if (sub === "reset" || sub === "exit" || sub === "quit") {
    if (!SESSION.sandbox) return out("Tu n'es pas dans le bac à sable.", "t-err");
    resetSessionToAttacker();
    return out("Bac à sable quitté — retour sur ta machine (kali).");
  }
  if (sub === "edit" || sub === "custom") {
    if (typeof openSandboxEditor === "function") { openSandboxEditor(); return out("🧪 Éditeur de FS du bac à sable ouvert (colle ton arborescence JSON, puis « Monter »)."); }
    return out("Pour un FS personnalisé, utilise le bouton 🧪 de l'interface. `sandbox` seul monte un FS de démo.", "t-hint");
  }
  mountSandbox(DEFAULT_SANDBOX_FS);
  return out(
    "🧪 Bac à sable monté (FS de démo). Tu es `hacker@sandbox`.\n" +
      "Entraîne-toi : `ls`, `cat README.txt`, `find .`, `cat data/users.csv | cut -d , -f 2`, `grep POST logs/access.log`...\n" +
      "Aucun flag ni score ici. `sandbox reset` (ou `exit`) pour revenir. Bouton 🧪 pour monter un FS custom.",
    "t-ok",
  );
}

// ── Formatage ls -la ─────────────────────────────────────────────────────────
function formatLs(fs, dirPath, opts) {
  const names = children(fs, dirPath).sort();
  if (!opts.all) {
    // rien de spécial à filtrer ici (pas de fichiers "cachés" avec un point dans nos machines,
    // mais on respecte la convention : les noms commençant par "." sont masqués sans -a)
  }
  const visible = names.filter((n) => opts.all || !n.startsWith("."));
  if (!opts.long) return visible.join("  ");
  const lines = visible.map((n) => {
    const p = dirPath === "/" ? "/" + n : dirPath + "/" + n;
    const node = fs[p] || {};
    const perms = node.perms || (node.type === "dir" ? "drwxr-xr-x" : "-rw-r--r--");
    const owner = node.owner || "user";
    const size = node.type === "dir" ? 4096 : (node.content || "").length;
    return `${perms} 1 ${owner} ${owner} ${String(size).padStart(5)} ${n}`;
  });
  return lines.join("\n");
}

// ── Pipeline (filtres simples) ───────────────────────────────────────────────
function applyFilter(text, stage) {
  const tokens = tokenize(stage);
  const cmd = tokens[0];
  const rest = tokens.slice(1);
  let lines = text.split("\n");
  switch (cmd) {
    case "grep": {
      const args = rest.filter((a) => a !== "-i");
      const insensitive = rest.includes("-i");
      const pattern = (args[0] || "").replace(/^['"]|['"]$/g, "");
      let re;
      try { re = new RegExp(pattern, insensitive ? "i" : ""); } catch { re = null; }
      return re ? lines.filter((l) => re.test(l)).join("\n") : "";
    }
    case "wc": {
      if (rest.includes("-l")) return String(lines.filter((l) => l.length || lines.length === 1).length);
      return String(text.length);
    }
    case "sort": {
      const uniq = rest.includes("-u");
      let out = [...lines].sort();
      if (uniq) out = out.filter((l, i) => out.indexOf(l) === i);
      return out.join("\n");
    }
    case "head": {
      const n = parseInt((rest[0] || "-10").replace("-", ""), 10) || 10;
      return lines.slice(0, n).join("\n");
    }
    case "tail": {
      const n = parseInt((rest[0] || "-10").replace("-", ""), 10) || 10;
      return lines.slice(-n).join("\n");
    }
    case "cut": {
      let delim = " ", field = 1;
      rest.forEach((a, i) => {
        if (a === "-d") delim = rest[i + 1].replace(/^['"]|['"]$/g, "");
        if (a === "-f") field = parseInt(rest[i + 1], 10);
      });
      return lines.map((l) => l.split(delim)[field - 1] || "").join("\n");
    }
    case "awk": {
      const expr = rest.join(" ");
      const m = expr.match(/\{\s*print\s+\$(\d+)\s*\}/);
      if (!m) return text;
      const idx = parseInt(m[1], 10) - 1;
      return lines.map((l) => l.trim().split(/\s+/)[idx] || "").join("\n");
    }
    default:
      return text;
  }
}

function tokenize(s) {
  const out = [];
  let cur = "", q = null;
  for (const ch of s.trim()) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ""; } continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// ── Vrai parser shell (quotes imbriquées, $VAR, $(...), redirections) ─────────
// NB : les backslash restent volontairement littéraux (les chemins Windows type
// C:\Scripts\backup.bat des machines cibles en dépendent) — pas d'échappement bash.

// Variables intégrées en lecture seule (pas de variables définies par l'utilisateur :
// `export` est déjà une commande du jeu). Une variable inconnue vaut "" comme en bash.
function shellVarValue(name) {
  switch (name) {
    case "?": return String(SESSION.lastExitCode);
    case "USER": case "LOGNAME": return SESSION.user;
    case "HOME": return SESSION.home;
    case "PWD": return isWinCtx() ? winPath(SESSION.cwd) : SESSION.cwd;
    case "HOSTNAME": return SESSION.host;
    case "UID": return SESSION.user === "root" ? "0" : "1000";
    case "SHELL": return "/bin/bash";
    default: return "";
  }
}

// Développe un `$...` à la position i (raw[i] === "$"). Retourne [texte, index_suivant].
function expandDollar(raw, i) {
  if (raw[i + 1] === "(") { // substitution de commande $(...)
    let depth = 1, j = i + 2;
    for (; j < raw.length && depth > 0; j++) {
      if (raw[j] === "(") depth++;
      else if (raw[j] === ")") { depth--; if (depth === 0) break; }
    }
    const inner = raw.slice(i + 2, j);
    const r = runPipelineCore(inner.trim());
    const outp = (r && typeof r.text === "string" ? r.text : "").replace(/\n+$/, "").replace(/\n/g, " ");
    return [outp, j + 1];
  }
  if (raw[i + 1] === "{") { // ${VAR}
    let j = i + 2, name = "";
    while (j < raw.length && raw[j] !== "}") { name += raw[j]; j++; }
    return [shellVarValue(name), j + 1];
  }
  if (raw[i + 1] === "?") return [shellVarValue("?"), i + 2];
  let j = i + 1, name = "";
  while (j < raw.length && /[A-Za-z0-9_]/.test(raw[j])) { name += raw[j]; j++; }
  if (!name) return ["$", i + 1]; // un $ isolé reste littéral
  return [shellVarValue(name), j];
}

// Découpe un segment en mots, en gérant guillemets simples/doubles (imbriqués),
// concaténation adjacente, et expansion $VAR/$(...) hors guillemets simples.
// Retourne [{ value, quoted }] — `quoted` sert à ne pas prendre un `>` entre
// guillemets pour un opérateur de redirection.
function parseWords(raw) {
  const words = [];
  let cur = "", started = false, quoted = false, i = 0;
  const push = () => { if (started) { words.push({ value: cur, quoted }); } cur = ""; started = false; quoted = false; };
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "'") { started = true; quoted = true; i++; while (i < raw.length && raw[i] !== "'") { cur += raw[i]; i++; } i++; continue; }
    if (ch === '"') {
      started = true; quoted = true; i++;
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === "$") { const [v, ni] = expandDollar(raw, i); cur += v; i = ni; }
        else { cur += raw[i]; i++; }
      }
      i++; continue;
    }
    if (/\s/.test(ch)) { push(); i++; continue; }
    if (ch === "$") { started = true; const [v, ni] = expandDollar(raw, i); cur += v; i = ni; continue; }
    started = true; cur += ch; i++;
  }
  push();
  return words;
}

// Sépare argv réel et redirections (>, >>, 2>, &>, 2>&1) à partir des mots.
function splitRedirects(words) {
  const argv = [], redirects = [];
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (!w.quoted) {
      if (w.value === "2>&1") { redirects.push({ fd: "merge" }); continue; }
      const m = w.value.match(/^(2>>|2>|&>>|&>|1>>|1>|>>|>)(.*)$/);
      if (m) {
        const op = m[1];
        let target = m[2];
        if (!target) { const nx = words[k + 1]; if (nx) { target = nx.value; k++; } }
        redirects.push({ fd: op[0] === "2" ? 2 : op[0] === "&" ? "both" : 1, target, append: op.includes(">>") });
        continue;
      }
    }
    argv.push(w.value);
  }
  return { argv, redirects };
}

// Écrit `text` dans un fichier (sémantique partagée par echo et les redirections).
// Préserve exactement l'ancien comportement de cmdEcho (plant cron/schtask, permissions).
function writeStdoutToFile(targetArg, text, append) {
  if (targetArg === "/dev/null") return out("");
  const p = resolvePath(targetArg, SESSION.cwd, SESSION.home);
  const node = SESSION.fs[p];
  if (SESSION.ctx !== "attacker") {
    const machine = getMachine(SESSION.ctx);
    if ((machine.privesc.type === "cron-writable" || machine.privesc.type === "schtask-writable") && p === machine.privesc.scriptPath) {
      if (!node) return out(`bash: ${targetArg}: Fichier introuvable`, "t-err");
      node.content += "\n" + text;
      checkAndPlant(machine, p);
      return out("");
    }
  }
  if (!node) return out(`bash: ${targetArg}: Fichier introuvable`, "t-err");
  if (!canWrite(node, node.owner === SESSION.user)) return out(`bash: ${targetArg}: Permission refusée`, "t-err");
  node.content = append ? (node.content || "") + "\n" + text : text;
  return out("");
}

// Applique les redirections au résultat d'une commande. Modèle simplifié à un seul
// flux : `2>` n'agit que sur une sortie d'erreur (t-err), `&>` sur tout, `2>&1` no-op.
function applyRedirects(result, redirects) {
  for (const r of redirects) {
    if (r.fd === "merge") continue;
    const isErr = result.cls === "t-err";
    if (r.fd === 2) {
      if (isErr) result = r.target === "/dev/null" ? out("") : (writeStdoutToFile(r.target, result.text, r.append), out(""));
    } else if (r.fd === "both") {
      result = r.target === "/dev/null" ? out("") : (writeStdoutToFile(r.target, result.text, r.append), out(""));
    } else {
      result = writeStdoutToFile(r.target, result.text, r.append);
    }
  }
  return result;
}

// Découpe une ligne en segments de pipe, en respectant guillemets et $(...).
function splitPipeline(line) {
  const parts = [];
  let cur = "", q = null, depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === "$" && line[i + 1] === "(") { depth++; cur += ch; continue; }
    if (ch === ")" && depth > 0) { depth--; cur += ch; continue; }
    if (ch === "|" && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((s) => s.trim());
}

// Cœur d'exécution d'une ligne (sans effets de bord d'historique / scan de flags) :
// expansion + tokenisation + pipes + redirections. Réutilisé par la substitution $(...).
function runPipelineCore(line) {
  const segments = splitPipeline(line);
  const lastIdx = segments.length - 1;
  const lastSplit = splitRedirects(parseWords(segments[lastIdx]));
  const firstSplit = lastIdx === 0 ? lastSplit : splitRedirects(parseWords(segments[0]));
  const argv = firstSplit.argv;
  const cmd = argv[0];
  const args = argv.slice(1);
  // rawFirst = segment brut (non développé) pour les commandes qui matchent l'exploit
  // à la chaîne exacte (sudo/find/docker/bash) — comportement inchangé.
  let result = dispatch(cmd, args, segments[0]);
  if (result && segments.length > 1) {
    let text = result.text;
    for (let i = 1; i < segments.length; i++) text = applyFilter(text, segments[i]);
    result = out(text, result.cls);
  }
  if (result && lastSplit.redirects.length) result = applyRedirects(result, lastSplit.redirects);
  return result;
}

// ── Autocomplétion (Tab) ─────────────────────────────────────────────────────
const KNOWN_COMMANDS = [
  "help", "clear", "machines", "use", "reset", "hint", "insane", "progress", "badges", "records", "writeup",
  "challenges", "challenge", "chint", "submit", "hashcat", "daily", "score", "history",
  "whoami", "id", "groups", "pwd", "ls", "cd", "cat", "find", "echo", "nmap", "curl",
  "ftp", "ssh", "sudo", "crontab", "exit", "man", "docker", "export", "import",
  "dir", "type", "net", "schtasks", "icacls", "vim", "nc", "arp", "cloudctl", "generate", "replay", "sandbox",
  "blueteam", "incident", "answer", "bthint", "firewall", "iptables",
  "phishing", "inbox", "mail", "report", "phhint",
  "malware", "re", "strings", "disas", "disasm", "resolve", "rehint", "graph", "stack",
];
const PATH_COMMANDS = ["cd", "ls", "cat", "find", "dir", "type", "icacls", "vim"];

function longestCommonPrefix(strings) {
  if (!strings.length) return "";
  let prefix = strings[0];
  for (const s of strings.slice(1)) {
    while (prefix && !s.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}
function completePathCandidates(partial) {
  const slashIdx = partial.lastIndexOf("/");
  const dirPart = slashIdx >= 0 ? partial.slice(0, slashIdx + 1) : "";
  const namePart = slashIdx >= 0 ? partial.slice(slashIdx + 1) : partial;
  const dirAbs = dirPart ? resolvePath(dirPart, SESSION.cwd, SESSION.home) : SESSION.cwd;
  if (isRootOnly(SESSION.fs, dirAbs) && SESSION.user !== "root") return [];
  const names = children(SESSION.fs, dirAbs);
  return names
    .filter((n) => n.startsWith(namePart))
    .sort()
    .map((n) => {
      const abs = dirAbs === "/" ? "/" + n : dirAbs + "/" + n;
      const isDir = SESSION.fs[abs] && SESSION.fs[abs].type === "dir";
      return dirPart + n + (isDir ? "/" : "");
    });
}
function getCompletions(value) {
  const endsWithSpace = /\s$/.test(value);
  const tokens = tokenize(value);
  const completingCommand = tokens.length === 0 || (tokens.length === 1 && !endsWithSpace);

  if (completingCommand) {
    const partial = tokens[0] || "";
    const matches = KNOWN_COMMANDS.filter((c) => c.startsWith(partial)).sort();
    return { partial, matches, replaceFrom: value.length - partial.length };
  }

  const cmd = tokens[0];
  const argIndex = endsWithSpace ? tokens.length - 1 : tokens.length - 2;
  const partial = endsWithSpace ? "" : tokens[tokens.length - 1];
  let matches = [];
  if ((cmd === "use" || cmd === "reset") && argIndex === 0) {
    matches = MACHINES.map((m) => m.id).filter((id) => id.startsWith(partial)).sort();
  } else if (cmd === "man" && argIndex === 0) {
    matches = Object.keys(MAN_PAGES).filter((c) => c.startsWith(partial)).sort();
  } else if (PATH_COMMANDS.includes(cmd)) {
    matches = completePathCandidates(partial);
  }
  return { partial, matches, replaceFrom: value.length - partial.length };
}

// ── Pages de manuel (man) ────────────────────────────────────────────────────
const MAN_PAGES = {
  help: "NAME\n    help - liste les commandes disponibles\n\nSYNOPSIS\n    help\n\nDESCRIPTION\n    Affiche un résumé des commandes principales du simulateur, groupées par\n    catégorie (recon, accès, système, pipes).",
  clear: "NAME\n    clear - efface le terminal\n\nSYNOPSIS\n    clear\n\nDESCRIPTION\n    Vide l'historique affiché à l'écran (sans toucher à l'historique des\n    commandes). Raccourci équivalent : Ctrl+L.",
  machines: "NAME\n    machines - liste les cibles du lab\n\nSYNOPSIS\n    machines\n\nDESCRIPTION\n    Affiche les 3 machines du lab avec leur statut (verrouillée, en cours,\n    terminée) et leur niveau de difficulté.",
  use: "NAME\n    use - cible une machine\n\nSYNOPSIS\n    use <nom>\n\nDESCRIPTION\n    Sélectionne une machine comme cible active pour les commandes de recon\n    (nmap, curl, ftp) et affiche son briefing.",
  reset: "NAME\n    reset - réinitialise une machine\n\nSYNOPSIS\n    reset <nom>\n\nDESCRIPTION\n    Remet à zéro la progression, les indices utilisés et le chrono d'une\n    machine déjà débloquée, pour la rejouer depuis le début. Les points déjà\n    gagnés sur cette machine sont retirés du score.",
  hint: "NAME\n    hint - affiche un indice\n\nSYNOPSIS\n    hint\n\nDESCRIPTION\n    Donne l'indice suivant pour l'étape en cours (recon, accès ou privesc)\n    de la machine active. Limité à 3 indices par étape.",
  progress: "NAME\n    progress - résumé de la progression\n\nSYNOPSIS\n    progress\n\nDESCRIPTION\n    Liste l'état de chaque machine (recon/accès/privesc/flags) ainsi que le\n    chrono et le score total.",
  score: "NAME\n    score - affiche le score\n\nSYNOPSIS\n    score\n\nDESCRIPTION\n    Affiche le score total accumulé sur l'ensemble du lab.",
  history: "NAME\n    history - historique des commandes\n\nSYNOPSIS\n    history\n\nDESCRIPTION\n    Réaffiche les commandes précédemment tapées dans cette session (aussi\n    accessible avec les flèches ↑ / ↓). L'historique est conservé entre les\n    rechargements de page.",
  whoami: "NAME\n    whoami - utilisateur courant\n\nSYNOPSIS\n    whoami\n\nDESCRIPTION\n    Affiche le nom de l'utilisateur actuellement connecté sur la session\n    active (attaquant ou machine cible).",
  id: "NAME\n    id - identité de l'utilisateur\n\nSYNOPSIS\n    id\n\nDESCRIPTION\n    Affiche l'uid, le gid et les groupes de l'utilisateur courant. Utile\n    pour confirmer une élévation de privilèges réussie (uid=0 = root).",
  pwd: "NAME\n    pwd - répertoire courant\n\nSYNOPSIS\n    pwd\n\nDESCRIPTION\n    Affiche le chemin absolu du répertoire de travail courant.",
  ls: "NAME\n    ls - lister un répertoire\n\nSYNOPSIS\n    ls [-l] [-a] [-la] [chemin]\n\nDESCRIPTION\n    Affiche le contenu d'un répertoire.\n    -l   format détaillé (permissions, propriétaire, taille)\n    -a   affiche aussi les entrées cachées (nom commençant par '.')",
  cd: "NAME\n    cd - changer de répertoire\n\nSYNOPSIS\n    cd [chemin]\n\nDESCRIPTION\n    Change le répertoire de travail courant. Accepte les chemins relatifs,\n    absolus, '..' et '~' (répertoire personnel).",
  cat: "NAME\n    cat - afficher un fichier\n\nSYNOPSIS\n    cat <fichier> [fichier2 ...]\n\nDESCRIPTION\n    Affiche le contenu d'un ou plusieurs fichiers. Respecte les permissions\n    (un fichier root-only ne sera lisible qu'en tant que root).",
  find: "NAME\n    find - rechercher des fichiers\n\nSYNOPSIS\n    find <chemin> [-name '<motif>']\n    find / -perm -4000 -type f\n\nDESCRIPTION\n    Recherche des fichiers/dossiers sous <chemin>, filtrés par -name si\n    fourni ('*' est un joker). La variante -perm -4000 -type f recherche\n    les binaires SUID (utile en énumération de privesc).",
  echo: "NAME\n    echo - afficher du texte\n\nSYNOPSIS\n    echo <texte>\n    echo <texte> > fichier\n    echo <texte> >> fichier\n\nDESCRIPTION\n    Affiche le texte donné, ou l'écrit dans un fichier (> écrase, >> ajoute\n    à la fin). Supporte la variable spéciale $? (code de sortie de la\n    dernière commande).",
  nmap: "NAME\n    nmap - scanner de ports\n\nSYNOPSIS\n    nmap <ip>\n\nDESCRIPTION\n    Scanne les ports ouverts d'une machine cible et affiche les services\n    détectés. Première étape obligatoire (recon) sur chaque machine.",
  curl: "NAME\n    curl - client HTTP\n\nSYNOPSIS\n    curl <url>\n\nDESCRIPTION\n    Récupère le contenu d'une page web exposée par une machine cible, si le\n    port HTTP correspondant est ouvert.",
  ftp: "NAME\n    ftp - client FTP\n\nSYNOPSIS\n    ftp <ip>\n\nDESCRIPTION\n    Se connecte à un service FTP exposé (souvent en anonyme) et rapatrie\n    les fichiers disponibles dans ~/loot/<machine>-ftp/.",
  ssh: "NAME\n    ssh - connexion distante\n\nSYNOPSIS\n    ssh <utilisateur>@<ip> [-p <port>]\n\nDESCRIPTION\n    Ouvre une session shell sur une machine cible avec les identifiants\n    fournis. Demande le mot de passe à la ligne suivante.",
  sudo: "NAME\n    sudo - exécuter en tant que root\n\nSYNOPSIS\n    sudo -l\n    sudo <commande>\n\nDESCRIPTION\n    sudo -l liste les commandes autorisées en root pour l'utilisateur\n    courant. Les tentatives non autorisées sont comptées : après 3 essais\n    infructueux, le compte est verrouillé jusqu'à une reconnexion ssh.",
  crontab: "NAME\n    crontab - tâches planifiées\n\nSYNOPSIS\n    crontab -l\n\nDESCRIPTION\n    Liste les tâches cron de l'utilisateur courant. Les tâches système sont\n    généralement dans /etc/cron.d/, à explorer avec ls/cat.",
  exit: "NAME\n    exit - quitter la session\n\nSYNOPSIS\n    exit\n\nDESCRIPTION\n    Ferme la connexion à la machine cible et revient à la session locale\n    de l'attaquant (kali@kali-atk).",
  badges: "NAME\n    badges - succès débloqués\n\nSYNOPSIS\n    badges\n\nDESCRIPTION\n    Affiche la liste des badges (débloqués ou non) ainsi que le niveau\n    et la progression XP courante.",
  records: "NAME\n    records - meilleurs temps locaux\n\nSYNOPSIS\n    records\n\nDESCRIPTION\n    Affiche les meilleurs temps enregistrés localement par machine et par\n    catégorie (Any%, Sans indice, Premier essai sudo).",
  writeup: "NAME\n    writeup - résumé pédagogique d'une machine\n\nSYNOPSIS\n    writeup <machine> [--download]\n\nDESCRIPTION\n    Génère un write-up Markdown de la machine terminée (recon, accès,\n    privesc, flags). Ajoute --download (ou -d) pour le télécharger en\n    fichier .md au lieu de l'afficher dans le terminal.",
  challenges: "NAME\n    challenges - liste des défis Jeopardy\n\nSYNOPSIS\n    challenges\n\nDESCRIPTION\n    Affiche les mini-défis indépendants des machines (crypto, forensics,\n    misc), avec leur statut de résolution.",
  challenge: "NAME\n    challenge - afficher un défi Jeopardy\n\nSYNOPSIS\n    challenge <id>\n\nDESCRIPTION\n    Affiche l'énoncé complet d'un défi. Utilise `challenges` pour voir\n    la liste des identifiants disponibles.",
  chint: "NAME\n    chint - indice pour un défi Jeopardy\n\nSYNOPSIS\n    chint <id>\n\nDESCRIPTION\n    Affiche l'indice suivant pour le défi donné (3 indices progressifs\n    par défi, comme la commande hint en mode boîte).",
  submit: "NAME\n    submit - soumettre la réponse d'un défi Jeopardy\n\nSYNOPSIS\n    submit <id> <flag>\n\nDESCRIPTION\n    Vérifie la réponse au défi Jeopardy donné. Récompense des points en\n    cas de succès.",
  hashcat: "NAME\n    hashcat - casseur de hash simulé (algorithme maison, fictif)\n\nSYNOPSIS\n    hashcat <hash-vx>\n    hashcat --list\n\nDESCRIPTION\n    Compare un hash-VX à la wordlist embarquée du lab et révèle le mot\n    de passe en cas de correspondance. --list affiche la wordlist.\n    Ceci est un algorithme pédagogique maison, pas un vrai MD5/SHA.",
  daily: "NAME\n    daily - défi Jeopardy du jour\n\nSYNOPSIS\n    daily\n\nDESCRIPTION\n    Affiche un défi mis en avant, choisi de façon stable pour la journée\n    (seed = date du jour).",
  man: "NAME\n    man - pages de manuel\n\nSYNOPSIS\n    man <commande>\n\nDESCRIPTION\n    Affiche une courte page de manuel pour la commande donnée.",
  dir: "NAME\n    dir - lister un dossier (Windows)\n\nSYNOPSIS\n    dir [chemin]\n\nDESCRIPTION\n    Équivalent Windows de `ls`. Liste le contenu d'un dossier sur une\n    machine cible Windows.",
  type: "NAME\n    type - afficher un fichier (Windows)\n\nSYNOPSIS\n    type <fichier>\n\nDESCRIPTION\n    Équivalent Windows de `cat`. Affiche le contenu d'un fichier.",
  net: "NAME\n    net - administration Windows\n\nSYNOPSIS\n    net user\n    net localgroup administrators\n\nDESCRIPTION\n    Liste les comptes locaux, ou les membres du groupe Administrateurs.",
  schtasks: "NAME\n    schtasks - tâches planifiées (Windows)\n\nSYNOPSIS\n    schtasks /query\n\nDESCRIPTION\n    Équivalent Windows de `crontab -l` / `/etc/cron.d/`. Liste les tâches\n    planifiées, y compris leur compte d'exécution et l'action lancée.",
  icacls: "NAME\n    icacls - droits d'accès (Windows)\n\nSYNOPSIS\n    icacls <fichier>\n\nDESCRIPTION\n    Affiche les autorisations NTFS d'un fichier ou dossier — utile pour\n    repérer un script modifiable par tout le monde (BUILTIN\\Users).",
  grep: "NAME\n    grep - filtrer par motif\n\nSYNOPSIS\n    <commande> | grep [-i] '<motif>'\n\nDESCRIPTION\n    Ne garde que les lignes correspondant au motif (expression régulière).\n    -i : ignore la casse. Utilisable uniquement après un pipe '|'.",
  wc: "NAME\n    wc - compter\n\nSYNOPSIS\n    <commande> | wc -l\n\nDESCRIPTION\n    Compte les lignes de l'entrée (avec -l), ou le nombre de caractères sans\n    option. Utilisable uniquement après un pipe '|'.",
  sort: "NAME\n    sort - trier des lignes\n\nSYNOPSIS\n    <commande> | sort [-u]\n\nDESCRIPTION\n    Trie les lignes par ordre alphabétique. -u : supprime les doublons.\n    Utilisable uniquement après un pipe '|'.",
  head: "NAME\n    head - premières lignes\n\nSYNOPSIS\n    <commande> | head [-N]\n\nDESCRIPTION\n    Affiche les N premières lignes de l'entrée (10 par défaut). Utilisable\n    uniquement après un pipe '|'.",
  tail: "NAME\n    tail - dernières lignes\n\nSYNOPSIS\n    <commande> | tail [-N]\n\nDESCRIPTION\n    Affiche les N dernières lignes de l'entrée (10 par défaut). Utilisable\n    uniquement après un pipe '|'.",
  cut: "NAME\n    cut - extraire un champ\n\nSYNOPSIS\n    <commande> | cut -d '<délim>' -f <N>\n\nDESCRIPTION\n    Découpe chaque ligne selon le délimiteur donné et n'en garde que le\n    champ N. Utilisable uniquement après un pipe '|'.",
  awk: "NAME\n    awk - extraire une colonne\n\nSYNOPSIS\n    <commande> | awk '{print $N}'\n\nDESCRIPTION\n    Version simplifiée d'awk : affiche uniquement le Nième mot de chaque\n    ligne (séparé par des espaces). Utilisable uniquement après un pipe '|'.",
  docker: "NAME\n    docker - interagir avec le démon Docker local\n\nSYNOPSIS\n    docker ps\n    docker run ...\n\nDESCRIPTION\n    docker ps liste les conteneurs en cours d'exécution sur l'hôte. Un\n    utilisateur membre du groupe 'docker' peut monter n'importe quel\n    chemin de l'hôte dans un conteneur (via -v), ce qui équivaut en\n    pratique à un accès root sur l'hôte — vérifie toujours à quels\n    groupes appartient l'utilisateur courant (`id`) sur une machine sans\n    accès sudo.",
  groups: "NAME\n    groups - groupes de l'utilisateur courant\n\nSYNOPSIS\n    groups\n\nDESCRIPTION\n    Affiche les mêmes informations que `id` côté groupes. Certains\n    groupes système (docker, disk, adm...) donnent des chemins\n    d'élévation de privilèges indirects, sans passer par sudo.",
  insane: "NAME\n    insane - mode de jeu sans indices\n\nSYNOPSIS\n    insane [on|off]\n\nDESCRIPTION\n    Active ou désactive le mode Insane : aucun indice disponible (hint et\n    chint refusent), mais le score de toute la partie (machines et\n    défis Jeopardy) est multiplié par 1.5. Ne peut être activé ou\n    désactivé que sur une sauvegarde neuve (score à 0, rien de commencé).",
  export: "NAME\n    export - exporter la sauvegarde chiffrée\n\nSYNOPSIS\n    export <passphrase>\n\nDESCRIPTION\n    Chiffre l'intégralité de la progression (score, machines, badges,\n    défis Jeopardy) avec AES-GCM (clé dérivée de la passphrase via\n    PBKDF2) et télécharge un fichier .json.enc. La passphrase n'est\n    jamais stockée ni envoyée : sans elle, le fichier est inutilisable.",
  import: "NAME\n    import - importer une sauvegarde chiffrée\n\nSYNOPSIS\n    import\n\nDESCRIPTION\n    Ouvre un sélecteur de fichier pour choisir un .json.enc généré par\n    `export`, puis demande la passphrase utilisée à l'export. En cas de\n    succès, remplace entièrement la progression locale.",
  vim: "NAME\n    vim - éditeur de texte minimal\n\nSYNOPSIS\n    vim <fichier>\n\nDESCRIPTION\n    Ouvre un mini-éditeur modal simplifié (alias : vi, nano) sur le\n    fichier donné (le crée si besoin). Une fois entré, chaque ligne\n    tapée est ajoutée au buffer -- ce n'est plus une commande shell.\n    :wq enregistre et quitte, :q! quitte sans enregistrer, :show\n    affiche le buffer courant sans quitter.",
  vi: "voir : man vim",
  nano: "voir : man vim",
  nc: "NAME\n    nc - netcat (client/écoute TCP minimal)\n\nSYNOPSIS\n    nc <ip> <port>\n    nc -lvnp <port>\n\nDESCRIPTION\n    En client, se connecte à un port ouvert d'une machine cible et affiche sa\n    bannière/version. En écoute (-l), se met en attente d'une connexion entrante\n    sur le port donné -- utile pour attraper une reverse shell si une machine\n    cible propose ce chemin (voir ses indices d'accès).",
};
function cmdMan(args) {
  const name = (args[0] || "").toLowerCase();
  if (!name) return out("Que veux-tu voir avec `man` ? Ex : man ls", "t-err");
  const page = MAN_PAGES[name];
  if (!page) return out(`Pas de page de manuel disponible dans ce simulateur pour "${args[0]}". Tape \`help\`.`);
  return out(page);
}

// ── Aide / listing machines ──────────────────────────────────────────────────
function machineStatusIcon(id) {
  const p = GAME.progress[id];
  if (p.rootFlag) return "✅";
  if (!GAME.unlocked.includes(id)) return "🔒";
  if (p.privesc) return "🟢";
  if (p.access) return "🟡";
  if (p.recon) return "🟠";
  return "⬜";
}
function renderMachinesList() {
  return MACHINES.map((m) => {
    const locked = !GAME.unlocked.includes(m.id);
    return `${machineStatusIcon(m.id)} ${m.name.padEnd(10)} ${m.difficulty.padEnd(10)} ${locked ? "(verrouillée)" : m.ip}`;
  }).join("\n");
}
function currentUnresolvedStage(machine) {
  const p = GAME.progress[machine.id];
  if (!p.recon) return "recon";
  if (!p.access) return "access";
  if (!p.privesc) return "privesc";
  return null;
}

// ── Résultat de commande ─────────────────────────────────────────────────────
function out(text, cls) { return { text: text == null ? "" : String(text), cls: cls || "t-out" }; }

function formatDuration(ms) {
  if (!ms || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ── Niveau / XP ──────────────────────────────────────────────────────────────
const XP_PER_LEVEL = 500;
function levelInfo(score) {
  const level = Math.floor(score / XP_PER_LEVEL) + 1;
  const into = score % XP_PER_LEVEL;
  return { level, into, span: XP_PER_LEVEL, pct: Math.round((into / XP_PER_LEVEL) * 100) };
}

// ── Badges / succès ──────────────────────────────────────────────────────────
const BADGE_DEFS = [
  {
    id: "no_hints",
    icon: "🎯",
    label: "Sans indice",
    desc: "Termine une machine sans utiliser le moindre indice.",
    scope: "machine",
    check: (m) => {
      const h = GAME.hintsUsed[m.id];
      return GAME.progress[m.id].rootFlag && h.recon === 0 && h.access === 0 && h.privesc === 0;
    },
  },
  {
    id: "speedrun",
    icon: "⚡",
    label: "Speedrun",
    desc: "Termine une machine en moins de 5 minutes.",
    scope: "machine",
    check: (m) => {
      const t = GAME.times[m.id];
      return GAME.progress[m.id].rootFlag && t && t.elapsedMs > 0 && t.elapsedMs < 5 * 60 * 1000;
    },
  },
  {
    id: "perfectionist",
    icon: "🏆",
    label: "Perfectionniste",
    desc: "Termine toutes les machines débloquées, sans aucun indice.",
    scope: "global",
    check: () => {
      const unlocked = MACHINES.filter((m) => !m.custom && GAME.unlocked.includes(m.id));
      if (!unlocked.length) return false;
      const allDone = unlocked.every((m) => GAME.progress[m.id].rootFlag);
      const noHints = unlocked.every((m) => {
        const h = GAME.hintsUsed[m.id];
        return h.recon === 0 && h.access === 0 && h.privesc === 0;
      });
      return allDone && noHints;
    },
  },
  {
    id: "completionist",
    icon: "🌐",
    label: "Tour complet",
    desc: "Capture le flag root de toutes les machines du lab.",
    scope: "global",
    check: () => MACHINES.filter((m) => !m.custom).every((m) => GAME.progress[m.id].rootFlag),
  },
  {
    id: "jeopardy_complete",
    icon: "🧩",
    label: "Codebreaker",
    desc: "Résous tous les défis du mode Jeopardy.",
    scope: "global",
    check: () => CHALLENGES.every((c) => GAME.jeopardy.solved[c.id]),
  },
  {
    id: "blueteam_complete",
    icon: "🛡️",
    label: "Analyste SOC",
    desc: "Résous tous les incidents du mode Blue Team.",
    scope: "global",
    check: () => BLUE_INCIDENTS.every((i) => GAME.blueteam.solved[i.id]),
  },
  {
    id: "firewall_complete",
    icon: "🧱",
    label: "Ingénieur réseau",
    desc: "Résous tous les scénarios de pare-feu.",
    scope: "global",
    check: () => FIREWALL_SCENARIOS.every((s) => GAME.firewall.solved[s.id]),
  },
  {
    id: "phishing_complete",
    icon: "📧",
    label: "Anti-hameçonnage",
    desc: "Traite correctement tous les mails du chapitre phishing.",
    scope: "global",
    check: () => PHISH_MAILS.every((m) => GAME.phishing.solved[m.id]),
  },
  {
    id: "reverse_complete",
    icon: "🔬",
    label: "Reverse engineer",
    desc: "Analyse tous les binaires du chapitre reverse engineering.",
    scope: "global",
    check: () => MALWARE_SAMPLES.every((s) => GAME.reverse.solved[s.id]),
  },
  {
    id: "stackpwn_complete",
    icon: "🧠",
    label: "Exploiteur (pédagogique)",
    desc: "Détourne l'adresse de retour dans le défi buffer overflow.",
    scope: "global",
    check: () => !!GAME.stackpwn.solved,
  },
];
function checkGlobalBadges() {
  const earned = [];
  BADGE_DEFS.filter((d) => d.scope === "global").forEach((def) => {
    if (GAME.badges[def.id]) return;
    if (def.check()) { GAME.badges[def.id] = true; earned.push(def); }
  });
  if (earned.length) {
    persistSave();
    earned.forEach((def) => toast(`${def.icon} Badge débloqué : ${def.label}`));
    if (typeof renderBadges === "function") renderBadges();
  }
}
function badgeKey(def, machine) { return def.scope === "machine" ? `${def.id}:${machine.id}` : def.id; }
function checkBadges(machine) {
  const earned = [];
  BADGE_DEFS.forEach((def) => {
    const key = badgeKey(def, machine);
    if (GAME.badges[key]) return;
    const ok = def.scope === "machine" ? def.check(machine) : def.check();
    if (ok) {
      GAME.badges[key] = true;
      earned.push(def);
    }
  });
  if (earned.length) {
    persistSave();
    earned.forEach((def) => toast(`${def.icon} Badge débloqué : ${def.label}`));
    if (typeof renderBadges === "function") renderBadges();
  }
}

// ── Fiche CVE/CVSS pédagogique ────────────────────────────────────────────────
const PRIVESC_CVSS = {
  "sudo-gtfobins": { score: "7.8", vector: "AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", label: "Élévation via binaire NOPASSWD détourné (GTFOBins)" },
  "sudo-direct": { score: "7.8", vector: "AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", label: "Élévation via commande sudo NOPASSWD directe (GTFOBins)" },
  "cron-writable": { score: "8.4", vector: "AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H", label: "Élévation via tâche planifiée (cron) inscriptible" },
  "suid-binary": { score: "7.8", vector: "AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", label: "Élévation via binaire SUID mal configuré (GTFOBins)" },
  "schtask-writable": { score: "8.4", vector: "AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H", label: "Élévation via tâche planifiée Windows inscriptible" },
  "docker-group": { score: "8.8", vector: "AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H", label: "Élévation via appartenance au groupe docker (montage du disque hôte)" },
};
function cveFiche(machine) {
  const c = PRIVESC_CVSS[machine.privesc.type] || { score: "—", vector: "n/a", label: machine.privesc.type };
  const year = 2024 + (machine.ip.split(".").pop() % 3);
  const num = String(1000 + (machine.name.length * 37) % 8999).padStart(4, "0");
  return (
    `┌─ Fiche pédagogique ────────────────────────────────────────\n` +
    `│ CVE fictive : CVE-${year}-${num}  (générée localement, à but pédagogique)\n` +
    `│ Cible       : ${machine.name} (${machine.ip})\n` +
    `│ Technique   : ${c.label}\n` +
    `│ Score CVSS  : ${c.score}  [${c.vector}]\n` +
    `└──────────────────────────────────────────────────────────────`
  );
}

// ── Catégories de speedrun (meilleurs temps locaux) ──────────────────────────
const RECORD_CATEGORIES = {
  any: "Any%",
  sans_indice: "Sans indice",
  premier_essai: "Premier essai sudo",
};
function recordBestTime(machine) {
  const t = GAME.times[machine.id];
  if (!t || !t.elapsedMs) return;
  if (!GAME.bestTimes[machine.id]) GAME.bestTimes[machine.id] = {};
  const bt = GAME.bestTimes[machine.id];
  const cats = ["any"];
  const h = GAME.hintsUsed[machine.id];
  if (h.recon === 0 && h.access === 0 && h.privesc === 0) cats.push("sans_indice");
  const sudoBased = machine.privesc.type === "sudo-gtfobins" || machine.privesc.type === "sudo-direct";
  const failedSudo = SESSION.sudoAttempts[machine.id] || 0;
  if (!sudoBased || failedSudo === 0) cats.push("premier_essai");
  cats.forEach((cat) => {
    if (!bt[cat] || t.elapsedMs < bt[cat]) bt[cat] = t.elapsedMs;
  });
}

// ── Mode Jeopardy : mini-défis indépendants du mode boîte ────────────────────
const CHALLENGES = [
  {
    id: "caesar1",
    title: "César en pleine lumière",
    category: "Crypto",
    points: 50,
    prompt:
      "Un message intercepté a été chiffré à la va-vite par un stagiaire pressé, avec un simple\n" +
      "décalage de lettres (chiffre de César).\n\n" +
      "Texte chiffré :\n  KQFL{hjxfw_kfhnqj}\n\n" +
      "Trouve le décalage utilisé et soumets le texte déchiffré tel quel comme flag.",
    answer: "FLAG{cesar_facile}",
    hints: [
      "Le chiffre de César décale chaque lettre de l'alphabet d'un nombre fixe de rangs (les autres caractères ne bougent pas).",
      "Le texte en clair commence forcément par FLAG{ — cherche le décalage qui redonne ce mot.",
      "Le décalage utilisé est 5 : pour déchiffrer, recule chaque lettre de 5 rangs dans l'alphabet.",
    ],
  },
  {
    id: "b64nested",
    title: "Base64 en poupées russes",
    category: "Crypto",
    points: 75,
    prompt:
      "Une chaîne bizarre traîne dans un fichier de config :\n\n" +
      "  Umt4QlIzdGlZWE5sTmpSZmFXMWljbWx4ZFdWOQ==\n\n" +
      "Elle a l'air familière... presque trop régulière pour être aléatoire.",
    answer: "FLAG{base64_imbrique}",
    hints: [
      "Le motif (lettres/chiffres + éventuel `=` à la fin) est caractéristique de l'encodage Base64.",
      "Décoder une fois donne encore quelque chose qui ressemble à du Base64 — il faut recommencer.",
      "Deux décodages Base64 successifs suffisent pour retrouver le texte en clair.",
    ],
  },
  {
    id: "xorcrack",
    title: "XOR à clé unique",
    category: "Crypto",
    points: 100,
    prompt:
      "Un flux chiffré par XOR avec une clé d'un seul octet répétée sur tout le message :\n\n" +
      "  6c666b6d515245587549584b49414f4e57\n\n" +
      "Indice de départ : le texte en clair commence par FLAG{ (attaque à texte clair connu).",
    answer: "FLAG{xor_cracked}",
    hints: [
      "XOR est réversible : (clair XOR clé) XOR clé = clair. Convertis d'abord l'hexa en octets.",
      "Comme tu connais le début du texte en clair (\"FLAG{\"), XOR les premiers octets du chiffré avec \"FLAG{\" pour retrouver la clé — elle doit être un octet unique répété partout.",
      "La clé est 0x2A (le caractère '*'). Applique-la à tout le message pour retrouver le texte en clair.",
    ],
  },
  {
    id: "hashcrack",
    title: "Mot de passe recyclé",
    category: "Forensics",
    points: 100,
    prompt: "(généré plus bas, une fois hash-VX défini)",
    answer: "FLAG{hashcrack_dragon}",
    hints: [
      "Il n'y a pas de miracle : ce genre de hash se casse par force brute contre une liste de mots de passe courants.",
      "Le lab embarque une petite wordlist. Essaie la commande `hashcat <hash>`.",
      "Tape `hashcat --list` pour voir la wordlist embarquée si tu veux la parcourir toi-même.",
    ],
  },
  {
    id: "acrostiche",
    title: "Notes internes suspectes",
    category: "Misc",
    points: 75,
    prompt:
      "Une note interne a été maquillée en texte anodin. Regarde bien la première lettre de\n" +
      "chaque ligne :\n\n" +
      "  Après cette inspection, rien ne va plus.\n" +
      "  Chaque signal doit être vérifié deux fois.\n" +
      "  Reste calme et regarde les détails.\n" +
      "  Oublie les fausses pistes évidentes.\n" +
      "  Suis la première lettre, ligne par ligne.\n" +
      "  Tout indice compte, même le plus discret.\n" +
      "  Il faut de la patience pour ce genre de jeu.\n" +
      "  Cela demande un œil attentif.\n" +
      "  Heureusement, la solution est proche.\n" +
      "  Enfin, assemble ce que tu as trouvé.\n\n" +
      "Le mot obtenu est la réponse, au format FLAG{mot_en_minuscules}.",
    answer: "FLAG{acrostiche}",
    hints: [
      "C'est un acrostiche : la première lettre de chaque ligne compte, dans l'ordre.",
      "Assemble les dix premières lettres, une par ligne.",
      "Le mot obtenu est \"ACROSTICHE\" — mets-le en minuscules dans FLAG{...}.",
    ],
  },
  {
    id: "rsatoy",
    title: "RSA au rabais",
    category: "Crypto",
    points: 125,
    prompt:
      "Un service interne chiffre ses messages avec RSA... mais avec des clés ridiculement petites\n" +
      "pour \"économiser du CPU\". Grave erreur : un module aussi petit se factorise en un instant.\n\n" +
      "Clé publique : n = 3233, e = 17\n\n" +
      "Message chiffré, un caractère par bloc (décimal, séparés par des virgules) :\n" +
      "  325,2726,2790,669,855,2412,1230,1632,119,1696,2185,2160,1313,884,1516\n\n" +
      "Retrouve la clé privée d, déchiffre bloc par bloc, convertis chaque nombre obtenu en\n" +
      "caractère ASCII, puis soumets le mot reconstitué (déjà au format FLAG{...}).",
    answer: "FLAG{rsa_jouet}",
    hints: [
      "RSA : n = p × q. Avec n aussi petit (3233), factorise-le directement (61 × 53) — pas besoin d'outil sophistiqué.",
      "Calcule φ(n) = (p-1)(q-1) = 3120, puis trouve d, l'inverse modulaire de e=17 modulo 3120 (d = 2753). Le déchiffrement d'un bloc c est m = c^d mod n.",
      "Une fois d trouvé, déchiffre chaque bloc (c^d mod n) et convertis le résultat en caractère ASCII (String.fromCharCode en JS, chr() en Python) : mis bout à bout, ça donne directement FLAG{rsa_jouet}.",
    ],
  },
  {
    id: "exifhidden",
    title: "Photo de vacances suspecte",
    category: "Forensics",
    points: 90,
    prompt:
      "Une photo `vacances_2024.jpg` a été retrouvée sur un poste compromis. Le fichier binaire\n" +
      "n'est pas exploitable ici, mais voici l'extraction de ses métadonnées EXIF telle que\n" +
      "produite par l'outil d'investigation :\n\n" +
      "  {\n" +
      "    \"Make\": \"NIKON CORPORATION\",\n" +
      "    \"Model\": \"NIKON D850\",\n" +
      "    \"DateTimeOriginal\": \"2024:07:12 16:41:03\",\n" +
      "    \"GPSLatitude\": null,\n" +
      "    \"Software\": \"Adobe Photoshop 25.0\",\n" +
      "    \"UserComment\": \"}seehcac_seennodatem_fixe{GALF\"\n" +
      "  }\n\n" +
      "Le champ UserComment ne ressemble à rien de lisible tel quel... jusqu'à ce qu'on remarque\n" +
      "quelque chose.",
    answer: "FLAG{exif_metadonnees_cachees}",
    hints: [
      "La plupart des champs EXIF sont normaux (marque, modèle, date...) sauf un, qui ne devrait pas contenir ce genre de texte.",
      "Regarde le champ `UserComment` de plus près : le motif `}...{GALF` à l'envers, ça te dit quelque chose ?",
      "Le texte est simplement inversé caractère par caractère. Lis-le de droite à gauche pour retrouver FLAG{exif_metadonnees_cachees}.",
    ],
  },
];

// Hash-VX : algorithme maison non cryptographique, uniquement pour le mini-jeu hashcat (pas de vraie sécurité).
function fakeHash(str) {
  let h1 = 0x12345678, h2 = 0x87654321;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (h2 + c) * 2654435761 >>> 0;
    h1 = ((h1 << 13) | (h1 >>> 19)) >>> 0;
    h2 = ((h2 << 7) | (h2 >>> 25)) >>> 0;
  }
  const hex = (n) => n.toString(16).padStart(8, "0");
  return hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(h2 ^ 0xdeadbeef);
}
const WORDLIST_MINI = [
  "123456", "password", "admin", "letmein", "qwerty", "password123", "dragon",
  "monkey", "football", "iloveyou", "welcome", "abc123", "111111", "sunshine",
  "master", "shadow", "superman", "trustno1", "hunter2", "baseball",
];
CHALLENGES.find((c) => c.id === "hashcrack").prompt =
  "Un administrateur pressé a réutilisé un mot de passe très commun. Son hash-VX (algorithme\n" +
  "maison, fictif — sans rapport avec un vrai MD5/SHA) est :\n\n" +
  "  " + fakeHash("dragon") + "\n\n" +
  "Retrouve le mot de passe en clair et soumets FLAG{hashcrack_<motdepasse>} (en minuscules).";

function cmdHashcat(args) {
  if (args[0] === "--list") {
    return out("Wordlist embarquée (" + WORDLIST_MINI.length + " entrées) :\n" + WORDLIST_MINI.join("\n"));
  }
  const hash = (args[0] || "").toLowerCase();
  if (!hash) return out("usage: hashcat <hash-vx> | hashcat --list", "t-err");
  const found = WORDLIST_MINI.find((w) => fakeHash(w) === hash);
  if (found) return out(`Correspondance trouvée dans la wordlist !\n  ${hash}\n  -> ${found}`, "t-ok");
  return out("Aucune correspondance dans la wordlist embarquée. Essaie `hashcat --list` pour la consulter.", "t-err");
}

function cmdChallenges() {
  const lines = ["Défis Jeopardy (indépendants des machines) :", ""];
  CHALLENGES.forEach((c) => {
    const solved = GAME.jeopardy.solved[c.id];
    lines.push(`${solved ? "✅" : "🧩"} ${c.id.padEnd(11)} [${c.category.padEnd(9)}] ${String(c.points).padStart(3)} pts  ${c.title}`);
  });
  lines.push("");
  lines.push("Détail : `challenge <id>` · Indice : `chint <id>` · Réponse : `submit <id> <flag>`");
  return out(lines.join("\n"));
}
function cmdChallengeShow(args) {
  const c = CHALLENGES.find((cc) => cc.id === args[0]);
  if (!c) return out(`Défi inconnu. Tape \`challenges\` pour la liste.`, "t-err");
  const solved = GAME.jeopardy.solved[c.id];
  return out(
    `━━ ${c.title} [${c.category} · ${c.points} pts]${solved ? " — déjà résolu ✅" : ""} ━━\n\n${c.prompt}`
  );
}
function cmdChallengeHint(args) {
  const c = CHALLENGES.find((cc) => cc.id === args[0]);
  if (!c) return out(`Défi inconnu. Tape \`challenges\` pour la liste.`, "t-err");
  if (GAME.insaneMode) return out("🔥 Mode Insane actif : aucun indice disponible.", "t-err");
  if (!GAME.jeopardy.hintsUsed[c.id]) GAME.jeopardy.hintsUsed[c.id] = 0;
  const n = GAME.jeopardy.hintsUsed[c.id];
  if (n >= c.hints.length) return out("Plus d'indice disponible pour ce défi.", "t-hint");
  GAME.jeopardy.hintsUsed[c.id] = n + 1;
  persistSave();
  return out(`💡 Indice ${n + 1}/${c.hints.length} :\n${c.hints[n]}`, "t-hint");
}
function cmdSubmit(args) {
  const c = CHALLENGES.find((cc) => cc.id === args[0]);
  if (!c) return out(`Défi inconnu. Tape \`challenges\` pour la liste.`, "t-err");
  if (GAME.jeopardy.solved[c.id]) return out("Déjà résolu — bien joué !", "t-hint");
  const submitted = args.slice(1).join(" ").trim();
  if (submitted !== c.answer) return out("❌ Mauvaise réponse — retente ta chance.", "t-err");
  GAME.jeopardy.solved[c.id] = true;
  addScore(c.points);
  toast(`🧩 Défi résolu : ${c.title} (+${c.points} pts)`);
  if (typeof playFlagSound === "function") playFlagSound();
  if (typeof spawnFlagParticles === "function") spawnFlagParticles();
  checkGlobalBadges();
  persistSave();
  if (typeof renderSidebar === "function") renderSidebar();
  return out(`✅ Bonne réponse ! +${c.points} pts.`, "t-ok");
}
function cmdDaily() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, stable pour la journée
  let seed = 0;
  for (let i = 0; i < today.length; i++) seed = (seed * 31 + today.charCodeAt(i)) >>> 0;
  const c = CHALLENGES[seed % CHALLENGES.length];
  const solved = GAME.jeopardy.solved[c.id];
  return out(
    `🔥 Défi du jour (${today}) : ${c.title} [${c.category} · ${c.points} pts]${solved ? " — déjà résolu ✅" : ""}\n` +
    `Tape \`challenge ${c.id}\` pour le voir.`
  );
}

// ── Mode Blue Team : analyse de logs (SOC), tout en dur, aucune IA ───────────
const BLUE_INCIDENTS = [
  {
    id: "bt-ssh", title: "Connexions SSH suspectes", points: 200,
    scenario: "Le serveur `srv-web01` a levé une alerte de connexions SSH répétées cette nuit. Voici un extrait de /var/log/auth.log. Identifie l'attaquant, ce qu'il a obtenu et comment.",
    log: [
      "Jan 12 02:58:10 srv-web01 sshd[1990]: Accepted password for deploy from 10.0.0.5 port 40122 ssh2",
      "Jan 12 03:14:02 srv-web01 sshd[2011]: Failed password for admin from 45.83.12.7 port 51122 ssh2",
      "Jan 12 03:14:03 srv-web01 sshd[2013]: Failed password for admin from 45.83.12.7 port 51124 ssh2",
      "Jan 12 03:14:05 srv-web01 sshd[2015]: Failed password for root from 45.83.12.7 port 51130 ssh2",
      "Jan 12 03:14:07 srv-web01 sshd[2017]: Failed password for admin from 45.83.12.7 port 51133 ssh2",
      "Jan 12 03:14:10 srv-web01 sshd[2019]: Failed password for admin from 45.83.12.7 port 51140 ssh2",
      "Jan 12 03:15:41 srv-web01 sshd[2044]: Failed password for postgres from 45.83.12.7 port 51190 ssh2",
      "Jan 12 03:18:22 srv-web01 sshd[2088]: Failed password for admin from 45.83.12.7 port 51350 ssh2",
      "Jan 12 03:19:48 srv-web01 sshd[2101]: Accepted password for admin from 45.83.12.7 port 51402 ssh2",
      "Jan 12 03:19:48 srv-web01 sshd[2101]: pam_unix(sshd:session): session opened for user admin by (uid=0)",
    ].join("\n"),
    questions: [
      { id: "ip", prompt: "IP de l'attaquant ?", accept: ["45.83.12.7"], hint: "Une seule IP enchaîne des dizaines d'échecs d'affilée." },
      { id: "user", prompt: "Compte finalement compromis ?", accept: ["admin"], hint: "Cherche la ligne « Accepted password » qui vient de l'IP attaquante." },
      { id: "time", prompt: "Heure de la compromission (HH:MM) ?", accept: ["03:19", "0319"], hint: "L'horodatage du « Accepted password » depuis l'IP malveillante." },
      { id: "technique", prompt: "Technique employée (un mot) ?", accept: ["bruteforce", "forcebrute", "bruteforcessh", "dictionnaire"], hint: "Beaucoup d'essais de mots de passe jusqu'au succès." },
    ],
  },
  {
    id: "bt-lfi", title: "Requêtes web anormales", points: 200,
    scenario: "Le WAF a laissé passer du trafic étrange sur le site vitrine. Extrait du access.log Nginx. Qui attaque, quoi, et comment ?",
    log: [
      '198.51.100.23 - - [12/Jan/2026:10:02:11 +0000] "GET / HTTP/1.1" 200 1043 "-" "Mozilla/5.0"',
      '203.0.113.77 - - [12/Jan/2026:10:05:31 +0000] "GET /index.php?page=../../../../etc/passwd HTTP/1.1" 200 812 "-" "curl/8.2"',
      '203.0.113.77 - - [12/Jan/2026:10:05:44 +0000] "GET /index.php?page=../../../../etc/shadow HTTP/1.1" 403 153 "-" "curl/8.2"',
      '198.51.100.23 - - [12/Jan/2026:10:06:02 +0000] "GET /about HTTP/1.1" 200 2210 "-" "Mozilla/5.0"',
      '203.0.113.77 - - [12/Jan/2026:10:06:20 +0000] "GET /index.php?page=../../../../var/log/auth.log HTTP/1.1" 200 4501 "-" "curl/8.2"',
    ].join("\n"),
    questions: [
      { id: "ip", prompt: "IP de l'attaquant ?", accept: ["203.0.113.77"], hint: "L'IP qui manipule le paramètre `page=` avec des `../`." },
      { id: "fichier", prompt: "Premier fichier sensible lu avec succès (code 200) ?", accept: ["/etc/passwd", "etcpasswd"], hint: "La 1re requête `page=../../etc/...` renvoie un 200 ; `/etc/shadow` lui renvoie 403." },
      { id: "technique", prompt: "Technique (un mot / sigle) ?", accept: ["lfi", "traversal", "pathtraversal", "directorytraversal", "inclusiondefichier"], hint: "Remonter l'arborescence avec `../` pour lire des fichiers = inclusion de fichier local." },
    ],
  },
  {
    id: "bt-sqli", title: "Scan applicatif automatisé", points: 200,
    scenario: "La boutique en ligne renvoie des erreurs SQL intermittentes. Extrait du access.log. Identifie l'outil et la technique.",
    log: [
      '192.0.2.88 - - [12/Jan/2026:14:21:09 +0000] "GET /products?id=1 HTTP/1.1" 200 900 "-" "sqlmap/1.7"',
      '192.0.2.88 - - [12/Jan/2026:14:21:10 +0000] "GET /products?id=1%20AND%201=1 HTTP/1.1" 200 900 "-" "sqlmap/1.7"',
      '192.0.2.88 - - [12/Jan/2026:14:21:12 +0000] "GET /products?id=1%20AND%201=2 HTTP/1.1" 200 42 "-" "sqlmap/1.7"',
      '192.0.2.88 - - [12/Jan/2026:14:21:15 +0000] "GET /products?id=1%20UNION%20SELECT%20username,password%20FROM%20users HTTP/1.1" 200 1337 "-" "sqlmap/1.7"',
    ].join("\n"),
    questions: [
      { id: "ip", prompt: "IP de l'attaquant ?", accept: ["192.0.2.88"], hint: "Une seule IP, un User-Agent très parlant." },
      { id: "outil", prompt: "Outil utilisé (User-Agent) ?", accept: ["sqlmap"], hint: "Regarde le champ User-Agent entre guillemets." },
      { id: "technique", prompt: "Technique (sigle) ?", accept: ["sqli", "injectionsql", "sqlinjection", "unionbased"], hint: "`UNION SELECT ... FROM users` dans un paramètre = injection SQL." },
    ],
  },
];
function btNorm(s) { return String(s || "").trim().toLowerCase().replace(/[\s_\-]/g, ""); }
function cmdBlueteam() {
  const lines = ["🛡️ Mode Blue Team — analyse de logs (façon SOC) :", ""];
  BLUE_INCIDENTS.forEach((inc) => {
    const solved = GAME.blueteam.solved[inc.id];
    const ans = GAME.blueteam.answered[inc.id] || {};
    const done = inc.questions.filter((q) => ans[q.id]).length;
    lines.push(`${solved ? "✅" : "🛡️"} ${inc.id.padEnd(9)} ${String(inc.points).padStart(3)} pts  ${inc.title}  (${done}/${inc.questions.length} réponses)`);
  });
  lines.push("");
  lines.push("Détail + logs : `incident <id>` · Indice : `bthint <id> <question>` · Réponse : `answer <id> <question> <valeur>`");
  return out(lines.join("\n"));
}
function cmdIncident(args) {
  const inc = BLUE_INCIDENTS.find((i) => i.id === args[0]);
  if (!inc) return out("Incident inconnu. Tape `blueteam` pour la liste.", "t-err");
  const ans = GAME.blueteam.answered[inc.id] || {};
  const solved = GAME.blueteam.solved[inc.id];
  const qlines = inc.questions.map((q) => `  ${ans[q.id] ? "✅" : "❓"} [${q.id}] ${q.prompt}`);
  return out(
    `━━ ${inc.title} [${inc.points} pts]${solved ? " — résolu ✅" : ""} ━━\n\n${inc.scenario}\n\n` +
      `─── LOGS ───\n${inc.log}\n────────────\n\n` +
      `Questions :\n${qlines.join("\n")}\n\n` +
      `Réponds avec : \`answer ${inc.id} <question> <valeur>\` (ex : \`answer ${inc.id} ${inc.questions[0].id} ...\`). Indice : \`bthint ${inc.id} <question>\`.`,
  );
}
function cmdBthint(args) {
  const inc = BLUE_INCIDENTS.find((i) => i.id === args[0]);
  if (!inc) return out("Incident inconnu. Tape `blueteam` pour la liste.", "t-err");
  const q = inc.questions.find((qq) => qq.id === args[1]);
  if (!q) return out(`Question inconnue. Questions : ${inc.questions.map((qq) => qq.id).join(", ")}.`, "t-err");
  if (GAME.insaneMode) return out("🔥 Mode Insane actif : aucun indice disponible.", "t-err");
  if (!GAME.blueteam.hintsUsed[inc.id]) GAME.blueteam.hintsUsed[inc.id] = {};
  GAME.blueteam.hintsUsed[inc.id][q.id] = (GAME.blueteam.hintsUsed[inc.id][q.id] || 0) + 1;
  persistSave();
  return out(`💡 ${inc.id}/${q.id} : ${q.hint}`, "t-hint");
}
function cmdAnswer(args) {
  const inc = BLUE_INCIDENTS.find((i) => i.id === args[0]);
  if (!inc) return out("Incident inconnu. Tape `blueteam` pour la liste.", "t-err");
  const q = inc.questions.find((qq) => qq.id === args[1]);
  if (!q) return out(`Question inconnue. Questions de ${inc.id} : ${inc.questions.map((qq) => qq.id).join(", ")}.`, "t-err");
  if (GAME.blueteam.solved[inc.id]) return out("Incident déjà résolu — bien joué, analyste !", "t-hint");
  const value = args.slice(2).join(" ").trim();
  if (!value) return out(`usage: answer ${inc.id} ${q.id} <valeur>`, "t-err");
  if (!q.accept.map(btNorm).includes(btNorm(value))) return out("❌ Mauvaise réponse — relis les logs.", "t-err");
  if (!GAME.blueteam.answered[inc.id]) GAME.blueteam.answered[inc.id] = {};
  GAME.blueteam.answered[inc.id][q.id] = true;
  const ans = GAME.blueteam.answered[inc.id];
  const remaining = inc.questions.filter((qq) => !ans[qq.id]);
  if (remaining.length) {
    persistSave();
    return out(`✅ Bonne réponse pour « ${q.id} ». Reste : ${remaining.map((qq) => qq.id).join(", ")}.`, "t-ok");
  }
  // toutes les questions correctes -> incident résolu
  GAME.blueteam.solved[inc.id] = true;
  addScore(inc.points);
  toast(`🛡️ Incident résolu : ${inc.title} (+${inc.points} pts)`);
  if (typeof playFlagSound === "function") playFlagSound();
  if (typeof spawnFlagParticles === "function") spawnFlagParticles();
  checkGlobalBadges();
  persistSave();
  if (typeof renderSidebar === "function") renderSidebar();
  return out(`✅ Dernière réponse correcte — incident « ${inc.title} » résolu ! +${inc.points} pts.`, "t-ok");
}

// ── Pare-feu simulé en CLI (iptables-like) : lire/modifier des règles ────────
// Modèle simplifié : règles par chaîne évaluées de haut en bas, 1re correspondance
// décide ; sinon la policy par défaut de la chaîne s'applique. Aucun vrai réseau.
const FIREWALL_SCENARIOS = [
  {
    id: "fw-harden", title: "Durcir le pare-feu du serveur web", points: 200,
    brief: "Le serveur laisse tout passer (policy INPUT ACCEPT). Objectif : n'autoriser que le web (80/443) depuis n'importe où, garder SSH (22) uniquement depuis le LAN 10.0.0.0/8, et fermer le reste (dont Telnet 23).",
    policy: { INPUT: "ACCEPT", OUTPUT: "ACCEPT", FORWARD: "ACCEPT" },
    rules: [],
    goals: [
      { type: "open", proto: "tcp", dport: 80, source: "198.51.100.9", label: "HTTP (80/tcp) ouvert depuis l'extérieur" },
      { type: "open", proto: "tcp", dport: 443, source: "198.51.100.9", label: "HTTPS (443/tcp) ouvert depuis l'extérieur" },
      { type: "open", proto: "tcp", dport: 22, source: "10.0.0.5", label: "SSH (22/tcp) ouvert depuis le LAN 10.0.0.0/8" },
      { type: "closed", proto: "tcp", dport: 22, source: "203.0.113.9", label: "SSH (22/tcp) fermé depuis l'extérieur" },
      { type: "closed", proto: "tcp", dport: 23, source: "203.0.113.9", label: "Telnet (23/tcp) fermé" },
    ],
  },
  {
    id: "fw-block", title: "Bloquer un attaquant sans couper le web", points: 200,
    brief: "L'hôte 203.0.113.66 martèle le serveur. Bloque-le totalement — y compris sur le port 80 — sans couper le trafic web légitime des autres. (Attention à l'ordre des règles : la 1re qui correspond gagne.)",
    policy: { INPUT: "ACCEPT", OUTPUT: "ACCEPT", FORWARD: "ACCEPT" },
    rules: [{ chain: "INPUT", source: "any", proto: "tcp", dport: 80, target: "ACCEPT" }],
    goals: [
      { type: "blocked", proto: "tcp", dport: 80, source: "203.0.113.66", label: "203.0.113.66 bloqué (même sur le port 80)" },
      { type: "open", proto: "tcp", dport: 80, source: "198.51.100.10", label: "HTTP (80/tcp) toujours ouvert pour les autres" },
    ],
  },
];
function ipToInt(ip) {
  const p = String(ip).split(".").map(Number);
  if (p.length !== 4 || p.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
function ipInRange(ip, range) {
  if (range === "any" || range === "0.0.0.0/0") return true;
  if (String(range).includes("/")) {
    const [base, bitsRaw] = range.split("/");
    const bits = Number(bitsRaw);
    const bi = ipToInt(base), ii = ipToInt(ip);
    if (bi == null || ii == null) return false;
    const mask = bits <= 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return (ii & mask) === (bi & mask);
  }
  return ip === range;
}
function fwMatch(rule, pkt) {
  return (rule.source === "any" || ipInRange(pkt.src, rule.source))
    && (rule.proto === "all" || rule.proto === pkt.proto)
    && (rule.dport == null || rule.dport === pkt.dport);
}
function fwEval(fw, pkt) {
  for (const r of fw.rules) {
    if (r.chain !== pkt.chain) continue;
    if (fwMatch(r, pkt)) return r.target;
  }
  return fw.policy[pkt.chain] || "ACCEPT";
}
function fwGoalMet(fw, g) {
  const pkt = { chain: "INPUT", src: g.source, proto: g.proto || "tcp", dport: g.dport };
  const verdict = fwEval(fw, pkt);
  if (g.type === "open") return verdict === "ACCEPT";
  return verdict === "DROP"; // "closed" et "blocked"
}
function fwScenario(id) { return FIREWALL_SCENARIOS.find((s) => s.id === id); }
function fwStartState(scen) {
  return { id: scen.id, policy: Object.assign({}, scen.policy), rules: scen.rules.map((r) => Object.assign({}, r)) };
}
function renderFirewall(fw) {
  const scen = fwScenario(fw.id);
  const lines = [];
  const chains = ["INPUT", "OUTPUT", "FORWARD"].filter((ch) => ch === "INPUT" || fw.rules.some((r) => r.chain === ch));
  for (const ch of chains) {
    lines.push(`Chain ${ch} (policy ${fw.policy[ch]})`);
    lines.push(`  num  target  prot  source            dport`);
    const rs = fw.rules.filter((r) => r.chain === ch);
    if (!rs.length) lines.push("  (aucune règle)");
    rs.forEach((r, i) => {
      lines.push(`  ${String(i + 1).padEnd(4)} ${r.target.padEnd(7)} ${r.proto.padEnd(5)} ${String(r.source).padEnd(17)} ${r.dport == null ? "*" : r.dport}`);
    });
  }
  lines.push("");
  lines.push("Objectifs :");
  scen.goals.forEach((g) => lines.push(`  ${fwGoalMet(fw, g) ? "✅" : "❌"} ${g.label}`));
  return lines.join("\n");
}
function cmdFirewall(args) {
  const sub = (args[0] || "").toLowerCase();
  if (!sub) {
    const lines = ["🧱 Pare-feu simulé — scénarios (lecture/écriture de règles iptables) :", ""];
    FIREWALL_SCENARIOS.forEach((s) => lines.push(`${GAME.firewall.solved[s.id] ? "✅" : "🧱"} ${s.id.padEnd(10)} ${String(s.points).padStart(3)} pts  ${s.title}`));
    lines.push("");
    lines.push("Démarre : `firewall <id>`. Puis modifie avec `iptables ...`. `firewall reset` recharge, `firewall exit` quitte.");
    return out(lines.join("\n"));
  }
  if (sub === "exit" || sub === "quit") { SESSION.firewall = null; return out("Mode pare-feu quitté."); }
  if (sub === "reset") {
    if (!SESSION.firewall) return out("Aucun scénario de pare-feu en cours.", "t-err");
    SESSION.firewall = fwStartState(fwScenario(SESSION.firewall.id));
    return out("Règles réinitialisées.\n\n" + renderFirewall(SESSION.firewall));
  }
  const scen = fwScenario(sub);
  if (!scen) return out("Scénario inconnu. Tape `firewall` pour la liste.", "t-err");
  SESSION.firewall = fwStartState(scen);
  return out(`━━ ${scen.title} [${scen.points} pts]${GAME.firewall.solved[scen.id] ? " — résolu ✅" : ""} ━━\n\n${scen.brief}\n\n` + renderFirewall(SESSION.firewall) + "\n\nModifie avec `iptables -A/-I/-D/-P/-F ...`, puis vise tous les ✅.");
}
function parseIptables(args) {
  if (args.includes("-L") || args.includes("--list")) return { op: "list" };
  if (args.includes("-F") || args.includes("--flush")) return { op: "flush" };
  const pIdx = args.indexOf("-P");
  if (pIdx >= 0) return { op: "policy", chain: (args[pIdx + 1] || "").toUpperCase(), policy: (args[pIdx + 2] || "").toUpperCase() };
  const dIdx = args.indexOf("-D");
  if (dIdx >= 0) return { op: "delete", chain: (args[dIdx + 1] || "").toUpperCase(), index: parseInt(args[dIdx + 2], 10) };
  const aIdx = args.indexOf("-A"), iIdx = args.indexOf("-I");
  if (aIdx >= 0 || iIdx >= 0) {
    const base = aIdx >= 0 ? aIdx : iIdx;
    const chain = (args[base + 1] || "").toUpperCase();
    let pos = null;
    if (iIdx >= 0) { const maybe = args[iIdx + 2]; pos = /^\d+$/.test(maybe || "") ? parseInt(maybe, 10) : 1; }
    const rule = { chain, source: "any", proto: "all", dport: null, target: "ACCEPT" };
    const sIdx = args.findIndex((a) => a === "-s" || a === "--source");
    if (sIdx >= 0) rule.source = args[sIdx + 1];
    const prIdx = args.indexOf("-p");
    if (prIdx >= 0) rule.proto = (args[prIdx + 1] || "all").toLowerCase();
    const dpIdx = args.indexOf("--dport");
    if (dpIdx >= 0) rule.dport = parseInt(args[dpIdx + 1], 10);
    const jIdx = args.indexOf("-j");
    if (jIdx >= 0) rule.target = (args[jIdx + 1] || "ACCEPT").toUpperCase();
    return { op: iIdx >= 0 ? "insert" : "append", rule, pos };
  }
  return null;
}
function cmdIptables(args) {
  if (!SESSION.firewall) return out("iptables : démarre d'abord un scénario avec `firewall <id>` (mode pare-feu).", "t-err");
  const fw = SESSION.firewall;
  const cmd = parseIptables(args);
  if (!cmd) return out("iptables : commande non reconnue. Ex : `iptables -A INPUT -p tcp --dport 80 -j ACCEPT`, `iptables -P INPUT DROP`, `iptables -L`.", "t-err");
  const VALID_CHAINS = ["INPUT", "OUTPUT", "FORWARD"];
  if (cmd.op === "list") return out(renderFirewall(fw));
  if (cmd.op === "flush") { fw.rules = []; }
  else if (cmd.op === "policy") {
    if (!VALID_CHAINS.includes(cmd.chain)) return out(`iptables : chaîne inconnue « ${cmd.chain} ».`, "t-err");
    if (!["ACCEPT", "DROP"].includes(cmd.policy)) return out("iptables : policy attendue ACCEPT ou DROP.", "t-err");
    fw.policy[cmd.chain] = cmd.policy;
  } else if (cmd.op === "delete") {
    const rs = fw.rules.filter((r) => r.chain === cmd.chain);
    if (!(cmd.index >= 1 && cmd.index <= rs.length)) return out(`iptables : règle #${cmd.index} inexistante dans ${cmd.chain}.`, "t-err");
    const target = rs[cmd.index - 1];
    fw.rules.splice(fw.rules.indexOf(target), 1);
  } else { // append / insert
    if (!VALID_CHAINS.includes(cmd.rule.chain)) return out(`iptables : chaîne inconnue « ${cmd.rule.chain} ».`, "t-err");
    if (!["ACCEPT", "DROP"].includes(cmd.rule.target)) return out("iptables : cible (-j) attendue ACCEPT ou DROP.", "t-err");
    if (cmd.op === "insert") {
      const chainRules = fw.rules.filter((r) => r.chain === cmd.rule.chain);
      const anchor = chainRules[(cmd.pos || 1) - 1];
      const at = anchor ? fw.rules.indexOf(anchor) : fw.rules.length;
      fw.rules.splice(at, 0, cmd.rule);
    } else {
      fw.rules.push(cmd.rule);
    }
  }
  // Vérifie les objectifs après toute modification
  const scen = fwScenario(fw.id);
  const allMet = scen.goals.every((g) => fwGoalMet(fw, g));
  let footer = "";
  if (allMet && !GAME.firewall.solved[fw.id]) {
    GAME.firewall.solved[fw.id] = true;
    addScore(scen.points);
    toast(`🧱 Scénario pare-feu résolu : ${scen.title} (+${scen.points} pts)`);
    if (typeof playFlagSound === "function") playFlagSound();
    checkGlobalBadges();
    persistSave();
    if (typeof renderSidebar === "function") renderSidebar();
    footer = `\n\n✅ Tous les objectifs atteints — scénario résolu ! +${scen.points} pts. \`firewall exit\` pour quitter.`;
  }
  return out(renderFirewall(fw) + footer, allMet ? "t-ok" : "t-out");
}

// ── Chapitre phishing : analyser une boîte mail (en-têtes, domaines, liens) ──
const PHISH_MAILS = [
  {
    id: "mail-it", points: 150, phishing: true,
    from: "Support Informatique", fromAddr: "it-support@solenne-secure.com",
    replyTo: "recovery@mail-secure-login.ru", returnPath: "<bounce@mail-secure-login.ru>", spf: "fail",
    subject: "URGENT : votre compte sera suspendu sous 24h",
    date: "lun. 12 janv. 03:41",
    body: "Cher utilisateur,\nNous avons détecté une activité inhabituelle sur votre compte. Pour éviter une suspension immédiate, confirmez vos identifiants dans les 24 heures en cliquant sur le lien ci-dessous.\n\nCordialement,\nLe service informatique",
    links: ["http://solenne-hr.verify-account.ru/login?u=admin"],
    questions: [
      { id: "verdict", prompt: "Phishing ou légitime ?", accept: ["phishing"], hint: "Un mail interne légitime ne réclame pas tes identifiants en urgence via un lien externe." },
      { id: "indice", prompt: "Cite UN indicateur (mot-clé) qui trahit le phishing.", contains: true, accept: ["domaine", "typosquat", "lookalike", "url", "lien", "urgence", "spf", "replyto", "reply-to", ".ru", "ru", "tld", "usurp"], hint: "Regarde le domaine du lien / du Reply-To (`.ru`), le SPF (fail) et le ton (urgence)." },
    ],
  },
  {
    id: "mail-news", points: 100, phishing: false,
    from: "Communication Solenne", fromAddr: "news@solenne-holdings.com",
    replyTo: "news@solenne-holdings.com", returnPath: "<news@solenne-holdings.com>", spf: "pass",
    subject: "Newsletter interne — janvier",
    date: "mar. 06 janv. 09:12",
    body: "Bonjour à toutes et à tous,\nRetrouvez les actualités du mois : nouveaux arrivants, projets en cours et dates à retenir. Aucune action de votre part n'est requise.\n\nBonne lecture,\nLa Communication interne",
    links: [],
    questions: [
      { id: "verdict", prompt: "Phishing ou légitime ?", accept: ["legitime", "legit", "légitime", "safe", "ok"], hint: "Domaine cohérent (solenne-holdings.com), SPF pass, aucun lien de connexion ni urgence : rien de suspect." },
    ],
  },
  {
    id: "mail-invoice", points: 150, phishing: true,
    from: "Comptabilité Fournisseur", fromAddr: "billing@invoices-247.biz",
    replyTo: "billing@invoices-247.biz", returnPath: "<noreply@invoices-247.biz>", spf: "fail",
    subject: "Facture impayée #4471 — action requise",
    date: "jeu. 15 janv. 18:02",
    body: "Madame, Monsieur,\nVotre facture reste impayée. Merci d'ouvrir la pièce jointe et de la régulariser sans délai afin d'éviter des pénalités.",
    attachment: "facture.pdf.exe",
    links: [],
    questions: [
      { id: "verdict", prompt: "Phishing ou légitime ?", accept: ["phishing"], hint: "Une « facture » en `.exe`, ça n'existe pas. Regarde bien la pièce jointe." },
      { id: "indice", prompt: "Cite UN indicateur (mot-clé) qui trahit le phishing.", contains: true, accept: ["piecejointe", "piece", "exe", "extension", "executable", "doubleextension", "attachement", "attachment", "spf"], hint: "La pièce jointe `facture.pdf.exe` : double extension, un exécutable déguisé en PDF." },
    ],
  },
];
function cmdPhishing() {
  const lines = ["📧 Chapitre phishing — analyse ta boîte mail :", ""];
  PHISH_MAILS.forEach((m) => {
    const solved = GAME.phishing.solved[m.id];
    lines.push(`${solved ? "✅" : "📧"} ${m.id.padEnd(12)} ${String(m.points).padStart(3)} pts  « ${m.subject} »`);
  });
  lines.push("");
  lines.push("Ouvre un mail : `mail <id>` · Réponds : `report <id> verdict phishing|legitime` (+ `report <id> indice <mot>` si c'est du phishing) · Indice : `phhint <id> <question>`");
  return out(lines.join("\n"));
}
function cmdMail(args) {
  const m = PHISH_MAILS.find((mm) => mm.id === args[0]);
  if (!m) return out("Mail inconnu. Tape `phishing` pour la liste.", "t-err");
  const ans = GAME.phishing.answered[m.id] || {};
  const solved = GAME.phishing.solved[m.id];
  const head = [
    `De        : ${m.from} <${m.fromAddr}>`,
    `Reply-To  : ${m.replyTo}`,
    `Return-Path: ${m.returnPath}`,
    `Received-SPF: ${m.spf}`,
    `Date      : ${m.date}`,
    `Objet     : ${m.subject}`,
  ];
  const parts = [`━━ Mail ${m.id}${solved ? " — traité ✅" : ""} ━━`, "", head.join("\n"), "", "─── Corps ───", m.body];
  if (m.attachment) parts.push("", `📎 Pièce jointe : ${m.attachment}`);
  if (m.links && m.links.length) parts.push("", "🔗 Liens :", ...m.links.map((l) => "  " + l));
  const qlines = m.questions.map((q) => `  ${ans[q.id] ? "✅" : "❓"} [${q.id}] ${q.prompt}`);
  parts.push("", "Questions :", qlines.join("\n"), "", `Réponds : \`report ${m.id} <question> <valeur>\`. Indice : \`phhint ${m.id} <question>\`.`);
  return out(parts.join("\n"));
}
function cmdPhhint(args) {
  const m = PHISH_MAILS.find((mm) => mm.id === args[0]);
  if (!m) return out("Mail inconnu. Tape `phishing` pour la liste.", "t-err");
  const q = m.questions.find((qq) => qq.id === args[1]);
  if (!q) return out(`Question inconnue. Questions : ${m.questions.map((qq) => qq.id).join(", ")}.`, "t-err");
  if (GAME.insaneMode) return out("🔥 Mode Insane actif : aucun indice disponible.", "t-err");
  return out(`💡 ${m.id}/${q.id} : ${q.hint}`, "t-hint");
}
function cmdReport(args) {
  const m = PHISH_MAILS.find((mm) => mm.id === args[0]);
  if (!m) return out("Mail inconnu. Tape `phishing` pour la liste.", "t-err");
  const q = m.questions.find((qq) => qq.id === args[1]);
  if (!q) return out(`Question inconnue pour ${m.id} : ${m.questions.map((qq) => qq.id).join(", ")}.`, "t-err");
  if (GAME.phishing.solved[m.id]) return out("Mail déjà traité — bien vu !", "t-hint");
  const value = args.slice(2).join(" ").trim();
  if (!value) return out(`usage: report ${m.id} ${q.id} <valeur>`, "t-err");
  const ok = q.contains
    ? q.accept.some((a) => btNorm(value).includes(btNorm(a)))
    : q.accept.map(btNorm).includes(btNorm(value));
  if (!ok) return out("❌ Pas convaincant — relis les en-têtes et le lien.", "t-err");
  if (!GAME.phishing.answered[m.id]) GAME.phishing.answered[m.id] = {};
  GAME.phishing.answered[m.id][q.id] = true;
  const ans = GAME.phishing.answered[m.id];
  const remaining = m.questions.filter((qq) => !ans[qq.id]);
  if (remaining.length) {
    persistSave();
    return out(`✅ Correct pour « ${q.id} ». Reste : ${remaining.map((qq) => qq.id).join(", ")}.`, "t-ok");
  }
  GAME.phishing.solved[m.id] = true;
  addScore(m.points);
  toast(`📧 Mail traité : « ${m.subject} » (+${m.points} pts)`);
  if (typeof playFlagSound === "function") playFlagSound();
  checkGlobalBadges();
  persistSave();
  if (typeof renderSidebar === "function") renderSidebar();
  return out(`✅ Analyse complète — mail traité ! +${m.points} pts.`, "t-ok");
}

// ── Mini reverse engineering : `strings` + désassembleur maison simplifié ────
// Les binaires sont 100% en dur (chaînes + pseudo-désassemblage) : aucun vrai parsing
// de fichier, aucun moteur de désassemblage réel — but pédagogique.
const MALWARE_SAMPLES = [
  {
    id: "dropper", filename: "update.bin", points: 200,
    title: "Un « updater » suspect ramassé sur un poste",
    strings: [
      "/lib64/ld-linux-x86-64.so.2", "libc.so.6", "socket", "connect", "gethostbyname", "system",
      "update.deliv-cdn.ru", "/tmp/.sysupd", "Mozilla/5.0 (X11; Linux) UpdaterBot/1.0",
      "GLOBAL_SYS_UPDATE_MTX", "%s/beacon?id=%s", "decrypting payload...",
    ],
    disasm: [
      "0x1140  push  rbp",
      "0x1141  mov   rbp, rsp",
      "0x1149  lea   rdi, [\"update.deliv-cdn.ru\"]",
      "0x1150  call  gethostbyname",
      "0x1155  call  socket",
      "0x115a  call  connect            ; ouvre une connexion sortante (C2)",
      "0x1160  mov   cl, 0x37           ; clé XOR = 0x37",
      "0x1163 .decrypt:",
      "0x1163  xor   byte [rsi], cl     ; boucle de déchiffrement XOR",
      "0x1166  inc   rsi",
      "0x1169  loop  .decrypt",
      "0x116e  call  system             ; exécute la charge déchiffrée",
    ],
    questions: [
      { id: "c2", prompt: "Domaine de commande & contrôle (C2) ?", contains: true, accept: ["update.deliv-cdn.ru", "deliv-cdn.ru", "deliv-cdn"], hint: "Le domaine chargé juste avant `gethostbyname`/`connect`." },
      { id: "xorkey", prompt: "Clé XOR de déchiffrement (en hexa) ?", accept: ["0x37", "37"], hint: "Le `mov cl, ...` juste avant la boucle `.decrypt`." },
      { id: "nature", prompt: "Nature du programme (un mot) ?", contains: true, accept: ["c2", "beacon", "backdoor", "dropper", "rat", "malware", "commandandcontrol"], hint: "Il rappelle un serveur externe, déchiffre puis exécute une charge : porte dérobée / C2." },
    ],
  },
  {
    id: "authcheck", filename: "license.bin", points: 150,
    title: "Un vérificateur de licence à contourner",
    strings: [
      "Enter license key: ", "Invalid key.", "Access granted.", "R3v3rs3_M3_2026!", "libc.so.6", "strcmp", "printf",
    ],
    disasm: [
      "0x1200  lea   rdi, [rbp-0x40]      ; saisie utilisateur",
      "0x1207  lea   rsi, [\"R3v3rs3_M3_2026!\"]  ; clé attendue, en dur",
      "0x120e  call  strcmp              ; compare l'entrée à la clé",
      "0x1213  test  eax, eax",
      "0x1215  jnz   .fail",
      "0x1217  lea   rdi, [\"Access granted.\"]",
      "0x121e  call  printf",
      "0x1223 .fail:",
      "0x1223  lea   rdi, [\"Invalid key.\"]",
      "0x122a  call  printf",
    ],
    questions: [
      { id: "key", prompt: "Clé de licence valide ?", accept: ["R3v3rs3_M3_2026!"], hint: "La chaîne comparée par `strcmp` est directement dans le binaire (`strings`)." },
      { id: "faille", prompt: "Pourquoi c'est cassé (un mot / une expression) ?", contains: true, accept: ["endur", "hardcoded", "strcmp", "clenclair", "cleenclair", "comparaison", "motdepasseendur", "cleendur"], hint: "La clé est comparée en clair, codée en dur dans le binaire." },
    ],
  },
];
function reSample(idOrFile) {
  return MALWARE_SAMPLES.find((s) => s.id === idOrFile || s.filename === idOrFile);
}
function cmdMalware() {
  const lines = ["🔬 Reverse engineering — échantillons à analyser :", ""];
  MALWARE_SAMPLES.forEach((s) => {
    const solved = GAME.reverse.solved[s.id];
    lines.push(`${solved ? "✅" : "🔬"} ${s.id.padEnd(10)} ${String(s.points).padStart(3)} pts  ${s.filename.padEnd(12)} ${s.title}`);
  });
  lines.push("");
  lines.push("Analyse : `strings <id>` (chaînes lisibles) · `disas <id>` (désassemblage) · Réponds : `resolve <id> <question> <valeur>` · Indice : `rehint <id> <question>`");
  return out(lines.join("\n"));
}
function cmdStrings(args) {
  const s = reSample(args[0]);
  if (!s) return out("usage: strings <id|fichier> — cible un échantillon (voir `malware`).", "t-err");
  return out(`# strings ${s.filename}\n` + s.strings.join("\n"));
}
function cmdDisas(args) {
  const s = reSample(args[0]);
  if (!s) return out("usage: disas <id|fichier> — cible un échantillon (voir `malware`).", "t-err");
  const q = s.questions.map((qq) => qq.id).join(", ");
  return out(`# désassemblage simplifié de ${s.filename}\n\n` + s.disasm.join("\n") + `\n\nQuestions : ${q}. Réponds avec \`resolve ${s.id} <question> <valeur>\`.`);
}
function cmdRehint(args) {
  const s = reSample(args[0]);
  if (!s) return out("Échantillon inconnu. Tape `malware` pour la liste.", "t-err");
  const q = s.questions.find((qq) => qq.id === args[1]);
  if (!q) return out(`Question inconnue. Questions : ${s.questions.map((qq) => qq.id).join(", ")}.`, "t-err");
  if (GAME.insaneMode) return out("🔥 Mode Insane actif : aucun indice disponible.", "t-err");
  return out(`💡 ${s.id}/${q.id} : ${q.hint}`, "t-hint");
}
function cmdResolve(args) {
  const s = reSample(args[0]);
  if (!s) return out("Échantillon inconnu. Tape `malware` pour la liste.", "t-err");
  const q = s.questions.find((qq) => qq.id === args[1]);
  if (!q) return out(`Question inconnue pour ${s.id} : ${s.questions.map((qq) => qq.id).join(", ")}.`, "t-err");
  if (GAME.reverse.solved[s.id]) return out("Échantillon déjà analysé — bien joué !", "t-hint");
  const value = args.slice(2).join(" ").trim();
  if (!value) return out(`usage: resolve ${s.id} ${q.id} <valeur>`, "t-err");
  const ok = q.contains ? q.accept.some((a) => btNorm(value).includes(btNorm(a))) : q.accept.map(btNorm).includes(btNorm(value));
  if (!ok) return out("❌ Incorrect — relis les `strings` / le `disas`.", "t-err");
  if (!GAME.reverse.answered[s.id]) GAME.reverse.answered[s.id] = {};
  GAME.reverse.answered[s.id][q.id] = true;
  const ans = GAME.reverse.answered[s.id];
  const remaining = s.questions.filter((qq) => !ans[qq.id]);
  if (remaining.length) {
    persistSave();
    return out(`✅ Correct pour « ${q.id} ». Reste : ${remaining.map((qq) => qq.id).join(", ")}.`, "t-ok");
  }
  GAME.reverse.solved[s.id] = true;
  addScore(s.points);
  toast(`🔬 Échantillon analysé : ${s.filename} (+${s.points} pts)`);
  if (typeof playFlagSound === "function") playFlagSound();
  checkGlobalBadges();
  persistSave();
  if (typeof renderSidebar === "function") renderSidebar();
  return out(`✅ Analyse complète — échantillon « ${s.filename} » élucidé ! +${s.points} pts.`, "t-ok");
}

// ── Attack graph : rendu SVG du chemin d'attaque découvert (nœuds grisés) ────
const AG_PRIVESC_LABELS = {
  "sudo-gtfobins": "sudo GTFOBins", "sudo-direct": "sudo GTFOBins",
  "cron-writable": "cron world-writable", "suid-binary": "binaire SUID",
  "schtask-writable": "tâche planifiée SYSTEM", "docker-group": "groupe docker",
};
function agAccessLabel(m) {
  if (m.upload) return "upload webshell";
  if (m.cloud) return Object.values(m.cloud.buckets || {}).some((b) => b.deploy) ? "bucket writable (RCE)" : "bucket public";
  if (m.sqli) return "SQLi bypass login";
  if (m.internal) return "pivot ssh -L";
  if (m.ftp && m.ftp.enabled) return "FTP anon → creds";
  if (m.altAccess) return "reverse shell / creds";
  return "fuite de creds → SSH";
}
function agEsc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function buildAttackGraphSVG(machine, progress) {
  const p = progress || { recon: false, access: false, privesc: false, userFlag: false, rootFlag: false };
  const W = 130, H = 56;
  const nodes = [
    { x: 20, y: 92, on: p.recon, title: "Recon", sub: "nmap" },
    { x: 190, y: 92, on: p.access, title: "Accès initial", sub: agAccessLabel(machine) },
    { x: 360, y: 92, on: p.privesc, title: "Privesc", sub: AG_PRIVESC_LABELS[machine.privesc.type] || machine.privesc.type },
    { x: 530, y: 92, on: p.rootFlag, title: "Flag root", sub: "root.txt" },
    { x: 360, y: 8, on: p.userFlag, title: "Flag user", sub: "user.txt" },
  ];
  const edges = [
    { x1: 150, y1: 120, x2: 190, y2: 120, on: p.access },        // recon -> accès
    { x1: 320, y1: 120, x2: 360, y2: 120, on: p.privesc },       // accès -> privesc
    { x1: 490, y1: 120, x2: 530, y2: 120, on: p.rootFlag },      // privesc -> root
    { x1: 255, y1: 92, x2: 380, y2: 64, on: p.userFlag },        // accès -> flag user
  ];
  const edgeSvg = edges.map((e) => `<line class="ag-edge${e.on ? " on" : ""}" x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" marker-end="url(#agArrow)"/>`).join("");
  const nodeSvg = nodes.map((n) => (
    `<g class="ag-node${n.on ? " on" : ""}">` +
    `<rect x="${n.x}" y="${n.y}" rx="9" ry="9" width="${W}" height="${H}"/>` +
    `<text class="ag-t" x="${n.x + W / 2}" y="${n.y + 23}">${n.on ? "✔ " : ""}${agEsc(n.title)}</text>` +
    `<text class="ag-s" x="${n.x + W / 2}" y="${n.y + 41}">${agEsc(n.sub)}</text>` +
    `</g>`
  )).join("");
  return (
    `<svg class="attack-graph" viewBox="0 0 680 170" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Graphe d'attaque de ${agEsc(machine.name)}">` +
    `<defs><marker id="agArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="ag-arrowhead"/></marker></defs>` +
    edgeSvg + nodeSvg +
    `</svg>`
  );
}

// ── Visualiseur de pile : défi buffer overflow 100% simulé (aucun code réel) ─
// Modèle : char buf[16] ; RBP sauvé (8 o) ; adresse de retour (8 o). Un payload de
// `fill` octets de bourrage suivi d'une adresse écrase la pile vers les adresses hautes.
// Écraser l'adresse de retour (offset 24) par l'adresse de win() détourne le flux.
const STACK_CHALLENGE = { buf: 16, rbp: 8, ret: 8, win: "0x401156", winFn: "win", origRet: "0x401080" };
function stackOffsetToRet() { return STACK_CHALLENGE.buf + STACK_CHALLENGE.rbp; } // 24
function normAddr(a) {
  a = String(a || "").trim().toLowerCase();
  if (!a) return "";
  if (!/^0x[0-9a-f]+$/.test(a)) a = "0x" + a.replace(/^0x/, "");
  return /^0x[0-9a-f]+$/.test(a) ? a : "";
}
function stackEval(fill, retHex) {
  fill = Math.max(0, Math.floor(Number(fill) || 0));
  const addr = normAddr(retHex);
  const off = stackOffsetToRet();
  let status, msg, win = false;
  if (!addr) {
    if (fill < STACK_CHALLENGE.buf) { status = "safe"; msg = "Le payload tient dans le buffer (≤ 16 o) — aucun débordement."; }
    else if (fill < off) { status = "rbp"; msg = "Le bourrage déborde dans le RBP sauvé — la fonction planterait (SIGSEGV), mais tu ne contrôles pas encore l'adresse de retour."; }
    else { status = "ret-nofill"; msg = `Le bourrage atteint la zone de l'adresse de retour (offset ${off}) mais n'y écrit aucune adresse — ajoute une adresse cible.`; }
  } else if (fill < off) {
    status = "early"; msg = `L'adresse tombe à l'offset ${fill} : trop tôt, elle n'écrase pas les 8 octets de l'adresse de retour (offset ${off}). Ajoute du bourrage.`;
  } else if (fill > off) {
    status = "late"; msg = `Offset ${fill} > ${off} : l'adresse déborde au-delà de l'adresse de retour (mal aligné).`;
  } else if (addr === STACK_CHALLENGE.win) {
    status = "win"; win = true; msg = `🎯 Adresse de retour écrasée par ${STACK_CHALLENGE.win} (${STACK_CHALLENGE.winFn}()) — flux d'exécution détourné. Exploitation réussie (pédagogique, aucun code réel exécuté).`;
  } else {
    status = "ret-wrong"; msg = `Tu écrases bien l'adresse de retour (offset ${off}) mais avec ${addr}, pas l'adresse de win() (${STACK_CHALLENGE.win}).`;
  }
  return { fill, addr, status, msg, win, offsetToRet: off };
}
function attemptStack(fill, retHex) {
  const r = stackEval(fill, retHex);
  if (r.win && !GAME.stackpwn.solved) {
    GAME.stackpwn.solved = true;
    addScore(200);
    toast("🧠 Buffer overflow résolu — adresse de retour détournée (+200 pts)");
    if (typeof playFlagSound === "function") playFlagSound();
    if (typeof spawnFlagParticles === "function") spawnFlagParticles();
    checkGlobalBadges();
    persistSave();
    if (typeof renderSidebar === "function") renderSidebar();
  }
  return r;
}
function buildStackSVG(fill, retHex) {
  const r = stackEval(fill, retHex);
  const off = stackOffsetToRet();
  const bufFilled = r.fill > 0;
  const rbpFilled = r.fill > STACK_CHALLENGE.buf;
  let retCls = "";
  if (r.status === "win") retCls = " hijack";
  else if (r.status === "ret-wrong" || (r.addr && r.fill >= off)) retCls = " crash";
  const retSub = r.status === "win" ? `détournée → ${STACK_CHALLENGE.win}`
    : (r.addr && r.fill === off) ? `écrasée : ${r.addr}` : `${STACK_CHALLENGE.origRet} (intacte)`;
  const slot = (y, cls, title, sub) => `<g class="sk-slot${cls}"><rect x="70" y="${y}" width="280" height="60" rx="6"/><text class="sk-t" x="210" y="${y + 26}">${agEsc(title)}</text><text class="sk-s" x="210" y="${y + 45}">${agEsc(sub)}</text></g>`;
  return `<svg class="stack-viz" viewBox="0 0 420 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schéma de la pile">`
    + `<text class="sk-axis" x="210" y="16">▲ adresses hautes</text>`
    + slot(26, retCls, "adresse de retour (8 o)", retSub)
    + slot(102, rbpFilled ? " fill" : "", "RBP sauvé (8 o)", rbpFilled ? "écrasé (AAAA…)" : "intact")
    + slot(178, bufFilled ? " fill" : "", "char buf[16]", bufFilled ? `${Math.min(r.fill, 16)}/16 octets écrits` : "vide")
    + `<text class="sk-axis" x="210" y="258">▼ adresses basses — le débordement remonte</text>`
    + `<text class="sk-info" x="210" y="284">offset du bourrage : ${r.fill} · cible = offset ${off}</text>`
    + `<text class="sk-verdict${r.win ? " win" : ""}" x="210" y="308">${r.win ? "🎯 RET détournée vers win()" : (r.addr && r.fill === off ? "RET écrasée (mauvaise adresse)" : "RET non contrôlée")}</text>`
    + `</svg>`;
}

// ── Détection & capture de flags dans une sortie ─────────────────────────────
function scanForFlags(machine, text) {
  if (!machine) return;
  const matches = text.match(/FLAG\{[^}]+\}/g);
  if (!matches) return;
  const p = GAME.progress[machine.id];
  matches.forEach((flag) => {
    if (flag === machine.targetFS.users[Object.keys(machine.targetFS.users)[0]].fs["user.txt"].content && !p.userFlag) {
      p.userFlag = true;
      addScore(100);
      toast(`🚩 Flag utilisateur capturé sur ${machine.name} (+100 pts)`);
      if (typeof playFlagSound === "function") playFlagSound();
    }
    if (flag === machine.rootFile.content && !p.rootFlag) {
      p.rootFlag = true;
      addScore(200);
      const t = GAME.times[machine.id];
      let chronoLabel = "";
      if (t && t.startedAt) {
        t.elapsedMs = Date.now() - t.startedAt;
        t.startedAt = null;
        chronoLabel = ` en ${formatDuration(t.elapsedMs)}`;
      }
      toast(`🚩 Flag root capturé sur ${machine.name} (+200 pts)${chronoLabel} — machine terminée !`);
      if (typeof playFlagSound === "function") playFlagSound();
      if (typeof spawnFlagParticles === "function") spawnFlagParticles();
      if (typeof printLine === "function") printLine(cveFiche(machine), "t-hint");
      recordBestTime(machine);
      const idx = MACHINES.findIndex((mm) => mm.id === machine.id);
      const next = MACHINES[idx + 1];
      if (next && !GAME.unlocked.includes(next.id)) {
        GAME.unlocked.push(next.id);
        toast(`🔓 Nouvelle machine débloquée : ${next.name}`);
      }
      checkBadges(machine);
    }
  });
  persistSave();
  if (typeof renderSidebar === "function") renderSidebar();
}

// ── Éditeur de machines : charger une machine déclarative (JSON) à la volée ───
// Les regex des exploits peuvent être écrites soit comme des chaînes (clé finissant
// par "Regex"), soit sous la forme balisée { __regex__, __flags__ } de machines.json.
function compileRegexesDeep(value, key) {
  if (Array.isArray(value)) return value.map((v) => compileRegexesDeep(v));
  if (value && typeof value === "object") {
    if (typeof value.__regex__ === "string") {
      try { return new RegExp(value.__regex__, value.__flags__ || ""); } catch { return value; }
    }
    const obj = {};
    for (const k of Object.keys(value)) obj[k] = compileRegexesDeep(value[k], k);
    return obj;
  }
  if (typeof value === "string" && /Regex$/.test(key || "")) {
    try { return new RegExp(value); } catch { return value; }
  }
  return value;
}

// Charge une machine custom (objet ou JSON) : compile ses regex, valide son schéma,
// vérifie l'absence de collision d'id/ip, puis l'injecte dans MACHINES (déverrouillée,
// marquée custom → exclue des badges "tour complet"/"perfectionniste"). Non persistée :
// elle disparaît au rechargement (bac à sable / scénario partagé).
function loadCustomMachine(input) {
  let raw;
  try { raw = typeof input === "string" ? JSON.parse(input) : input; }
  catch (e) { return { ok: false, errors: ["JSON invalide : " + e.message] }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["La racine doit être un objet décrivant une machine."] };
  }
  const machine = compileRegexesDeep(raw);
  machine.custom = true;
  const errors = [];
  if (!machine.id) errors.push('champ "id" manquant');
  else if (MACHINES.some((m) => m.id === machine.id)) errors.push(`id déjà utilisé par une machine existante : ${machine.id}`);
  if (machine.ip && MACHINES.some((m) => m.ip === machine.ip)) errors.push(`ip déjà utilisée par une machine existante : ${machine.ip}`);
  if (typeof validateMachines === "function") errors.push(...validateMachines([machine]));
  if (errors.length) return { ok: false, errors };
  MACHINES.push(machine);
  if (!GAME.unlocked.includes(machine.id)) GAME.unlocked.push(machine.id);
  if (!GAME.progress[machine.id]) GAME.progress[machine.id] = { recon: false, access: false, privesc: false, userFlag: false, rootFlag: false };
  if (!GAME.hintsUsed[machine.id]) GAME.hintsUsed[machine.id] = { recon: 0, access: 0, privesc: 0 };
  if (typeof renderSidebar === "function") renderSidebar();
  return { ok: true, errors: [], machine };
}

// ── Partage de scénario par URL (base64url d'une machine, zéro dépendance) ───
// Encodage 100% ECMAScript (pas de btoa/TextEncoder) pour marcher partout, y compris
// dans le contexte de test Node.
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function utf8ToBytes(str) {
  const s = unescape(encodeURIComponent(str));
  const b = [];
  for (let i = 0; i < s.length; i++) b.push(s.charCodeAt(i));
  return b;
}
function bytesToUtf8(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return decodeURIComponent(escape(s));
}
function bytesToB64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 15) << 2) | ((b2 || 0) >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 63];
  }
  return out;
}
function b64urlToBytes(str) {
  const rev = {};
  for (let i = 0; i < B64URL.length; i++) rev[B64URL[i]] = i;
  const bytes = [];
  for (let i = 0; i < str.length; i += 4) {
    const c0 = rev[str[i]], c1 = rev[str[i + 1]], c2 = rev[str[i + 2]], c3 = rev[str[i + 3]];
    bytes.push((c0 << 2) | (c1 >> 4));
    if (str[i + 2] !== undefined && c2 !== undefined) bytes.push(((c1 & 15) << 4) | (c2 >> 2));
    if (str[i + 3] !== undefined && c3 !== undefined) bytes.push(((c2 & 3) << 6) | c3);
  }
  return bytes;
}
// Encode une machine (objet ou JSON) en chaîne base64url pour un lien de partage.
function encodeScenario(input) {
  const json = typeof input === "string" ? input : JSON.stringify(input);
  return bytesToB64url(utf8ToBytes(json));
}
// Décode une chaîne de partage vers le JSON d'origine (lève si corrompue).
function decodeScenario(str) {
  return bytesToUtf8(b64urlToBytes(str));
}

// ── Générateur procédural de machines (100% JS, pas d'IA externe) ────────────
// Combine une "brique" de vecteur d'accès et une "brique" de privesc tirées de pools,
// de façon déterministe à partir d'un seed (même seed -> même machine, partageable).
// Chaque brique fournit AUSSI ses étapes de solution -> le résultat est garanti jouable.
const GEN_NAMES = ["ZEPHYR", "ONYX", "QUARTZ", "HALCYON", "RIVET", "COBALT", "EMBER", "SABLE", "VESPER", "NEBULA", "KRAKEN", "LUMEN", "ORACLE", "PRISM", "TALON"];
const GEN_USERS = ["deploy", "svcacct", "webadmin", "backup", "opsuser", "runner", "devops", "support"];
function genHashSeed(s) { s = String(s); let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function genRng(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function genSshPort() { return { port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 9.2p1" }; }

function genAccessBrick(kind, c) {
  if (kind === "ftp") {
    const file = "backup_creds.txt";
    return {
      ports: [genSshPort(), { port: 21, proto: "tcp", state: "open", service: "ftp", version: "vsftpd 3.0.3" }],
      web: {}, ftp: { enabled: true, loginMsg: "220 (vsFTPd 3.0.3)\n230 Connexion anonyme acceptée.", files: { [file]: `# export interne\nSSH ${c.user}:${c.pass}` } },
      sshUsers: { [c.user]: { password: c.pass } },
      accessHints: ["Un service FTP anonyme est ouvert.", `Connecte-toi (\`ftp ${c.ip}\`) et lis le fichier récupéré dans ~/loot/${c.id}-ftp/.`, `Il contient des identifiants SSH — \`ssh ${c.user}@${c.ip}\`.`],
      walkAccess: [`ftp ${c.ip}`, `cat ~/loot/${c.id}-ftp/${file}`, `ssh ${c.user}@${c.ip}`, { pw: true }],
    };
  }
  if (kind === "web") {
    const path = "/backup/config.bak";
    return {
      ports: [genSshPort(), { port: 80, proto: "tcp", state: "open", service: "http", version: "nginx 1.18" }],
      web: { "/": `<html>\n<!-- sauvegarde oubliée : ${path} -->\n</html>`, [path]: `# config.bak\nSSH_USER=${c.user}\nSSH_PASS=${c.pass}` },
      ftp: { enabled: false }, sshUsers: { [c.user]: { password: c.pass } },
      accessHints: ["Un serveur web tourne — regarde son code source.", `\`curl http://${c.ip}/\` : un commentaire pointe vers une sauvegarde.`, `\`curl http://${c.ip}${path}\` fuit des identifiants SSH — \`ssh ${c.user}@${c.ip}\`.`],
      walkAccess: [`curl http://${c.ip}/`, `curl http://${c.ip}${path}`, `ssh ${c.user}@${c.ip}`, { pw: true }],
    };
  }
  // cloud
  const bucket = `${c.name.toLowerCase()}-backups`;
  return {
    ports: [genSshPort(), { port: 80, proto: "tcp", state: "open", service: "http", version: "nginx 1.18" }],
    web: { "/": `<html>\n<!-- sauvegardes : s3://${bucket} (public) -->\n</html>` },
    ftp: { enabled: false }, sshUsers: { [c.user]: { password: c.pass } },
    cloud: { provider: "s3", buckets: { [bucket]: { public: true, files: { "deploy.env": `SSH_USER=${c.user}\nSSH_PASS=${c.pass}` } } } },
    accessHints: ["Un stockage objet est mentionné sur le site.", `\`cloudctl ls\` : le bucket \`${bucket}\` est public.`, `\`cloudctl get s3://${bucket}/deploy.env\` fuit des creds SSH — \`ssh ${c.user}@${c.ip}\`.`],
    walkAccess: [`curl http://${c.ip}/`, `cloudctl get s3://${bucket}/deploy.env`, `ssh ${c.user}@${c.ip}`, { pw: true }],
  };
}

function genPrivescBrick(kind, c) {
  if (kind === "less") {
    return {
      sudoL: `L'utilisateur ${c.user} peut lancer :\n    (root) NOPASSWD: /usr/bin/less`,
      privesc: { type: "sudo-gtfobins", exploitCmdRegex: "^sudo\\s+(/usr/bin/)?less\\s+/etc/hostname$", pagerEscapeRegex: "^!/?(bin/)?sh$|^!bash$", enterMsg: "(pager root ouvert — tape !sh)" },
      privescHints: ["`sudo -l` en arrivant.", "`less` est autorisé en NOPASSWD — classique GTFOBins (pager -> shell).", "`sudo less /etc/hostname` puis `!sh` dans le pager."],
      walkPrivesc: ["sudo less /etc/hostname", "!sh"],
    };
  }
  if (kind === "env") {
    return {
      sudoL: `L'utilisateur ${c.user} peut lancer :\n    (root) NOPASSWD: /usr/bin/env`,
      privesc: { type: "sudo-direct", exploitCmdRegex: "^sudo\\s+(/usr/bin/)?env\\s+/bin/sh$", enterMsg: "# (shell root via env -- GTFOBins)" },
      privescHints: ["`sudo -l` en arrivant.", "`env` est autorisé en NOPASSWD (GTFOBins).", "`sudo env /bin/sh` pour un shell root."],
      walkPrivesc: ["sudo env /bin/sh"],
    };
  }
  return {
    sudoL: `L'utilisateur ${c.user} peut lancer :\n    (root) NOPASSWD: /usr/bin/perl`,
    privesc: { type: "sudo-direct", exploitCmdRegex: "^sudo\\s+(/usr/bin/)?perl\\s+-e\\s+'exec\\s+\"/bin/sh\";?'$", enterMsg: "# (shell root via perl -- GTFOBins)" },
    privescHints: ["`sudo -l` en arrivant.", "`perl` est autorisé en NOPASSWD (GTFOBins).", "`sudo perl -e 'exec \"/bin/sh\";'` pour un shell root."],
    walkPrivesc: ["sudo perl -e 'exec \"/bin/sh\";'"],
  };
}

// Génère une machine jouable à partir d'un seed (optionnel). Retourne { machine, seed,
// password, walkthrough } — walkthrough/password servent aux tests et aux indices.
function generateMachine(seedInput) {
  const seed = (seedInput === undefined || seedInput === null || seedInput === "") ? `${Date.now()}-${Math.floor(Math.random() * 1e6)}` : String(seedInput);
  const rnd = genRng(genHashSeed(seed));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const hex = (n) => { let s = ""; for (let i = 0; i < n; i++) s += Math.floor(rnd() * 16).toString(16); return s; };
  const name = pick(GEN_NAMES);
  const id = name.toLowerCase() + "-" + genHashSeed(seed).toString(36).slice(0, 5);
  const ip = `10.13.${10 + Math.floor(rnd() * 240)}.${10 + Math.floor(rnd() * 240)}`;
  const user = pick(GEN_USERS);
  const pass = pick(["Str0ng", "S3cur3", "Depl0y", "Adm1n", "R00t3d"]) + "_" + hex(5) + "!";
  const c = { name, id, ip, user, pass };
  const access = genAccessBrick(pick(["ftp", "web", "cloud"]), c);
  const priv = genPrivescBrick(pick(["less", "env", "perl"]), c);
  const tag = id.replace(/-/g, "_");
  const machine = {
    id, name, ip, difficulty: pick(["Facile", "Moyen", "Difficile"]), os: "Linux (Debian 12)",
    briefing: "Machine générée procéduralement (combinaison aléatoire de briques de vulnérabilités).",
    ports: access.ports, web: access.web || {}, ftp: access.ftp || { enabled: false },
    sshUsers: access.sshUsers,
    targetFS: {
      hostname: id, homeDir: `/home/${user}`,
      users: { [user]: { home: `/home/${user}`, fs: { "user.txt": { type: "file", content: `FLAG{${tag}_user_${hex(4)}}`, perms: "-rw-r-----", owner: user } } } },
      extraFS: {}, sudoL: priv.sudoL,
    },
    privesc: priv.privesc,
    rootFile: { path: "/root/root.txt", content: `FLAG{${tag}_root_${hex(4)}}` },
    hints: {
      recon: [`Un scan s'impose : \`nmap ${ip}\`.`, "Regarde les services exposés pour trouver le vecteur d'accès.", "Le service le plus bavard est ta porte d'entrée."],
      access: access.accessHints, privesc: priv.privescHints,
    },
  };
  if (access.cloud) machine.cloud = access.cloud;
  const walkthrough = [`nmap ${ip}`, ...access.walkAccess, "cat user.txt", "sudo -l", ...priv.walkPrivesc, "cat /root/root.txt"];
  return { machine, seed, password: pass, walkthrough };
}

function cmdGenerate(args) {
  const seed = args.join(" ").trim();
  const gen = generateMachine(seed || undefined);
  const res = loadCustomMachine(gen.machine);
  if (!res.ok) return out("Échec de génération : " + res.errors.join(" ; "), "t-err");
  SESSION.activeMachine = gen.machine.id;
  return out(
    `🎲 Machine générée : ${gen.machine.name} (${gen.machine.ip}, ${gen.machine.difficulty}) — seed « ${gen.seed} ».\n` +
      `Déverrouillée et ajoutée au lab (bac à sable, non sauvegardée). Même seed = même machine : \`generate ${gen.seed}\`.\n` +
      `Enchaîne avec \`use ${gen.machine.id}\` puis \`nmap ${gen.machine.ip}\`.`,
    "t-ok",
  );
}

// ── Dispatcher principal ─────────────────────────────────────────────────────
function runCommand(raw) {
  const line = raw.trim();
  if (!line) return out("");
  SESSION.history.push(line);
  persistHistory();

  // Mode éditeur (vim minimal) : on intercepte tout avant le parsing normal
  if (SESSION.vimMode) {
    return handleVimInput(line);
  }
  // Mode pager (nimbus) : on intercepte tout avant le parsing normal
  if (SESSION.pagerMode) {
    return handlePagerInput(line);
  }
  // Tick de cron en attente (cerberus) : la commande suivante déclenche le message
  let cronTickPrefix = "";
  const cronPending = SESSION.ctx !== "attacker" &&
    SESSION.cronPlanted[SESSION.ctx] && !SESSION.cronTicked[SESSION.ctx];
  if (cronPending) {
    SESSION.cronTicked[SESSION.ctx] = true;
    const machine = getMachine(SESSION.ctx);
    cronTickPrefix = machine.privesc.tickMsg + "\n\n";
  }

  let result = runPipelineCore(line);
  if (result && SESSION.ctx !== "attacker") {
    scanForFlags(getMachine(SESSION.ctx), result.text);
  }
  if (result && cronTickPrefix) result = out(cronTickPrefix + result.text, result.cls === "t-err" ? result.cls : "t-warn");
  if (result) SESSION.lastExitCode = result.cls === "t-err" ? 1 : 0;
  return result;
}

function handlePagerInput(line) {
  const machine = getMachine(SESSION.pagerMode);
  const priv = machine.privesc;
  if (line === "q" || line === "quit" || line === ":q") {
    SESSION.pagerMode = null;
    return out("(sortie du pager)");
  }
  if (priv.pagerEscapeRegex.test(line)) {
    SESSION.pagerMode = null;
    SESSION.user = "root";
    SESSION.cwd = "/root";
    GAME.progress[machine.id].privesc = true;
    addScore(250);
    persistSave();
    if (typeof renderSidebar === "function") renderSidebar();
    toast(`🛠️ Élévation de privilèges réussie sur ${machine.name} (+250 pts)`);
    return out("# shell root obtenu.\nTape `cat /root/root.txt` pour récupérer le flag.", "t-ok");
  }
  return out("(pager) commande non reconnue — tape `!sh` pour un shell, ou `q` pour quitter.", "t-warn");
}

function dispatch(cmd, args, rawFirst) {
  switch (cmd) {
    case "help": return cmdHelp();
    case "clear": if (typeof clearTerminal === "function") clearTerminal(); return out("");
    case "machines": return out(renderMachinesList());
    case "use": return cmdUse(args);
    case "reset": return cmdReset(args);
    case "hint": return cmdHint();
    case "insane": return cmdInsane(args);
    case "progress": return cmdProgress();
    case "badges": return cmdBadges();
    case "records": return cmdRecords();
    case "writeup": return cmdWriteup(args);
    case "challenges": return cmdChallenges();
    case "challenge": return cmdChallengeShow(args);
    case "chint": return cmdChallengeHint(args);
    case "submit": return cmdSubmit(args);
    case "hashcat": return cmdHashcat(args);
    case "daily": return cmdDaily();
    case "score": {
      const info = levelInfo(GAME.score);
      return out(`Score total : ${GAME.score} pts — Niveau ${info.level} (${info.into}/${info.span} XP, ${info.pct}%)`);
    }
    case "history": return out(SESSION.history.slice(0, -1).join("\n"));
    case "whoami": {
      if (isWinCtx()) {
        return out(SESSION.user === "root" ? "nt authority\\system" : `${SESSION.host.toLowerCase()}\\${SESSION.user}`);
      }
      return out(SESSION.user);
    }
    case "id":
    case "groups": {
      if (isWinCtx()) return out("'id' n'est pas reconnu en tant que commande interne ou externe, un programme exécutable ou un fichier de commandes.", "t-err");
      if (SESSION.ctx === "attacker") return out(`uid=1000(${SESSION.user}) gid=1000(${SESSION.user}) groupes=1000(${SESSION.user})`);
      if (SESSION.user === "root") return out("uid=0(root) gid=0(root) groupes=0(root)");
      const machine = getMachine(SESSION.ctx);
      const extra = machine.targetFS.extraGroups ? `,${machine.targetFS.extraGroups}` : "";
      return out(`uid=1000(${SESSION.user}) gid=1000(${SESSION.user}) groupes=1000(${SESSION.user})${extra}`);
    }
    case "pwd": return out(isWinCtx() ? winPath(SESSION.cwd) : SESSION.cwd);
    case "dir": return cmdDir(args);
    case "type": return cmdType(args);
    case "net": return cmdNet(args);
    case "schtasks": return cmdSchtasks(args);
    case "icacls": return cmdIcacls(args);
    case "ls": return cmdLs(args);
    case "cd": return cmdCd(args);
    case "cat": return cmdCat(args);
    case "find": return cmdFind(args, rawFirst);
    case "echo": return cmdEcho(args, rawFirst);
    case "nmap": return cmdNmap(args);
    case "curl": return cmdCurl(args);
    case "ftp": return cmdFtp(args);
    case "ssh": return cmdSsh(args);
    case "sudo": return cmdSudo(args, rawFirst);
    case "crontab": return cmdCrontab(args);
    case "bash":
    case "/bin/bash": return cmdBashDashP(args, rawFirst);
    case "exit": return cmdExit();
    case "man": return cmdMan(args);
    case "docker": return cmdDocker(args, rawFirst);
    case "vim":
    case "vi":
    case "nano": return cmdVim(args);
    case "nc": return cmdNc(args);
    case "arp": return cmdArp();
    case "cloudctl": return cmdCloudctl(args);
    case "generate": return cmdGenerate(args);
    case "sandbox": return cmdSandbox(args);
    case "blueteam": return cmdBlueteam();
    case "incident": return cmdIncident(args);
    case "answer": return cmdAnswer(args);
    case "bthint": return cmdBthint(args);
    case "firewall": return cmdFirewall(args);
    case "iptables": return cmdIptables(args);
    case "phishing":
    case "inbox": return cmdPhishing();
    case "mail": return cmdMail(args);
    case "report": return cmdReport(args);
    case "phhint": return cmdPhhint(args);
    case "malware":
    case "re": return cmdMalware();
    case "strings": return cmdStrings(args);
    case "disas":
    case "disasm": return cmdDisas(args);
    case "resolve": return cmdResolve(args);
    case "rehint": return cmdRehint(args);
    default: {
      if (SESSION.ctx !== "attacker") {
        const machine = getMachine(SESSION.ctx);
        if (machine.privesc.type === "schtask-writable" && machine.privesc.escalateRegex.test(rawFirst.trim())) {
          if (!SESSION.cronPlanted[machine.id] || !SESSION.cronTicked[machine.id]) {
            return out("Le fichier n'existe pas (encore) à cet emplacement avec les nouveaux privilèges. As-tu piégé la tâche planifiée ?", "t-err");
          }
          SESSION.user = "root";
          SESSION.cwd = parentOf(machine.rootFile.path);
          GAME.progress[machine.id].privesc = true;
          addScore(250);
          persistSave();
          if (typeof renderSidebar === "function") renderSidebar();
          toast(`🛠️ Élévation de privilèges réussie sur ${machine.name} (+250 pts)`);
          return out(machine.privesc.enterMsg, "t-ok");
        }
        if (machine.osType === "windows") {
          return out(`'${cmd}' n'est pas reconnu en tant que commande interne ou externe, un programme exécutable ou un fichier de commandes.`, "t-err");
        }
      }
      return out(`bash: ${cmd}: command not found`, "t-err");
    }
  }
}

function cmdHelp() {
  return out(
    "Commandes générales : help, clear, machines, use <nom>, reset <nom>, hint, insane [on|off], progress, badges, records, writeup <nom>, export <passphrase>, import, score, exit\n" +
    "Mode Jeopardy : challenges, challenge <id>, chint <id>, submit <id> <flag>, hashcat <hash>, daily\n" +
    "Mode Blue Team : blueteam, incident <id>, answer <id> <question> <valeur>, bthint <id> <question>\n" +
    "Pare-feu : firewall [<id>|reset|exit], iptables -L | -A/-I/-D INPUT ... | -P INPUT ACCEPT|DROP | -F\n" +
    "Phishing : phishing (ou inbox), mail <id>, report <id> <question> <valeur>, phhint <id> <question>\n" +
    "Reverse : malware (liste), strings <id>, disas <id>, resolve <id> <question> <valeur>, rehint <id> <question>\n" +
    "Reconnaissance : nmap <ip>, nmap <cidr> (balayage de sous-réseau via un pivot), arp -a, curl <url>, ftp <ip>, nc <ip> <port>, cloudctl ls|get|cp\n" +
    "Accès : ssh <user>@<ip> [-p <port>], curl -F \"file=@<webshell>\" <url> (upload), ssh -L <lport>:<hôte_interne>:<port> <user>@<pivot> (tunnel/pivot)\n" +
    "Système (une fois connecté ou en local) : ls [-la], cd, pwd, cat, find, echo, vim <fichier>, whoami, id, sudo -l, sudo <cmd>, crontab -l, docker ps\n" +
    "Windows (machine cible Windows) : dir, type, net user, net localgroup administrators, schtasks /query, icacls <fichier>\n" +
    "Filtres en pipe : grep, wc -l, sort [-u], head, tail, cut, awk '{print $N}'\n" +
    "Shell : variables $USER/$HOME/$PWD/$HOSTNAME/$UID/$? (${VAR} aussi), substitution $(commande), redirections > >> 2> &> 2>/dev/null\n" +
    "Bac à sable : generate [seed] (machine aléatoire jouable), sandbox (FS libre pour s'entraîner, bouton 🧪), éditeur de machines (🛠️), replay (rejoue ta session, ▶️)\n" +
    "Visualisation : graph [machine] (graphe d'attaque, bouton 🗺️), stack (défi buffer overflow schématisé, bouton 🧠)"
  );
}

function cmdUse(args) {
  const name = (args[0] || "").toLowerCase();
  const machine = MACHINES.find((m) => m.id === name || m.name.toLowerCase() === name);
  if (!machine) return out(`Machine inconnue : ${args[0] || ""}. Tape \`machines\` pour voir la liste.`, "t-err");
  if (!GAME.unlocked.includes(machine.id)) return out(`${machine.name} est verrouillée. Termine la machine précédente d'abord.`, "t-err");
  SESSION.activeMachine = machine.id;
  return out(
    `Cible active : ${machine.name} (${machine.ip}) — ${machine.difficulty}\n${machine.briefing}\n` +
    `Commence par scanner : nmap ${machine.ip}`
  );
}

function generateWriteup(machine) {
  const chrono = GAME.times[machine.id];
  const h = GAME.hintsUsed[machine.id];
  const hintsTotal = (h.recon || 0) + (h.access || 0) + (h.privesc || 0);
  const c = PRIVESC_CVSS[machine.privesc.type] || { label: machine.privesc.type };
  const lines = [
    `# Write-up — ${machine.name} (${machine.ip})`,
    "",
    `**Difficulté :** ${machine.difficulty}  `,
    `**OS :** ${machine.os}  `,
    `**Temps :** ${chrono && chrono.elapsedMs ? formatDuration(chrono.elapsedMs) : "—"}  `,
    `**Indices utilisés :** ${hintsTotal}`,
    "",
    "## Contexte",
    machine.briefing,
    "",
    "## 1. Reconnaissance",
    "Ports découverts (`nmap`) :",
    ...machine.ports.map((p) => `- ${p.port}/${p.proto} — ${p.service} (${p.version})`),
    "",
    "## 2. Accès initial",
    machine.hints.access[machine.hints.access.length - 1],
    "",
    "## 3. Élévation de privilèges",
    `Technique : **${c.label}**.`,
    machine.hints.privesc[machine.hints.privesc.length - 1],
    "",
    "## 4. Flags",
    "- `user.txt` : capturé",
    `- \`root.txt\` : \`${machine.rootFile.content}\``,
    "",
    "---",
    "*Write-up généré localement à partir de ta progression — rien n'est envoyé à un serveur.*",
  ];
  return lines.join("\n");
}
function cmdWriteup(args) {
  const name = (args[0] || "").toLowerCase();
  if (!name) return out("usage: writeup <machine> [--download]", "t-err");
  const machine = MACHINES.find((m) => m.id === name || m.name.toLowerCase() === name);
  if (!machine) return out(`Machine inconnue : ${args[0]}. Tape \`machines\` pour voir la liste.`, "t-err");
  if (!GAME.progress[machine.id].rootFlag) return out(`${machine.name} n'est pas encore terminée — le write-up sera disponible après le flag root.`, "t-err");
  const text = generateWriteup(machine);
  if (args.includes("--download") || args.includes("-d")) {
    if (typeof downloadText === "function") {
      downloadText(`writeup-${machine.id}.md`, text);
      return out(`📄 Write-up de ${machine.name} téléchargé (writeup-${machine.id}.md).`, "t-ok");
    }
  }
  return out(text);
}

function cmdReset(args) {
  const name = (args[0] || "").toLowerCase();
  if (!name) return out("usage: reset <machine>", "t-err");
  const machine = MACHINES.find((m) => m.id === name || m.name.toLowerCase() === name);
  if (!machine) return out(`Machine inconnue : ${args[0]}. Tape \`machines\` pour voir la liste.`, "t-err");
  if (!GAME.unlocked.includes(machine.id)) return out(`${machine.name} n'est pas encore débloquée.`, "t-err");

  const mult = GAME.insaneMode ? 1.5 : 1;
  const POINTS = {
    recon: Math.round(100 * mult), access: Math.round(150 * mult), privesc: Math.round(250 * mult),
    userFlag: Math.round(100 * mult), rootFlag: Math.round(200 * mult),
  };
  const p = GAME.progress[machine.id];
  let refund = 0;
  Object.keys(POINTS).forEach((k) => { if (p[k]) refund += POINTS[k]; });
  GAME.score = Math.max(0, GAME.score - refund);

  GAME.progress[machine.id] = { recon: false, access: false, privesc: false, userFlag: false, rootFlag: false };
  GAME.hintsUsed[machine.id] = { recon: 0, access: 0, privesc: 0 };
  GAME.times[machine.id] = { startedAt: null, elapsedMs: 0 };
  SESSION.cronPlanted[machine.id] = false;
  SESSION.cronTicked[machine.id] = false;
  SESSION.sudoAttempts[machine.id] = 0;
  SESSION.sudoLocked[machine.id] = false;

  if (SESSION.ctx === machine.id) resetSessionToAttacker();
  SESSION.activeMachine = machine.id;

  persistSave();
  if (typeof renderSidebar === "function") renderSidebar();
  return out(`🔄 ${machine.name} réinitialisée${refund ? ` (-${refund} pts)` : ""}. Retape \`nmap ${machine.ip}\` pour recommencer.`, "t-warn");
}

function cmdHint() {
  const mid = SESSION.activeMachine || (SESSION.ctx !== "attacker" ? SESSION.ctx : null);
  if (!mid) return out("Aucune machine ciblée. Utilise `use <nom>` d'abord.", "t-err");
  const machine = getMachine(mid);
  const stage = currentUnresolvedStage(machine);
  if (!stage) return out(`${machine.name} est déjà entièrement compromise. 🎉`);
  if (GAME.insaneMode) return out("🔥 Mode Insane actif : aucun indice disponible. Tape `insane off` pour désactiver ce mode (uniquement en tout début de partie).", "t-err");
  const used = GAME.hintsUsed[mid][stage];
  const list = machine.hints[stage];
  if (used >= list.length) return out("Plus d'indice disponible pour cette étape — tu as tout ce qu'il faut !");
  GAME.hintsUsed[mid][stage] = used + 1;
  persistSave();
  return out(`💡 Indice ${used + 1}/${list.length} (${stage}) :\n${list[used]}`, "t-hint");
}

function gameIsPristine() {
  if (GAME.score !== 0) return false;
  return MACHINES.every((m) => {
    const p = GAME.progress[m.id];
    return !p.recon && !p.access && !p.privesc && !p.userFlag && !p.rootFlag;
  }) && Object.keys(GAME.jeopardy.solved).length === 0
    && Object.keys(GAME.blueteam.answered).length === 0;
}
function cmdInsane(args) {
  const arg = (args[0] || "").toLowerCase();
  if (!arg) {
    return out(
      `Mode Insane : ${GAME.insaneMode ? "activé 🔥" : "désactivé"}.\n` +
      "Aucun indice disponible, score des machines et défis multiplié par 1.5.\n" +
      "Usage : `insane on` / `insane off` (uniquement sur une partie neuve, score à 0, rien de commencé)."
    );
  }
  if (arg !== "on" && arg !== "off") return out("usage: insane [on|off]", "t-err");
  const wantOn = arg === "on";
  if (wantOn === GAME.insaneMode) return out(`Le mode Insane est déjà ${wantOn ? "activé" : "désactivé"}.`);
  if (!gameIsPristine()) {
    return out(
      "Le mode Insane ne peut être (dés)activé que sur une sauvegarde neuve (score à 0, aucune machine ni défi entamé).\n" +
      "Utilise `reset <machine>` sur chaque machine commencée, ou repars d'un nouveau navigateur/profil, puis réessaie.",
      "t-err"
    );
  }
  GAME.insaneMode = wantOn;
  persistSave();
  return wantOn
    ? out("🔥 Mode Insane activé : plus aucun indice, mais +50% de score sur toute la partie. Bonne chance.", "t-warn")
    : out("Mode Insane désactivé. Les indices sont de nouveau disponibles.", "t-ok");
}

function cmdBadges() {
  const lines = [];
  BADGE_DEFS.forEach((def) => {
    if (def.scope === "global") {
      const on = !!GAME.badges[def.id];
      lines.push(`${on ? "✅" : "🔒"} ${def.icon} ${def.label.padEnd(16)} — ${def.desc}`);
    } else {
      const anyOn = MACHINES.some((m) => GAME.badges[badgeKey(def, m)]);
      const count = MACHINES.filter((m) => GAME.badges[badgeKey(def, m)]).length;
      lines.push(`${anyOn ? "✅" : "🔒"} ${def.icon} ${def.label.padEnd(16)} — ${def.desc} (${count}/${MACHINES.length} machines)`);
    }
  });
  const info = levelInfo(GAME.score);
  lines.push("");
  lines.push(`Niveau ${info.level} — ${info.into}/${info.span} XP vers le niveau suivant (${info.pct}%)`);
  return out(lines.join("\n"));
}

function cmdRecords() {
  const lines = ["Meilleurs temps locaux (par catégorie) :", ""];
  let any = false;
  MACHINES.forEach((m) => {
    const bt = GAME.bestTimes[m.id];
    if (!bt || !Object.keys(bt).length) return;
    any = true;
    const parts = Object.keys(RECORD_CATEGORIES)
      .filter((cat) => bt[cat] != null)
      .map((cat) => `${RECORD_CATEGORIES[cat]} : ${formatDuration(bt[cat])}`);
    lines.push(`${m.name.padEnd(10)} ${parts.join("  ·  ")}`);
  });
  if (!any) return out("Aucun record local pour le moment — termine une machine pour en établir un.");
  return out(lines.join("\n"));
}

function cmdProgress() {
  const lines = MACHINES.map((m) => {
    const p = GAME.progress[m.id];
    const locked = !GAME.unlocked.includes(m.id);
    if (locked) return `${m.name} : verrouillée`;
    const t = GAME.times[m.id] || { startedAt: null, elapsedMs: 0 };
    const chrono = p.rootFlag
      ? formatDuration(t.elapsedMs)
      : t.startedAt ? `${formatDuration(Date.now() - t.startedAt)} (en cours)` : "—";
    return `${m.name} : recon ${p.recon ? "✔" : "✘"} | accès ${p.access ? "✔" : "✘"} | privesc ${p.privesc ? "✔" : "✘"} | flag user ${p.userFlag ? "✔" : "✘"} | flag root ${p.rootFlag ? "✔" : "✘"} | ⏱ ${chrono}`;
  });
  return out(lines.join("\n") + `\n\nScore total : ${GAME.score} pts`);
}

function cmdLs(args) {
  const opts = { all: args.includes("-la") || args.includes("-al") || args.includes("-a"), long: args.includes("-la") || args.includes("-al") || args.includes("-l") };
  const pathArg = args.find((a) => !a.startsWith("-"));
  // Sans argument, `ls` liste le répertoire courant (.), pas le home (~).
  const p = resolvePath(pathArg || ".", SESSION.cwd, SESSION.home);
  if (isRootOnly(SESSION.fs, p) && SESSION.user !== "root") return out(`ls: impossible d'ouvrir le répertoire '${pathArg || "."}': Permission refusée`, "t-err");
  if (!SESSION.fs[p] && p !== "/") return out(`ls: impossible d'accéder à '${pathArg}': Fichier ou dossier introuvable`, "t-err");
  return out(formatLs(SESSION.fs, p, opts));
}
function cmdCd(args) {
  const p = resolvePath(args[0], SESSION.cwd, SESSION.home);
  if (isRootOnly(SESSION.fs, p) && SESSION.user !== "root") return out(`bash: cd: ${args[0]}: Permission refusée`, "t-err");
  const node = SESSION.fs[p];
  if (p !== "/" && (!node || node.type !== "dir")) return out(`bash: cd: ${args[0] || ""}: Fichier ou dossier introuvable`, "t-err");
  SESSION.cwd = p;
  return out("");
}
function cmdCat(args) {
  if (!args.length) return out("cat: opérande manquant", "t-err");
  const texts = [];
  for (const a of args) {
    const p = resolvePath(a, SESSION.cwd, SESSION.home);
    if (isRootOnly(SESSION.fs, p) && SESSION.user !== "root") return out(`cat: ${a}: Permission refusée`, "t-err");
    const node = SESSION.fs[p];
    if (!node || node.type !== "file") return out(`cat: ${a}: Fichier ou dossier introuvable`, "t-err");
    texts.push(node.content || "");
  }
  return out(texts.join("\n"));
}
function cmdDocker(args, rawFirst) {
  if (SESSION.ctx === "attacker") return out("bash: docker: command not found", "t-err");
  const machine = getMachine(SESSION.ctx);
  if (machine.osType === "windows") {
    return out(`'docker' n'est pas reconnu en tant que commande interne ou externe, un programme exécutable ou un fichier de commandes.`, "t-err");
  }
  // Escalade via le groupe docker (équivalent root) : docker run -v /:/mnt --rm -it alpine chroot /mnt sh
  if (machine.privesc.type === "docker-group" && machine.privesc.exploitCmdRegex.test(rawFirst.trim())) {
    SESSION.user = "root";
    SESSION.cwd = "/root";
    GAME.progress[machine.id].privesc = true;
    addScore(250);
    persistSave();
    if (typeof renderSidebar === "function") renderSidebar();
    toast(`🛠️ Élévation de privilèges réussie sur ${machine.name} (+250 pts)`);
    return out(machine.privesc.enterMsg, "t-ok");
  }
  if (args[0] === "ps") return out(machine.dockerPs || "CONTAINER ID   IMAGE     COMMAND   STATUS    PORTS     NAMES");
  return out(`docker: '${args[0] || ""}' n'est pas une commande docker reconnue dans ce lab.\nCommandes disponibles ici : ps, run.`, "t-err");
}
function cmdFind(args, rawFirst) {
  // Cas spécial obsidian : recherche des binaires SUID
  if (/^find\s+\/(\s+-perm\s+-4000\s+-type\s+f)?(\s+2>\s*\/dev\/null)?$/.test(rawFirst.replace(/\s+/g, " ").trim())) {
    const machine = SESSION.ctx !== "attacker" ? getMachine(SESSION.ctx) : null;
    if (machine && machine.targetFS.suidBinaries) return out(machine.targetFS.suidBinaries.join("\n"));
    return out("");
  }
  // Exploit générique (obsidian) : find ... -exec /bin/sh -p \; -quit
  if (SESSION.ctx !== "attacker") {
    const machine = getMachine(SESSION.ctx);
    if (machine.privesc.type === "suid-binary" && machine.privesc.exploitCmdRegex.test(rawFirst.trim())) {
      SESSION.user = "root";
      SESSION.cwd = "/root";
      GAME.progress[machine.id].privesc = true;
      addScore(250);
      persistSave();
      if (typeof renderSidebar === "function") renderSidebar();
      toast(`🛠️ Élévation de privilèges réussie sur ${machine.name} (+250 pts)`);
      return out(machine.privesc.enterMsg, "t-ok");
    }
  }
  // find générique simplifié : find <path> -name '<pattern>'
  const path = resolvePath(args[0], SESSION.cwd, SESSION.home);
  const nameIdx = args.indexOf("-name");
  const pattern = nameIdx >= 0 ? args[nameIdx + 1].replace(/^['"]|['"]$/g, "").replace(/\*/g, ".*") : null;
  const re = pattern ? new RegExp("^" + pattern + "$") : null;
  const results = Object.keys(SESSION.fs).filter((k) => k.startsWith(path === "/" ? "/" : path + "/") || k === path)
    .filter((k) => !re || re.test(baseOf(k)));
  return out(results.sort().join("\n"));
}
// Vérifie si le fichier écrit (via echo >> ou vim) correspond au script de la tâche
// planifiée piégeable de la machine, et si son contenu contient désormais la charge utile
// attendue. Générique : utilisé par cmdEcho ET par vim, pour que les deux offrent le même chemin.
function checkAndPlant(machine, path) {
  if (!machine) return;
  if (machine.privesc.type !== "cron-writable" && machine.privesc.type !== "schtask-writable") return;
  if (!machine.privesc.scriptPath || path !== machine.privesc.scriptPath) return;
  const node = SESSION.fs[path];
  if (!node || !machine.privesc.plantContentRegex.test(node.content || "")) return;
  SESSION.cronPlanted[machine.id] = true;
  SESSION.cronTicked[machine.id] = false;
}
// cloudctl : fausse CLI de stockage objet (type aws s3). Recon/pillage d'un bucket mal
// configuré (accès public). Purement en dur, aucun vrai SDK ni requête réseau.
function parseS3(uri) {
  const m = (uri || "").match(/^s3:\/\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  return { bucket: m[1], key: m[2] || "" };
}
function cloudMachines() {
  return MACHINES.filter((m) => m.cloud && GAME.unlocked.includes(m.id));
}
function findBucket(name) {
  for (const m of cloudMachines()) {
    if (m.cloud.buckets[name]) return { machine: m, bucket: m.cloud.buckets[name] };
  }
  return null;
}
function cmdCloudctl(args) {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "help") {
    return out(
      "cloudctl — client de stockage objet (simulé)\n\n" +
        "  cloudctl ls                      liste les buckets accessibles\n" +
        "  cloudctl ls s3://<bucket>        liste le contenu d'un bucket\n" +
        "  cloudctl get s3://<bucket>/<clé>  télécharge/affiche un objet\n" +
        "  cloudctl cp <fichier> s3://<bucket>/  téléverse un objet (si autorisé)",
    );
  }
  const clouds = cloudMachines();
  if (sub === "ls") {
    const uri = args[1];
    if (!uri) {
      if (!clouds.length) return out("cloudctl: aucun bucket accessible (aucun endpoint de stockage découvert).", "t-err");
      const lines = [];
      for (const m of clouds) {
        for (const [name, b] of Object.entries(m.cloud.buckets)) {
          lines.push(`${b.public ? "PUBLIC " : "private"}  s3://${name}`);
        }
      }
      return out(lines.join("\n"));
    }
    const s3 = parseS3(uri);
    if (!s3) return out(`cloudctl: URI invalide (${uri}) — attendu s3://<bucket>[/<clé>]`, "t-err");
    const hit = findBucket(s3.bucket);
    if (!hit) return out(`cloudctl: bucket introuvable : ${s3.bucket}`, "t-err");
    if (!hit.bucket.public) return out(`cloudctl: AccessDenied — pas d'autorisation de lister s3://${s3.bucket} (bucket privé).`, "t-err");
    const files = Object.keys(hit.bucket.files);
    return out(files.map((f) => `s3://${s3.bucket}/${f}`).join("\n") || "(bucket vide)");
  }
  if (sub === "get") {
    const s3 = parseS3(args[1]);
    if (!s3 || !s3.key) return out("usage: cloudctl get s3://<bucket>/<clé>", "t-err");
    const hit = findBucket(s3.bucket);
    if (!hit) return out(`cloudctl: bucket introuvable : ${s3.bucket}`, "t-err");
    if (!hit.bucket.public) return out(`cloudctl: AccessDenied — s3://${s3.bucket} est privé.`, "t-err");
    const content = hit.bucket.files[s3.key];
    if (content === undefined) return out(`cloudctl: objet introuvable : s3://${s3.bucket}/${s3.key}`, "t-err");
    return out(content);
  }
  if (sub === "cp") {
    const dst = parseS3(args[args.length - 1]);
    if (!dst) return out("usage: cloudctl cp <fichier_local> s3://<bucket>/", "t-err");
    const hit = findBucket(dst.bucket);
    if (!hit) return out(`cloudctl: bucket introuvable : ${dst.bucket}`, "t-err");
    if (!hit.bucket.writable) return out(`cloudctl: AccessDenied — écriture refusée sur s3://${dst.bucket} (lecture seule).`, "t-err");
    // Bucket de déploiement writable : son contenu est récupéré et exécuté automatiquement
    // par le pipeline CI côté serveur -> exécution de code à distance. Si le joueur écoute
    // (nc -lvnp <port>), le "déploiement" rappelle vers lui et ouvre un accès.
    if (hit.bucket.deploy) {
      if (SESSION.listening === null) {
        return out(
          "(objet téléversé — mais ce bucket est déployé/exécuté automatiquement côté serveur : " +
            "mets-toi d'abord en écoute avec `nc -lvnp <port>` pour recevoir le callback du pipeline)",
          "t-err",
        );
      }
      const port = SESSION.listening;
      SESSION.listening = null;
      return grantAccess(
        hit.machine,
        hit.bucket.deploy.user,
        `Le pipeline de déploiement a récupéré et exécuté ton objet depuis s3://${dst.bucket}/ — ` +
          `connexion entrante sur le port ${port} depuis ${hit.machine.ip} !\n`,
      );
    }
    return out(`upload: ${args[1] || "(fichier)"} -> s3://${dst.bucket}/ (accepté — le bucket autorise l'écriture publique).`, "t-ok");
  }
  return out(`cloudctl: sous-commande inconnue : ${sub} (essaie \`cloudctl --help\`)`, "t-err");
}
function cmdNc(args) {
  const isListen = args.some((a) => /^-[a-z]*l[a-z]*$/i.test(a));
  const portArg = args.find((a) => /^\d+$/.test(a));
  if (isListen) {
    if (SESSION.ctx !== "attacker") return out("nc: -l n'a de sens que côté attaquant (local).", "t-err");
    if (!portArg) return out("usage: nc -lvnp <port>", "t-err");
    SESSION.listening = parseInt(portArg, 10);
    return out(
      `Listening on 0.0.0.0 ${SESSION.listening}\n` +
        "(en attente d'une connexion entrante — reste en écoute jusqu'à une nouvelle commande `nc -l` ou `exit`)",
    );
  }
  const ip = args.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  if (!ip || !portArg) return out("usage: nc <ip> <port>", "t-err");
  const port = parseInt(portArg, 10);
  const machine = MACHINES.find((m) => m.ip === ip);
  if (!machine) return out(`nc: connect to ${ip} port ${port} (tcp) failed: Aucun chemin vers l'hôte`, "t-err");
  if (!GAME.unlocked.includes(machine.id)) return out("Machine verrouillée.", "t-err");
  const svc = machine.ports.find((p) => p.port === port && p.state === "open");
  if (!svc) return out(`nc: connect to ${ip} port ${port} (tcp) failed: Connexion refusée`, "t-err");
  return out(
    `Connexion à ${ip} ${port} port [tcp/*] réussie !\n${svc.version || svc.service}\n` +
      "(bannière brute uniquement — ce service ne fournit pas de shell direct ; regarde du côté de ssh/ftp/curl pour l'exploiter)",
  );
}
function cmdVim(args) {
  const target = args[0];
  if (!target) return out("usage: vim <fichier>", "t-err");
  const p = resolvePath(target, SESSION.cwd, SESSION.home);
  if (isRootOnly(SESSION.fs, p) && SESSION.user !== "root") return out("Accès refusé.", "t-err");
  const existing = SESSION.fs[p];
  if (existing && existing.type === "dir") return out(`vim: ${target} : est un dossier`, "t-err");
  if (existing && !canWrite(existing, existing.owner === SESSION.user) && SESSION.user !== "root") {
    return out(`"${target}" E212: impossible d'ouvrir le fichier en écriture (permission refusée)`, "t-err");
  }
  SESSION.vimMode = {
    path: p,
    lines: existing ? (existing.content || "").split("\n") : [],
    isNew: !existing,
    machineId: SESSION.ctx,
  };
  const header = existing
    ? `"${target}" ${SESSION.vimMode.lines.length}L — édition (mini-vim)`
    : `"${target}" [Nouveau fichier] — édition (mini-vim)`;
  return out(
    `${header}\n` +
      "-- INSERT -- tape ton contenu ligne par ligne.\n" +
      ":wq enregistrer et quitter · :q! quitter sans enregistrer · :show afficher le buffer",
    "t-hint",
  );
}
function handleVimInput(line) {
  const v = SESSION.vimMode;
  if (line === ":wq" || line === ":x" || line === ":wq!") {
    const content = v.lines.join("\n");
    let node = SESSION.fs[v.path];
    if (!node) {
      node = { type: "file", perms: "-rw-r--r--", owner: SESSION.user, content };
      SESSION.fs[v.path] = node;
      ensureParents(SESSION.fs, v.path);
    } else {
      node.content = content;
    }
    SESSION.vimMode = null;
    if (v.machineId !== "attacker") {
      const machine = getMachine(v.machineId);
      checkAndPlant(machine, v.path);
    }
    return out(`"${v.path}" ${v.lines.length}L, ${content.length}C écrits`, "t-ok");
  }
  if (line === ":q!" || line === ":q") {
    SESSION.vimMode = null;
    return out("(édition annulée, rien n'a été enregistré)", "t-warn");
  }
  if (line === ":show") {
    return out(v.lines.map((l, i) => `${String(i + 1).padStart(3)} ${l}`).join("\n") || "(buffer vide)");
  }
  v.lines.push(line);
  return out("");
}
// Les guillemets, l'expansion ($VAR/$?/$(...)) et les redirections (>, >>) sont
// désormais gérés en amont par le parser (parseWords + applyRedirects) : echo se
// contente d'afficher ses arguments déjà développés.
function cmdEcho(args) {
  return out(args.join(" "));
}

// ── Sous-réseau interne simulé (découverte multi-hôtes via un pivot) ─────────
// Une fois un tunnel `ssh -L` établi vers un segment interne, `nmap <cidr>` révèle
// plusieurs hôtes d'un coup et `arp -a` montre la table ARP. Les hôtes "leurres"
// répondent au scan mais ne sont pas exploitables (pistes mortes = réalisme recon).
const SUBNETS = [
  {
    cidr: "172.16.20.0/24",
    hosts: [
      { ip: "172.16.20.1", name: "gw-internal", os: "pfSense 2.7", ports: "—", note: "passerelle du segment" },
      { ip: "172.16.20.10", name: "citadel", os: "Linux (Debian 12)", ports: "22/ssh, 5432/postgresql", note: "serveur de base de données" },
      { ip: "172.16.20.20", name: "nas-backup", os: "TrueNAS", ports: "445/smb, 2049/nfs", note: "partages de sauvegarde (hors périmètre)" },
      { ip: "172.16.20.50", name: "hp-lj-4300", os: "embedded", ports: "80/http, 631/ipp, 9100/jetdirect", note: "imprimante réseau" },
    ],
  },
];
function subnetReachable(sub) {
  return !!(SESSION.tunnel && ipInRange(SESSION.tunnel.targetIp, sub.cidr));
}
function findSubnet(cidr) {
  if (SUBNETS.some((s) => s.cidr === cidr)) return SUBNETS.find((s) => s.cidr === cidr);
  // tolère un /24 dont le réseau correspond (ex : 172.16.20.5/24 -> 172.16.20.0/24)
  return SUBNETS.find((s) => {
    const base = s.cidr.split("/")[0];
    return ipInRange(base, cidr.includes("/") ? cidr.replace(/\.\d+\//, ".0/") : cidr);
  });
}
function decoyHost(ip) {
  for (const s of SUBNETS) {
    if (!subnetReachable(s)) continue;
    const h = s.hosts.find((hh) => hh.ip === ip);
    if (h) return h;
  }
  return null;
}
function cmdNmapSubnet(cidr) {
  const sub = findSubnet(cidr);
  if (!sub) return out(`Aucune route vers le réseau ${cidr}.`, "t-err");
  if (!subnetReachable(sub)) {
    return out(
      `Aucune route vers le réseau ${cidr} — segment interne non routable directement.\n` +
        "(établis d'abord un tunnel/pivot vers ce segment, ex. `ssh -L <port>:<hôte_interne>:22 <user>@<pivot>`)",
      "t-err",
    );
  }
  const header = `Nmap scan report — balayage de ${sub.cidr}\n\nHÔTE            NOM            OS               PORTS`;
  const rows = sub.hosts.map((h) => `${h.ip.padEnd(15)} ${h.name.padEnd(14)} ${h.os.padEnd(16)} ${h.ports}`);
  return out(
    header + "\n" + rows.join("\n") +
      `\n\n${sub.hosts.length} hôtes actifs. Scanne-en un précisément avec \`nmap <ip>\` ; \`arp -a\` pour la table ARP.`,
  );
}
function fakeMac(ip) {
  const p = String(ip).split(".").map(Number);
  const h = (p[2] * 256 + p[3]) & 0xffff;
  return `02:16:3e:${((p[2]) & 0xff).toString(16).padStart(2, "0")}:${((h >> 8) & 0xff).toString(16).padStart(2, "0")}:${(h & 0xff).toString(16).padStart(2, "0")}`;
}
function cmdArp() {
  const reach = SUBNETS.filter(subnetReachable);
  if (!reach.length) return out("arp: table vide (aucun segment interne joignable — établis d'abord un tunnel/pivot).");
  const lines = ["Adresse           HWtype  HWadresse           Iface"];
  reach.forEach((s) => s.hosts.forEach((h) => lines.push(`${h.ip.padEnd(17)} ether   ${fakeMac(h.ip)}   tun0`)));
  return out(lines.join("\n"));
}

function cmdNmap(args) {
  const cidrArg = args.find((a) => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(a));
  if (cidrArg) return cmdNmapSubnet(cidrArg);
  const ip = args.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || (SESSION.activeMachine && getMachine(SESSION.activeMachine).ip);
  const machine = MACHINES.find((m) => m.ip === ip);
  if (!machine) {
    const decoy = decoyHost(ip);
    if (decoy) {
      return out(
        `Nmap scan report for ${decoy.name} (${decoy.ip})\nHost is up.\n\nPORTS : ${decoy.ports}\nOS : ${decoy.os}\n` +
          `(${decoy.note} — aucune vulnérabilité connue exposée ici : piste morte, continue ailleurs)`,
      );
    }
    return out(`Aucune route vers l'hôte ${ip || ""}`, "t-err");
  }
  if (!GAME.unlocked.includes(machine.id)) return out("Machine verrouillée.", "t-err");
  if (!isReachable(machine)) return unreachableMsg(machine);
  SESSION.activeMachine = machine.id;
  const wasScanned = GAME.progress[machine.id].recon;
  if (!wasScanned) {
    GAME.progress[machine.id].recon = true;
    addScore(100);
    if (!GAME.times[machine.id]) GAME.times[machine.id] = { startedAt: null, elapsedMs: 0 };
    if (!GAME.times[machine.id].startedAt) GAME.times[machine.id].startedAt = Date.now();
    persistSave();
    if (typeof renderSidebar === "function") renderSidebar();
    toast(`🔍 Reconnaissance terminée sur ${machine.name} (+100 pts)`);
  }
  const header = `Nmap scan report for ${machine.name.toLowerCase()} (${machine.ip})\nHost is up.\n\nPORT      STATE SERVICE  VERSION`;
  const rows = machine.ports.map((p) => `${String(p.port + "/" + p.proto).padEnd(9)} ${p.state.padEnd(5)} ${p.service.padEnd(8)} ${p.version}`);
  return out(header + "\n" + rows.join("\n"));
}

function parseUrl(u) {
  const m = u.match(/^https?:\/\/([^:/]+)(?::(\d+))?(\/.*)?$/);
  if (!m) return null;
  return { ip: m[1], port: m[2] ? parseInt(m[2], 10) : 80, path: m[3] || "/" };
}
function cmdCurl(args) {
  const dIdx = args.findIndex((a) => a === "-d" || a === "--data");
  const isPost = dIdx >= 0;
  const data = isPost ? (args[dIdx + 1] || "") : null;
  const fIdx = args.findIndex((a) => a === "-F" || a === "--form");
  const isUpload = fIdx >= 0;
  const formData = isUpload ? (args[fIdx + 1] || "") : null;
  const urlArg = args.find((a) => a.startsWith("http"));
  if (!urlArg) return out("curl: aucune URL fournie", "t-err");
  const u = parseUrl(urlArg);
  if (!u) return out("curl: URL invalide", "t-err");
  const machine = MACHINES.find((m) => m.ip === u.ip);
  if (!machine) return out(`curl: (7) Échec de connexion à ${u.ip} port ${u.port} : Connexion refusée`, "t-err");
  if (!GAME.unlocked.includes(machine.id)) return out("curl: machine verrouillée.", "t-err");
  if (!isReachable(machine)) return unreachableMsg(machine);
  const httpPort = machine.ports.find((p) => p.service === "http");
  if (!httpPort || httpPort.port !== u.port) return out(`curl: (7) Échec de connexion à ${u.ip} port ${u.port} : Connexion refusée`, "t-err");

  // Upload de fichier (curl -F "file=@webshell.php") sur un formulaire mal filtré.
  if (isUpload) {
    const up = machine.upload;
    if (!up || u.path !== up.formPath) return out(`curl: (22) Erreur HTTP 404 sur ${u.path}`, "t-err");
    const fname = ((formData.split("@").pop() || formData).trim()) || formData;
    if (!up.filenameRegex.test(fname)) {
      return out(`Upload refusé : type de fichier non autorisé (${fname}).\n(le filtre n'accepte a priori que des images...)`, "t-err");
    }
    SESSION.uploaded[machine.id] = true;
    return out(
      `Upload accepté : ${fname}\nFichier enregistré côté serveur : ${up.webshellPath}\n` +
        "(le filtre ne valide que l'extension apparente — un script déguisé passe. À toi de le déclencher.)",
      "t-ok",
    );
  }

  if (isPost) {
    if (!machine.sqli || u.path !== machine.sqli.path) {
      return out(`curl: (22) Erreur HTTP 404 sur ${u.path}`, "t-err");
    }
    if (machine.sqli.injectionRegex.test(data)) return out(machine.sqli.successBody);
    return out(machine.sqli.failBody);
  }

  if (machine.altAccess) {
    const aa = machine.altAccess;
    const qIdx = u.path.indexOf("?");
    const basePath = qIdx >= 0 ? u.path.slice(0, qIdx) : u.path;
    const query = qIdx >= 0 ? u.path.slice(qIdx + 1) : "";
    if (basePath === aa.path && aa.injectRegex.test(query)) {
      if (aa.requiresUpload && !SESSION.uploaded[machine.id]) {
        return out(
          `curl: (22) Erreur HTTP 404 sur ${basePath} — aucun fichier à ce chemin.\n` +
            "(il faut d'abord uploader ton webshell via le formulaire, cf. son endpoint d'upload)",
          "t-err",
        );
      }
      // Injection de commande détectée sur l'endpoint vulnérable. L'IP et le port du
      // callback sont parsés depuis le payload du joueur (variables, plus câblés en dur) :
      // c'est ce qui rend le mécanisme réutilisable par n'importe quelle machine.
      const cb = query.match(/nc\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)/);
      if (!cb) {
        return out(
          "(injection de commande acceptée, mais aucune cible `nc <ip> <port>` reconnue dans le payload)",
          "t-err",
        );
      }
      const cbIp = cb[1];
      const cbPort = parseInt(cb[2], 10);
      if (cbIp !== ATTACKER_IP) {
        return out(
          `(le callback vise ${cbIp}, or ton IP d'attaquant est ${ATTACKER_IP} — corrige l'adresse dans le payload)`,
          "t-err",
        );
      }
      if (SESSION.listening !== cbPort) {
        return out(
          "(la requête part bien, mais rien ne revient — mets-toi d'abord en écoute avec " +
            `\`nc -lvnp ${cbPort}\` sur le même port que celui visé par ton payload)`,
          "t-err",
        );
      }
      SESSION.listening = null;
      return grantAccess(
        machine,
        aa.user,
        `Connexion entrante reçue sur le port ${cbPort} depuis ${machine.ip} !\n`,
      );
    }
  }

  const content = machine.web[u.path];
  if (content === undefined) return out(`curl: (22) Erreur HTTP 404 sur ${u.path}`, "t-err");
  return out(content);
}
function cmdFtp(args) {
  const ipArg = args.find((a) => /\d+\.\d+\.\d+\.\d+/.test(a)) || "";
  const ip = ipArg.includes("@") ? ipArg.split("@")[1] : ipArg;
  const machine = MACHINES.find((m) => m.ip === ip);
  if (!machine) return out(`ftp: impossible de se connecter à ${ip}`, "t-err");
  if (!machine.ftp || !machine.ftp.enabled) return out(`ftp: connexion refusée sur ${ip} (aucun service FTP)`, "t-err");
  const dirName = `loot/${machine.id}-ftp`;
  const dirPath = SESSION.home + "/" + dirName;
  if (!SESSION.fs[dirPath]) SESSION.fs[dirPath] = { type: "dir" };
  for (const [name, content] of Object.entries(machine.ftp.files)) {
    SESSION.fs[dirPath + "/" + name] = { type: "file", perms: "-rw-r--r--", owner: "ftp", content };
  }
  ensureParents(SESSION.fs, dirPath);
  return out(`${machine.ftp.loginMsg}\nFichiers montés dans ~/${dirName}/ (utilise ls / cat pour les consulter).`);
}

function cmdSsh(args) {
  const target = args.find((a) => a.includes("@"));

  // Redirection de port local (ssh -L <lport>:<hôte_cible>:<tport> <user>@<pivot>) : établit
  // un tunnel à travers une machine déjà rootée, rendant un hôte interne joignable. Simulé :
  // on n'exige pas le mot de passe du pivot (on est censé y avoir déjà un accès root).
  const lIdx = args.indexOf("-L");
  if (lIdx >= 0) {
    const spec = args[lIdx + 1] || "";
    const mm = spec.match(/^(\d+):(\d+\.\d+\.\d+\.\d+):(\d+)$/);
    if (!mm) return out("usage: ssh -L <port_local>:<hôte_cible>:<port_cible> <user>@<hôte_pivot>", "t-err");
    const pivotIp = target ? target.split("@")[1] : null;
    const pivot = MACHINES.find((m) => m.ip === pivotIp);
    if (!pivot) return out(`ssh: impossible de résoudre l'hôte pivot ${pivotIp || "(manquant)"}`, "t-err");
    if (!GAME.progress[pivot.id].rootFlag) {
      return out(`ssh: il faut d'abord compromettre (obtenir root sur) ${pivot.name} pour ouvrir un tunnel à travers lui.`, "t-err");
    }
    const targetMachine = MACHINES.find((m) => m.ip === mm[2]);
    SESSION.tunnel = { localPort: parseInt(mm[1], 10), targetIp: mm[2], targetPort: parseInt(mm[3], 10) };
    return out(
      `Tunnel SSH établi : 127.0.0.1:${mm[1]} -> ${mm[2]}:${mm[3]} (via ${pivot.name}).\n` +
        `L'hôte interne ${mm[2]}${targetMachine ? ` (${targetMachine.name})` : ""} est maintenant joignable ` +
        "(nmap / ssh directement sur son IP).",
      "t-ok",
    );
  }

  if (!target) return out("usage: ssh utilisateur@ip [-p port]", "t-err");
  const [user, ip] = target.split("@");
  const portIdx = args.indexOf("-p");
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 22;
  const machine = MACHINES.find((m) => m.ip === ip);
  if (!machine) return out(`ssh: connect to host ${ip} port ${port}: Aucun chemin vers l'hôte`, "t-err");
  if (!GAME.unlocked.includes(machine.id)) return out("Machine verrouillée.", "t-err");
  if (!isReachable(machine)) return unreachableMsg(machine);
  const creds = machine.sshUsers[user];
  const expectedPort = creds && creds.port ? creds.port : 22;
  if (!creds || expectedPort !== port) return out(`ssh: connect to host ${ip} port ${port}: Connexion refusée`, "t-err");

  // Demande le mot de passe à la prochaine ligne
  waitForPassword(machine, user);
  return out(`${user}@${ip}'s password: `, "t-prompt-inline");
}

let PENDING_SSH = null;
function waitForPassword(machine, user) { PENDING_SSH = { machine, user }; }

// Logique partagée d'obtention d'un accès initial (utilisée par ssh, et par tout
// chemin alternatif comme une reverse shell) : place la session sur la machine,
// crédite les points d'accès une seule fois (wasAccessed), et retourne le message.
function grantAccess(machine, user, introExtra) {
  SESSION.ctx = machine.id;
  SESSION.user = user;
  SESSION.host = machine.targetFS.hostname;
  SESSION.home = machine.targetFS.homeDir;
  SESSION.cwd = machine.targetFS.homeDir;
  SESSION.fs = buildTargetFS(machine, user);
  SESSION.activeMachine = machine.id;
  SESSION.sudoAttempts[machine.id] = 0;
  SESSION.sudoLocked[machine.id] = false;
  const wasAccessed = GAME.progress[machine.id].access;
  let msg = introExtra || `Bienvenue sur ${machine.targetFS.hostname} (${machine.os}).\nDernière connexion réussie.\n`;
  if (!wasAccessed) {
    GAME.progress[machine.id].access = true;
    addScore(150);
    persistSave();
    if (typeof renderSidebar === "function") renderSidebar();
    toast(`🔑 Accès initial obtenu sur ${machine.name} (+150 pts)`);
    msg += machine.osType === "windows"
      ? "Cherche le flag utilisateur (`type user.txt`), puis explore les tâches planifiées (`schtasks /query`)."
      : "Cherche le flag utilisateur (`cat user.txt`), puis prépare l'élévation de privilèges (`sudo -l`).";
  }
  return out(msg);
}

function tryPassword(pwd) {
  const { machine, user } = PENDING_SSH;
  PENDING_SSH = null;
  const creds = machine.sshUsers[user];
  if (pwd !== creds.password) {
    return out(`Permission denied, please try again.\n(refais \`ssh ${user}@${machine.ip}\`${creds.port ? " -p " + creds.port : ""} pour retenter)`, "t-err");
  }
  return grantAccess(machine, user);
}

function cmdSudo(args, rawFirst) {
  if (SESSION.ctx === "attacker") return out("sudo: la commande sudo n'est pas nécessaire ici.", "t-err");
  const machine = getMachine(SESSION.ctx);
  if (machine.osType === "windows") {
    return out("'sudo' n'est pas reconnu en tant que commande interne ou externe, un programme exécutable ou un fichier de commandes.", "t-err");
  }
  if (SESSION.sudoLocked[machine.id]) {
    return out(`sudo: ${SESSION.user} : compte verrouillé après trop de tentatives échouées.\nReconnecte-toi (ssh) pour réessayer.`, "t-err");
  }
  if (args[0] === "-l") return out(machine.targetFS.sudoL);
  if (machine.privesc.type === "sudo-gtfobins" && machine.privesc.exploitCmdRegex.test(rawFirst.trim())) {
    SESSION.pagerMode = machine.id;
    return out(machine.privesc.enterMsg, "t-warn");
  }
  if (machine.privesc.type === "sudo-direct" && machine.privesc.exploitCmdRegex.test(rawFirst.trim())) {
    SESSION.user = "root";
    SESSION.cwd = parentOf(machine.rootFile.path);
    GAME.progress[machine.id].privesc = true;
    addScore(250);
    persistSave();
    if (typeof renderSidebar === "function") renderSidebar();
    toast(`🛠️ Élévation de privilèges réussie sur ${machine.name} (+250 pts)`);
    return out(machine.privesc.enterMsg, "t-ok");
  }
  SESSION.sudoAttempts[machine.id] = (SESSION.sudoAttempts[machine.id] || 0) + 1;
  const attempts = SESSION.sudoAttempts[machine.id];
  const base = `Désolé, l'utilisateur ${SESSION.user} n'est pas autorisé à exécuter cette commande en root sur ${machine.targetFS.hostname}.`;
  if (attempts >= 3) {
    SESSION.sudoLocked[machine.id] = true;
    return out(`${base}\nsudo: 3 tentatives incorrectes\nsudo: compte verrouillé — reconnecte-toi (ssh) pour réessayer.`, "t-err");
  }
  return out(`${base}\nCette tentative sera signalée. (${attempts}/3 avant verrouillage)`, "t-err");
}
function cmdCrontab(args) {
  if (SESSION.ctx === "attacker") return out("crontab: aucune tâche planifiée en local.");
  const machine = getMachine(SESSION.ctx);
  if (machine.osType === "windows") {
    return out("'crontab' n'est pas reconnu en tant que commande interne ou externe, un programme exécutable ou un fichier de commandes.\n(essaie plutôt schtasks /query)", "t-err");
  }
  if (args[0] === "-l") return out(`Aucune tâche planifiée pour ${SESSION.user}.\n(regarde plutôt du côté de /etc/cron.d/)`);
  return out("crontab: usage: crontab -l", "t-err");
}
function cmdDir(args) {
  const pathArg = args.find((a) => !a.startsWith("-"));
  const p = resolvePath(pathArg, SESSION.cwd, SESSION.home);
  if (isRootOnly(SESSION.fs, p) && SESSION.user !== "root") return out("Accès refusé.", "t-err");
  if (!SESSION.fs[p] && p !== "/") return out("Le chemin d'accès spécifié est introuvable.", "t-err");
  const names = children(SESSION.fs, p).sort();
  const lines = names.map((n) => {
    const abs = p === "/" ? "/" + n : p + "/" + n;
    const node = SESSION.fs[abs] || {};
    return node.type === "dir"
      ? `${"".padEnd(19)}<REP>          ${n}`
      : `${"".padEnd(19)}${String((node.content || "").length).padStart(10)} ${n}`;
  });
  return out(`Le répertoire de ${winPath(p)}\n\n${lines.join("\n")}\n\n${names.length} fichier(s)`);
}
function cmdType(args) {
  if (!args.length) return out("La syntaxe de la commande n'est pas correcte.", "t-err");
  const texts = [];
  for (const a of args) {
    const p = resolvePath(a, SESSION.cwd, SESSION.home);
    if (isRootOnly(SESSION.fs, p) && SESSION.user !== "root") return out("Accès refusé.", "t-err");
    const node = SESSION.fs[p];
    if (!node || node.type !== "file") return out("Le système ne trouve pas le fichier spécifié.", "t-err");
    texts.push(node.content || "");
  }
  return out(texts.join("\n"));
}
function cmdNet(args) {
  if (SESSION.ctx === "attacker") return out("'net' n'est pas reconnu en tant que commande interne ou externe, un programme exécutable ou un fichier de commandes.", "t-err");
  const machine = getMachine(SESSION.ctx);
  if (args[0] === "user" && !args[1]) return out(machine.targetFS.netUsers || "Aucun compte trouvé.");
  if (args[0] === "localgroup" && (args[1] || "").toLowerCase() === "administrators") {
    return out(machine.targetFS.netAdmins || "Nom d'alias     Administrators\nMembres\n-------------------------------------------------------------------------\nAdministrateur\nLa commande s'est terminée correctement.");
  }
  return out("La syntaxe de cette commande est incorrecte.", "t-err");
}
function cmdSchtasks(args) {
  if (SESSION.ctx === "attacker") return out("'schtasks' n'est pas reconnu en tant que commande interne ou externe, un programme exécutable ou un fichier de commandes.", "t-err");
  const machine = getMachine(SESSION.ctx);
  if (args.includes("/query")) return out(machine.targetFS.schtasksOutput || "Aucune tâche planifiée trouvée.");
  return out("Syntaxe incorrecte. Essaie : schtasks /query /fo LIST /v", "t-err");
}
function cmdIcacls(args) {
  if (SESSION.ctx === "attacker") return out("'icacls' n'est pas reconnu en tant que commande interne ou externe, un programme exécutable ou un fichier de commandes.", "t-err");
  const target = args[0];
  if (!target) return out("Syntaxe incorrecte.", "t-err");
  const p = resolvePath(target, SESSION.cwd, SESSION.home);
  const node = SESSION.fs[p];
  if (!node) return out(`${target}: Le système ne trouve pas le fichier spécifié.`, "t-err");
  const worldWritable = (node.perms || "")[8] === "w" || (node.perms || "")[5] === "w";
  const lines = [`${winPath(p)} ${node.owner || "SYSTEM"}:(F)`];
  if (worldWritable) lines.push(`${" ".repeat(winPath(p).length)} BUILTIN\\Users:(F)`);
  lines.push("Successfully processed 1 files; Failed processing 0 files.");
  return out(lines.join("\n"));
}
function cmdBashDashP(args, rawFirst) {
  if (SESSION.ctx === "attacker") return out("bash: -p: option invalide en local.", "t-err");
  const machine = getMachine(SESSION.ctx);
  if (machine.privesc.type === "cron-writable" && machine.privesc.escalateRegex.test(rawFirst.trim())) {
    if (!SESSION.cronPlanted[machine.id] || !SESSION.cronTicked[machine.id]) {
      return out("bash: -p: le binaire n'a pas (encore) le bit SUID. As-tu piégé le script exécuté par la tâche cron ?", "t-err");
    }
    SESSION.user = "root";
    SESSION.cwd = "/root";
    GAME.progress[machine.id].privesc = true;
    addScore(250);
    persistSave();
    if (typeof renderSidebar === "function") renderSidebar();
    toast(`🛠️ Élévation de privilèges réussie sur ${machine.name} (+250 pts)`);
    return out("bash-5.1# (shell root obtenu via le bit SUID)", "t-ok");
  }
  return out("bash: -p: option invalide.", "t-err");
}
function cmdExit() {
  if (SESSION.sandbox) { resetSessionToAttacker(); return out("Bac à sable quitté — retour sur ta machine (kali)."); }
  if (SESSION.ctx === "attacker") return out("Rien à quitter ici (tape simplement d'autres commandes).");
  const wasMachine = SESSION.ctx;
  resetSessionToAttacker();
  SESSION.activeMachine = wasMachine;
  return out("Connexion fermée.");
}
