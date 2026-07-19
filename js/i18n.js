// i18n.js — internationalisation de l'interface (FR/EN), zéro dépendance.
// Chargé AVANT machines.js/engine.js pour exposer `LANG` au moteur (aide bilingue).
// Portée : chrome de l'UI (en-tête, info-bulles, modales, bannière) + commande `help`.
// Les sorties de commandes et le contenu narratif des machines restent en français
// (choix assumé : leur traduction complète doublerait la charge de maintenance du contenu).

const UI_STRINGS = {
  fr: {
    "app.subtitle": "Recon → Accès initial → Élévation de privilèges → Flag",
    "tip.theme": "Changer de thème", "tip.sound": "Son à la capture d'un flag",
    "tip.ambient": "Ambiance sonore continue (générée, varie selon la difficulté)",
    "tip.voice": "Narration vocale des indices et messages importants",
    "tip.fx": "Effets visuels (particules, glow)", "tip.editor": "Créer une machine (éditeur)",
    "tip.replay": "Rejouer la session (replay)", "tip.sandbox": "Bac à sable libre (FS custom)",
    "tip.graph": "Graphe d'attaque", "tip.stack": "Défi buffer overflow (pile)",
    "tip.split": "Panneau journal (split façon tmux)", "tip.lang": "Language / Langue (FR ⇄ EN)",
    "sidebar.machines": "Machines", "sidebar.stepOn": "étape validée", "sidebar.stepOff": "étape restante",
    "sidebar.badges": "Badges",
    "editor.title": "🛠️ Créer une machine",
    "editor.desc": "Décris une machine en JSON (même schéma que <code>machines.js</code>, regex d'exploit en chaînes). « Valider &amp; charger » la teste dans le vrai moteur et l'ajoute à la liste (bac à sable, non sauvegardée). « Télécharger .json » l'exporte pour l'intégrer à <code>machines.js</code>.",
    "editor.load": "Valider & charger", "editor.generate": "🎲 Générer", "editor.share": "Lien de partage",
    "editor.download": "Télécharger .json", "editor.reset": "Modèle par défaut",
    "replay.title": "▶️ Replay de session",
    "replay.desc": "Rejoue tes commandes et leurs sorties façon asciinema — <strong>sans les ré-exécuter</strong>, donc ta progression n'est pas touchée. Exporte le replay en <code>.json</code> pour le rejouer plus tard ou le partager.",
    "replay.play": "Rejouer", "replay.download": "Télécharger .json", "replay.open": "Charger un replay", "replay.ghost": "👻 Charger un fantôme",
    "sandbox.title": "🧪 Bac à sable libre",
    "sandbox.desc": "Monte un système de fichiers à toi pour t'entraîner aux commandes (<code>ls</code>, <code>cat</code>, <code>find</code>, <code>grep</code>, <code>vim</code>, pipes…), <strong>sans flag ni score</strong>. Format : un objet <code>{ \"chemin\": \"contenu\" }</code> (une chaîne = fichier, <code>{}</code> ou un <code>/</code> final = dossier ; chemins relatifs à <code>~</code> sauf s'ils commencent par <code>/</code>).",
    "sandbox.mount": "Monter le FS", "sandbox.demo": "FS de démo",
    "graph.title": "🗺️ Graphe d'attaque", "graph.machine": "Machine :",
    "graph.desc": "Les nœuds s'allument à mesure que tu progresses : recon → accès initial → élévation de privilèges → flags.",
    "stack.title": "🧠 Buffer overflow (pédagogique)",
    "stack.desc": "Une fonction lit une entrée dans <code>char buf[16]</code> sans vérifier la taille. La pile contient ensuite le <strong>RBP sauvé</strong> (8 o) puis l'<strong>adresse de retour</strong> (8 o, offset 24). Fais déborder le buffer pour écraser l'adresse de retour avec l'adresse de <code>win()</code> = <code>0x401156</code>. <strong>Aucun code n'est réellement exécuté</strong> — c'est un schéma pédagogique.",
    "stack.fill": "Octets de bourrage :", "stack.addr": "Adresse de retour :", "stack.inject": "Injecter",
    "journal.title": "📜 Journal",
    "banner.help": "Tape `help` pour la liste des commandes, `machines` pour voir les cibles.",
    "banner.subtitle": "Recon -> Accès initial -> Privesc -> Flag",
  },
  en: {
    "app.subtitle": "Recon → Initial access → Privilege escalation → Flag",
    "tip.theme": "Switch theme", "tip.sound": "Sound on flag capture",
    "tip.ambient": "Continuous generated ambience (varies with difficulty)",
    "tip.voice": "Voice narration of hints and key messages",
    "tip.fx": "Visual effects (particles, glow)", "tip.editor": "Create a machine (editor)",
    "tip.replay": "Replay the session", "tip.sandbox": "Free sandbox (custom FS)",
    "tip.graph": "Attack graph", "tip.stack": "Buffer overflow challenge (stack)",
    "tip.split": "Journal panel (tmux-style split)", "tip.lang": "Language / Langue (FR ⇄ EN)",
    "sidebar.machines": "Machines", "sidebar.stepOn": "step done", "sidebar.stepOff": "step remaining",
    "sidebar.badges": "Badges",
    "editor.title": "🛠️ Create a machine",
    "editor.desc": "Describe a machine in JSON (same schema as <code>machines.js</code>, exploit regexes as strings). “Validate &amp; load” tests it in the real engine and adds it to the list (sandbox, not saved). “Download .json” exports it to drop into <code>machines.js</code>.",
    "editor.load": "Validate & load", "editor.generate": "🎲 Generate", "editor.share": "Share link",
    "editor.download": "Download .json", "editor.reset": "Default template",
    "replay.title": "▶️ Session replay",
    "replay.desc": "Replays your commands and their output asciinema-style — <strong>without re-running them</strong>, so your progress isn't affected. Export the replay as <code>.json</code> to replay it later or share it.",
    "replay.play": "Replay", "replay.download": "Download .json", "replay.open": "Load a replay", "replay.ghost": "👻 Load a ghost",
    "sandbox.title": "🧪 Free sandbox",
    "sandbox.desc": "Mount your own filesystem to practise commands (<code>ls</code>, <code>cat</code>, <code>find</code>, <code>grep</code>, <code>vim</code>, pipes…), <strong>with no flag or score</strong>. Format: an object <code>{ \"path\": \"content\" }</code> (a string = file, <code>{}</code> or a trailing <code>/</code> = directory; paths are relative to <code>~</code> unless they start with <code>/</code>).",
    "sandbox.mount": "Mount FS", "sandbox.demo": "Demo FS",
    "graph.title": "🗺️ Attack graph", "graph.machine": "Machine:",
    "graph.desc": "Nodes light up as you progress: recon → initial access → privilege escalation → flags.",
    "stack.title": "🧠 Buffer overflow (educational)",
    "stack.desc": "A function reads input into <code>char buf[16]</code> without checking the size. The stack then holds the <strong>saved RBP</strong> (8 B) and the <strong>return address</strong> (8 B, offset 24). Overflow the buffer to overwrite the return address with the address of <code>win()</code> = <code>0x401156</code>. <strong>No real code is executed</strong> — it's an educational diagram.",
    "stack.fill": "Padding bytes:", "stack.addr": "Return address:", "stack.inject": "Inject",
    "journal.title": "📜 Journal",
    "banner.help": "Type `help` for the command list, `machines` to see the targets.",
    "banner.subtitle": "Recon -> Initial access -> Privesc -> Flag",
  },
};
let LANG = (function () { try { return localStorage.getItem("ctf_lab_lang") === "en" ? "en" : "fr"; } catch (e) { return "fr"; } })();
function t(key) { const d = UI_STRINGS[LANG] || UI_STRINGS.fr; return d[key] !== undefined ? d[key] : (UI_STRINGS.fr[key] !== undefined ? UI_STRINGS.fr[key] : key); }
function applyI18n(root) {
  const r = root || document;
  r.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.getAttribute("data-i18n")); });
  r.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.getAttribute("data-i18n-html")); });
  r.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.getAttribute("data-i18n-title")); });
  document.documentElement.lang = LANG;
}
function setLang(lang) {
  LANG = lang === "en" ? "en" : "fr";
  try { localStorage.setItem("ctf_lab_lang", LANG); } catch (e) {}
  applyI18n();
  const btn = document.getElementById("lang-toggle");
  if (btn) btn.textContent = LANG === "fr" ? "FR" : "EN";
}
function toggleLang() { setLang(LANG === "fr" ? "en" : "fr"); }
