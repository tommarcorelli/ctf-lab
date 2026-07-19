# CTF Lab

Mini plateforme façon RootMe/HackTheBox : terminal simulé en vanilla JS (aucune dépendance), inspirée de la structure de LinuxDojo.

## Lancer le projet

Aucun build : ouvre simplement `index.html` dans un navigateur.

## Structure

```
index.html        Page + layout (sidebar machines + terminal)
css/style.css      Thème sombre / clair / contraste élevé, effets FX
js/machines.js     Données des 12 machines (fs, services, creds, exploits, indices)
js/engine.js        Moteur : FS virtuel, commandes, pipes, scoring, badges, records, write-up, sauvegarde
js/app.js           Liaison DOM <-> moteur (input, prompt, toasts, sidebar, particules, PWA)
manifest.json      Manifeste PWA (installation, icône, nom)
sw.js               Service worker (cache hors-ligne)
icon.svg            Icône de l'application
```

## Progression

Chaque machine suit 4 chapitres : **Recon → Accès initial → Élévation de privilèges → Flag**.
Terminer le flag root d'une machine débloque la suivante. La progression, le score et les indices
utilisés sont sauvegardés dans le `localStorage` du navigateur (clé `ctf_lab_save_v1`).

- **NIMBUS** (facile) — FTP anonyme → fuite d'identifiants → SSH → sudo GTFOBins (`less`)
- **VORTEX** (facile) — API REST avec IDOR (`/api/users/<id>`) → SSH → sudo GTFOBins (`man`)
- **CERBERUS** (moyen) — fichier `.env` exposé → réutilisation de mot de passe → cron job world-writable
- **OBSIDIAN** (difficile) — backup exposée avec creds → binaire SUID `find` mal configuré
- **PHANTOM** (difficile) — LFI via `?page=` → injection SQL (bypass de login) → sudo GTFOBins (`awk`)
- **MERIDIAN** (difficile) — LFI via `?file=` sur un export de rapport → sudo GTFOBins (`python3`)
- **GLACIER** (expert, **Windows**) — FTP anonyme → SSH (OpenSSH for Windows) → tâche planifiée SYSTEM
  avec script modifiable
- **STRATUS** (difficile) — bucket de stockage objet public (`cloudctl`) → fuite d'un `deploy.env` →
  SSH → sudo GTFOBins (`env`)
- **NEXUS** (difficile) — upload de webshell mal filtré (`curl -F` d'un `.php` déguisé) → reverse shell
  www-data → sudo GTFOBins (`tar --checkpoint`)
- **CITADEL** (expert) — **hôte interne** injoignable directement : pivot via NEXUS rooté (`ssh -L`) →
  SSH sur l'IP interne → sudo GTFOBins (`perl`)
- **TEMPEST** (difficile) — CI/CD avec un bucket de déploiement **inscriptible** (`cloudctl cp`) dont le
  contenu est exécuté par le pipeline (RCE) → shell `ci` → sudo GTFOBins (`nmap --interactive`)
- **AXIOM** (insane) — logs CI/CD exposés → SSH → appartenance au groupe `docker` (équivalent root via
  montage du disque hôte dans un conteneur)

💡 Chaque machine cache aussi un `note_interne.txt` dans le dossier personnel de l'utilisateur compromis
— un léger fil narratif transversal (aucun impact sur le gameplay, juste un easter egg à lire au fil
de la progression).

## Progression, badges & niveau

En plus du score, chaque machine terminée peut débloquer des **badges** (🎯 sans indice, ⚡ speedrun
&lt;5 min, 🏆 perfectionniste, 🌐 tour complet), visibles dans la sidebar ou via la commande `badges`.
Le score se traduit aussi en **niveau/XP** (barre dans l'en-tête, 500 pts par niveau). Chaque flag root
capturé affiche une petite **fiche CVE/CVSS pédagogique** générée localement, décrivant la technique de
privesc utilisée. La commande `records` affiche tes **meilleurs temps locaux** par catégorie (Any%,
Sans indice, Premier essai sudo), et `writeup <machine> [--download]` génère un **compte-rendu Markdown**
de la machine terminée (à afficher dans le terminal ou à télécharger en `.md`). Un bouton ✨ dans l'en-tête
active/désactive les effets visuels (glow, scanlines, particules à la capture d'un flag) si tu préfères
une interface plus sobre.

## Mode Insane (sans indices)

La commande `insane on` désactive `hint`/`chint` pour toute la partie (machines et défis Jeopardy) en
échange d'un score multiplié par 1.5. Elle ne peut être activée (ou désactivée) que sur une sauvegarde
neuve — score à 0, aucune machine ni défi entamé — pour éviter toute incohérence de scoring en cours de
route. `insane` sans argument affiche l'état courant.

## Export / import de sauvegarde

`export <passphrase>` chiffre l'intégralité de la progression (score, machines, badges, défis
Jeopardy...) avec AES-GCM 256 (clé dérivée de la passphrase via PBKDF2-SHA256, 150 000 itérations,
API native `Web Crypto` — zéro dépendance) et télécharge un fichier `.json.enc`. La passphrase n'est
stockée nulle part : sans elle, le fichier est inutilisable. `import` ouvre un sélecteur de fichier,
puis demande la passphrase utilisée à l'export ; en cas de succès, la progression locale est
entièrement remplacée. Pratique pour transférer sa partie d'un navigateur ou d'un appareil à
l'autre sans backend.

## Mode Jeopardy

En plus des 12 machines en mode boîte, un mini mode Jeopardy propose 7 défis indépendants
(Crypto ×4, Forensics ×2, Misc ×1) : `challenges` pour la liste, `challenge <id>` pour l'énoncé,
`chint <id>` pour des indices progressifs, `submit <id> <flag>` pour valider. Les points s'ajoutent
au score global (donc au niveau/XP). Le défi "Mot de passe recyclé" s'appuie sur un vrai petit
casseur de hash simulé (`hashcat <hash>` / `hashcat --list`), avec un algorithme maison fictif
(hash-VX) — pédagogique, pas un vrai MD5/SHA. Le défi "RSA au rabais" fait factoriser un module
RSA volontairement minuscule pour retrouver la clé privée. Le défi "Photo de vacances suspecte"
cache un flag dans un faux champ de métadonnées EXIF (aucun vrai binaire image à parser). La
commande `daily` met en avant un défi différent chaque jour (seed = date du jour).

## Mode Blue Team

En complément de l'attaque, un mode **défense** façon SOC : 3 incidents où tu reçois un dump de
logs (auth.log brute-force SSH, access.log Nginx LFI/path-traversal, scan `sqlmap`) et dois répondre
à des questions d'analyse. `blueteam` liste les incidents, `incident <id>` affiche le scénario + les
logs + les questions, `answer <id> <question> <valeur>` soumet une réponse (tolérante à la casse et
aux espaces, plusieurs formulations acceptées), `bthint <id> <question>` donne un indice. Chaque
incident entièrement résolu rapporte des points ; les résoudre tous débloque le badge **🛡️ Analyste
SOC**. Tout est généré en dur (aucun IDS ni backend).

## Accessibilité & hors-ligne

Le bouton de thème (🌙/☀️/◐) propose désormais un 3ᵉ thème **contraste élevé**. Le terminal utilise
`role="log"` + `aria-live="polite"`, et les cartes de machines sont navigables au clavier (Tab + Entrée).
Le jeu est aussi installable comme **PWA** (manifest + service worker) pour être rejoué hors-ligne une
fois la première visite effectuée — toujours sans aucun backend.

Le bouton 🎧 dans l'en-tête active une **ambiance sonore procédurale continue** (oscillateurs Web Audio
API, zéro fichier audio) : le preset change automatiquement selon la difficulté de la machine sur
laquelle tu es connecté (plus grave et plus tendu à mesure que la difficulté monte). Désactivée par
défaut ; le son de capture de flag (bouton 🔈) est indépendant de ce toggle.

Le bouton 🗣️ active une **narration vocale** (API native `SpeechSynthesis`, zéro dépendance) : les
indices (`hint`/`chint`) et les messages importants (flag capturé, badge débloqué, machine débloquée)
sont lus à voix haute en français. Désactivée par défaut, et n'importe jamais les sorties brutes
(`ls`, `cat`, `nmap`...).

`vim <fichier>` (alias `vi`, `nano`) ouvre un mini-éditeur modal très simplifié : une fois
dedans, chaque ligne tapée est ajoutée au buffer plutôt qu'interprétée comme une commande.
`:wq` enregistre et quitte, `:q!` quitte sans rien sauver, `:show` réaffiche le buffer en
cours. Une alternative plus réaliste à `echo '...' >> fichier` pour les étapes de privesc
qui demandent d'éditer un script (ex : le cron piégeable de CERBERUS).

## Commandes principales

Recon : `nmap <ip>`, `curl <url>` (GET, ou POST avec `-d "champ=valeur"`), `ftp <ip>`, `nc <ip> <port>` (bannière brute), `nc -lvnp <port>` (écoute, pour attraper une reverse shell si une machine le propose), `cloudctl ls|get|cp` (stockage objet simulé)
Accès : `ssh user@ip [-p port]`, `curl -F "file=@<webshell>" <url>` (upload sur un formulaire mal filtré), `ssh -L <lport>:<hôte_interne>:<port> user@<pivot>` (tunnel de pivot vers un hôte interne, une fois le pivot rooté)
Système (Linux) : `ls [-la]`, `cd`, `pwd`, `cat`, `find`, `echo`, `vim <fichier>` (alias `vi`/`nano`), `whoami`, `id`, `groups`, `sudo -l`, `sudo <cmd>`, `crontab -l`, `docker ps`
Système (Windows, sur une machine cible Windows) : `dir`, `type`, `net user`, `net localgroup administrators`,
`schtasks /query`, `icacls <fichier>` (les alias `ls`/`cat` fonctionnent aussi, comme dans PowerShell)
Pipes : `grep`, `wc -l`, `sort [-u]`, `head`, `tail`, `cut`, `awk '{print $N}'`
Méta : `machines`, `use <nom>`, `reset <nom>`, `hint`, `insane [on|off]`, `progress`, `badges`, `records`, `writeup <nom> [--download]`, `export <passphrase>`, `import`, `score`, `help`, `clear`, `exit`
Jeopardy : `challenges`, `challenge <id>`, `chint <id>`, `submit <id> <flag>`, `hashcat <hash>`, `daily`

## Shell (parser)

Le terminal dispose d'un vrai petit parser (dans `js/engine.js`) : guillemets simples/doubles
imbriqués et concaténés, **variables** intégrées `$USER`, `$HOME`, `$PWD`, `$HOSTNAME`, `$UID`,
`$?` (et la forme `${VAR}`) développées hors guillemets simples, **substitution de commande**
`$(...)`, et **redirections** `>`, `>>`, `2>`, `&>`, `2>&1`, `2>/dev/null`. Exemples :
`echo "connecté en tant que $USER"`, `cat $(echo user.txt)`, `find / -perm -4000 2>/dev/null`.

Deux choix assumés : les backslash restent **littéraux** (pas d'échappement bash) pour que les
chemins Windows des machines cibles (`C:\Scripts\backup.bat`) fonctionnent, et les variables sont
en **lecture seule** (`export` est déjà la commande de sauvegarde chiffrée, pas une assignation).

## Éditeur de machines intégré

Le bouton 🛠️ de l'en-tête (ou le lien direct `index.html#editor`) ouvre une modale **« Créer une
machine »** : un textarea JSON pré-rempli d'un modèle valide, un bouton **« Valider & charger »**
et un bouton **« Télécharger .json »**. Le moteur (`loadCustomMachine`) compile les regex d'exploit
(écrites en chaînes, ou sous la forme `{ "__regex__": ..., "__flags__": ... }` de `machines.json`),
valide le schéma via `validateMachines`, refuse toute collision d'id/ip, puis injecte la machine
dans le lab — **déverrouillée et immédiatement jouable** dans le terminal (recon → accès → privesc
→ flags). Elle est marquée `custom` : exclue des badges « tour complet »/« perfectionniste » et
**non sauvegardée** (bac à sable, elle disparaît au rechargement). Le `.json` téléchargé se colle
tel quel dans `MACHINES` (`js/machines.js`) pour la rendre permanente.

Le bouton **« Lien de partage »** encode la machine en base64url dans un lien
`index.html#machine=<token>` (copié dans le presse-papiers) : ouvrir ce lien décode, valide et
charge automatiquement la machine — un scénario se partage donc en une URL, sans aucun serveur.

La commande **`generate [seed]`** (ou le bouton **🎲 Générer** de l'éditeur) produit une machine
**procédurale** jouable : un algorithme JS pur (PRNG seedé, zéro IA) combine une brique de vecteur
d'accès (FTP / config web / bucket cloud) et une brique de privesc (sudo GTFOBins) tirées de pools.
Le seed est déterministe (même seed → même machine), donc une machine générée se rejoue ou se
partage à l'identique.

## Bac à sable libre

La commande **`sandbox`** (ou le bouton **🧪**) monte une session `hacker@sandbox` avec un système
de fichiers **à toi**, **sans machine, sans flag ni score** : juste pour s'entraîner aux commandes
(`ls`, `cd`, `cat`, `find`, `grep`, `cut`, `awk`, `wc`, `vim`, pipes…). `sandbox` seul charge un FS
de démo ; la modale 🧪 permet de coller son propre FS au format `{ "chemin": "contenu" }` (une chaîne
= fichier, `{}` ou un `/` final = dossier ; chemins relatifs à `~` sauf s'ils commencent par `/`).
`sandbox reset` (ou `exit`) revient sur la machine kali.

## Replay de session

Chaque commande et sa sortie sont enregistrées en mémoire. Le bouton **▶️** de l'en-tête (ou la
commande **`replay`**) ouvre un overlay qui **rejoue** ta session façon asciinema (frappe animée +
sorties), **sans ré-exécuter** les commandes — ta progression n'est donc pas modifiée. `replay save`
(ou le bouton **« Télécharger .json »**) exporte le replay ; **« Charger un replay »** en rejoue un
importé. `replay clear` remet le compteur à zéro. Zéro dépendance, 100% côté client.

## Ajouter une machine

Ajoute un objet dans `MACHINES` (`js/machines.js`) avec le même schéma que les machines
existantes (ports, web, ftp, sshUsers, targetFS, privesc, rootFile, hints). Le moteur
(`engine.js`) n'a rien à changer tant que le type de privesc reste `sudo-gtfobins`,
`sudo-direct`, `cron-writable`, `suid-binary`, `schtask-writable` ou `docker-group`.

Pour une machine web vulnérable à une LFI/SQLi (comme PHANTOM), pas de code moteur à toucher :
- LFI : ajoute directement la clé `chemin?param=valeur` dans `machine.web`, `curl` la sert telle quelle.
- SQLi : ajoute un objet `machine.sqli = { path, injectionRegex, successBody, failBody }`,
  déclenché par `curl -d "champ=valeur" <url>`.
- Reverse shell / injection de commande (comme MERIDIAN et PHANTOM) : ajoute
  `machine.altAccess = { path, injectRegex, user }`. `path` est l'endpoint vulnérable (sans
  query), `injectRegex` reconnaît une injection de commande dans la query (ex :
  `/file=[^;&]*;\s*nc\b/i`), `user` est le compte obtenu. Le moteur parse l'IP/port du callback
  directement depuis le payload `nc <ip> <port>` du joueur : l'accès n'est accordé que si l'IP
  vaut `ATTACKER_IP` **et** que le port correspond à l'écoute lancée avec `nc -lvnp <port>`. Le
  joueur choisit donc librement son port — aucune valeur n'est câblée en dur côté machine.
- Upload de webshell (comme NEXUS) : ajoute `machine.upload = { formPath, filenameRegex, webshellPath, user }`
  (le `curl -F` accepte un fichier dont le nom matche `filenameRegex`), puis un `machine.altAccess`
  pointant sur `webshellPath` avec `requiresUpload: true` (le webshell renvoie 404 tant qu'on n'a pas uploadé).
- Cloud mal configuré (comme STRATUS) : ajoute `machine.cloud = { provider, buckets: { "<nom>": { public, files } } }`.
  La commande `cloudctl` liste/lit les buckets `public` et refuse les privés — aucun code moteur à toucher.
- Machine interne / pivot (comme CITADEL) : mets `internal: true` et `pivot: { via, pivotIp }`. Le moteur
  rend l'IP injoignable (`nmap`/`ssh`/`curl`) tant qu'un tunnel `ssh -L <lport>:<ip_interne>:<port> user@<pivotIp>`
  n'a pas été ouvert — et ce tunnel exige que la machine pivot (`pivotIp`) soit déjà rootée.

Pour une machine Windows (comme GLACIER), ajoute `osType: "windows"` sur l'objet machine :
le FS interne reste en chemins unix (`/Users/xxx`), `resolvePath` traduit automatiquement les
chemins `C:\...` saisis par le joueur, et l'affichage (`prompt`, `dir`, `pwd`, `whoami`) bascule
tout seul en style Windows.

## Tests

`node tests/run.js` lance une suite de tests zéro-dépendance (Node uniquement, pas de framework)
qui charge `machines.js` + `engine.js` dans un contexte isolé et rejoue : le parsing/les pipes,
l'exploitation complète des 12 machines (recon → accès → privesc → 2 flags chacune), le
remboursement de `reset`, la résolution des 6 défis Jeopardy et le mode Insane. À lancer après
toute modification de `engine.js` ou `machines.js` pour éviter une régression silencieuse.

`node tools/solve.js` est un **solveur automatique** (dev only, jamais embarqué dans le jeu) :
il rejoue la solution officielle des 12 machines dans le vrai moteur et vérifie qu'aucun chemin
d'exploit n'est cassé (les 5 jalons + le flag root de chaque machine). Code de sortie non-nul
en cas de régression, donc utilisable en CI. Options : `--verbose` (chaque commande + sa sortie),
`--walkthrough` (pas-à-pas propre), `--machine <id>` (une seule machine). Utile comme smoke test
rapide et comme générateur de walkthrough après une modification du moteur.

`node tools/export-machines-json.js` sérialise les données des machines en **JSON pur**
(`machines.json` à la racine), en encodant les RegExp des exploits sous forme balisée
`{ "__regex__": ..., "__flags__": ... }` reconstructible au chargement. Le jeu, lui, continue de
charger le littéral JS `js/machines.js` (indispensable pour l'ouverture en `file://` sans serveur).
`--check` échoue si `machines.json` a dérivé de `machines.js` (garde de synchronisation pour la CI).

