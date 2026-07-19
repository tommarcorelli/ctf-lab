# CTF Lab

Mini plateforme façon RootMe/HackTheBox : terminal simulé en vanilla JS (aucune dépendance), inspirée de la structure de LinuxDojo.

## Lancer le projet

Aucun build : ouvre simplement `index.html` dans un navigateur.

## Structure

```
index.html        Page + layout (sidebar machines + terminal)
css/style.css      Thème sombre / clair / contraste élevé, effets FX
js/machines.js     Données des 7 machines (fs, services, creds, exploits, indices)
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

En plus des 8 machines en mode boîte, un mini mode Jeopardy propose 7 défis indépendants
(Crypto ×4, Forensics ×2, Misc ×1) : `challenges` pour la liste, `challenge <id>` pour l'énoncé,
`chint <id>` pour des indices progressifs, `submit <id> <flag>` pour valider. Les points s'ajoutent
au score global (donc au niveau/XP). Le défi "Mot de passe recyclé" s'appuie sur un vrai petit
casseur de hash simulé (`hashcat <hash>` / `hashcat --list`), avec un algorithme maison fictif
(hash-VX) — pédagogique, pas un vrai MD5/SHA. Le défi "RSA au rabais" fait factoriser un module
RSA volontairement minuscule pour retrouver la clé privée. Le défi "Photo de vacances suspecte"
cache un flag dans un faux champ de métadonnées EXIF (aucun vrai binaire image à parser). La
commande `daily` met en avant un défi différent chaque jour (seed = date du jour).

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

Recon : `nmap <ip>`, `curl <url>` (GET, ou POST avec `-d "champ=valeur"`), `ftp <ip>`, `nc <ip> <port>` (bannière brute), `nc -lvnp <port>` (écoute, pour attraper une reverse shell si une machine le propose)
Accès : `ssh user@ip [-p port]`
Système (Linux) : `ls [-la]`, `cd`, `pwd`, `cat`, `find`, `echo`, `vim <fichier>` (alias `vi`/`nano`), `whoami`, `id`, `groups`, `sudo -l`, `sudo <cmd>`, `crontab -l`, `docker ps`
Système (Windows, sur une machine cible Windows) : `dir`, `type`, `net user`, `net localgroup administrators`,
`schtasks /query`, `icacls <fichier>` (les alias `ls`/`cat` fonctionnent aussi, comme dans PowerShell)
Pipes : `grep`, `wc -l`, `sort [-u]`, `head`, `tail`, `cut`, `awk '{print $N}'`
Méta : `machines`, `use <nom>`, `reset <nom>`, `hint`, `insane [on|off]`, `progress`, `badges`, `records`, `writeup <nom> [--download]`, `export <passphrase>`, `import`, `score`, `help`, `clear`, `exit`
Jeopardy : `challenges`, `challenge <id>`, `chint <id>`, `submit <id> <flag>`, `hashcat <hash>`, `daily`

## Ajouter une machine

Ajoute un objet dans `MACHINES` (`js/machines.js`) avec le même schéma que les machines
existantes (ports, web, ftp, sshUsers, targetFS, privesc, rootFile, hints). Le moteur
(`engine.js`) n'a rien à changer tant que le type de privesc reste `sudo-gtfobins`,
`sudo-direct`, `cron-writable`, `suid-binary`, `schtask-writable` ou `docker-group`.

Pour une machine web vulnérable à une LFI/SQLi (comme PHANTOM), pas de code moteur à toucher :
- LFI : ajoute directement la clé `chemin?param=valeur` dans `machine.web`, `curl` la sert telle quelle.
- SQLi : ajoute un objet `machine.sqli = { path, injectionRegex, successBody, failBody }`,
  déclenché par `curl -d "champ=valeur" <url>`.

Pour une machine Windows (comme GLACIER), ajoute `osType: "windows"` sur l'objet machine :
le FS interne reste en chemins unix (`/Users/xxx`), `resolvePath` traduit automatiquement les
chemins `C:\...` saisis par le joueur, et l'affichage (`prompt`, `dir`, `pwd`, `whoami`) bascule
tout seul en style Windows.

## Tests

`node tests/run.js` lance une suite de tests zéro-dépendance (Node uniquement, pas de framework)
qui charge `machines.js` + `engine.js` dans un contexte isolé et rejoue : le parsing/les pipes,
l'exploitation complète des 8 machines (recon → accès → privesc → 2 flags chacune), le
remboursement de `reset`, la résolution des 6 défis Jeopardy et le mode Insane. À lancer après
toute modification de `engine.js` ou `machines.js` pour éviter une régression silencieuse.

