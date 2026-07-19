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
  data.saveVersion = SAVE_VERSION;
  return data;
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return sanitizeGameState(JSON.parse(raw));
  } catch (e) {}
  return sanitizeGameState({ score: 0, unlocked: [MACHINES[0].id], progress: {}, hintsUsed: {}, times: {}, badges: {}, bestTimes: {}, jeopardy: { solved: {}, hintsUsed: {} }, insaneMode: false });
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
  "dir", "type", "net", "schtasks", "icacls", "vim", "nc", "cloudctl",
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
      const unlocked = MACHINES.filter((m) => GAME.unlocked.includes(m.id));
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
    check: () => MACHINES.every((m) => GAME.progress[m.id].rootFlag),
  },
  {
    id: "jeopardy_complete",
    icon: "🧩",
    label: "Codebreaker",
    desc: "Résous tous les défis du mode Jeopardy.",
    scope: "global",
    check: () => CHALLENGES.every((c) => GAME.jeopardy.solved[c.id]),
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
      if (SESSION.ctx === "attacker") return out(`uid=1000(kali) gid=1000(kali) groupes=1000(kali)`);
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
    case "cloudctl": return cmdCloudctl(args);
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
    "Reconnaissance : nmap <ip>, curl <url>, ftp <ip>, nc <ip> <port>, cloudctl ls|get|cp\n" +
    "Accès : ssh <user>@<ip> [-p <port>], curl -F \"file=@<webshell>\" <url> (upload), ssh -L <lport>:<hôte_interne>:<port> <user>@<pivot> (tunnel/pivot)\n" +
    "Système (une fois connecté ou en local) : ls [-la], cd, pwd, cat, find, echo, vim <fichier>, whoami, id, sudo -l, sudo <cmd>, crontab -l, docker ps\n" +
    "Windows (machine cible Windows) : dir, type, net user, net localgroup administrators, schtasks /query, icacls <fichier>\n" +
    "Filtres en pipe : grep, wc -l, sort [-u], head, tail, cut, awk '{print $N}'\n" +
    "Shell : variables $USER/$HOME/$PWD/$HOSTNAME/$UID/$? (${VAR} aussi), substitution $(commande), redirections > >> 2> &> 2>/dev/null"
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
  }) && Object.keys(GAME.jeopardy.solved).length === 0;
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
  const p = resolvePath(pathArg, SESSION.cwd, SESSION.home);
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
    if (!hit.bucket.public) return out(`cloudctl: AccessDenied — écriture refusée sur s3://${dst.bucket} (bucket privé).`, "t-err");
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

function cmdNmap(args) {
  const ip = args.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || (SESSION.activeMachine && getMachine(SESSION.activeMachine).ip);
  const machine = MACHINES.find((m) => m.ip === ip);
  if (!machine) return out(`Aucune route vers l'hôte ${ip || ""}`, "t-err");
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
  if (SESSION.ctx === "attacker") return out("Rien à quitter ici (tape simplement d'autres commandes).");
  const wasMachine = SESSION.ctx;
  resetSessionToAttacker();
  SESSION.activeMachine = wasMachine;
  return out("Connexion fermée.");
}
