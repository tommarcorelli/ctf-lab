/* ============================================================================
   CTF LAB — Couche UI néon (accueil + HUB)
   Purement visuel / navigation front. Ne touche pas au moteur (engine.js).
   ========================================================================== */
(function () {
  "use strict";

  // ── Catégories (classification front des machines existantes) ────────────
  var CAT_META = {
    web:    { label: "Web",    icon: "assets/icon-web.png" },
    crypto: { label: "Crypto", icon: "assets/icon-crypto.png" },
    pwn:    { label: "Pwn / Binary", icon: "assets/icon-pwn.png" },
  };
  var CAT_OF = {
    // Web : failles applicatives (IDOR, LFI, SQLi, upload/webshell)
    vortex: "web", phantom: "web", meridian: "web", nexus: "web",
    // Crypto & secrets : fuites d'identifiants / secrets / .env / backups
    nimbus: "crypto", cerberus: "crypto", stratus: "crypto", obsidian: "crypto",
    // Pwn / Binary : escalade système, SUID, tâches, docker, pivot
    glacier: "pwn", citadel: "pwn", tempest: "pwn", axiom: "pwn",
  };
  window.LAB_CAT = {};
  Object.keys(CAT_OF).forEach(function (id) {
    var c = CAT_OF[id];
    window.LAB_CAT[id] = { key: c, label: CAT_META[c].label, icon: CAT_META[c].icon };
  });

  window.LAB_pointsFor = function (diff) {
    return ({ Facile: 150, Moyen: 300, Difficile: 450, Expert: 600, Insane: 750 })[diff] || 200;
  };

  // ── État courant recherche / filtre ───────────────────────────────────────
  var curFilter = "all";
  var curSearch = "";

  window.applyHubFilters = function () {
    var cards = document.querySelectorAll("#machines-list .m-card");
    var shown = 0;
    cards.forEach(function (card) {
      var cat = card.dataset.category || "";
      var name = card.dataset.name || "";
      var okCat = curFilter === "all" || cat === curFilter;
      var okSearch = !curSearch || name.indexOf(curSearch) !== -1;
      var visible = okCat && okSearch;
      card.style.display = visible ? "" : "none";
      if (visible) shown++;
    });
    var empty = document.getElementById("hub-empty");
    if (empty) empty.style.display = shown === 0 ? "block" : "none";
  };

  window.updateHubProgress = function () {
    if (typeof MACHINES === "undefined" || typeof GAME === "undefined") return;
    var total = MACHINES.length;
    var done = MACHINES.filter(function (m) { return GAME.progress[m.id] && GAME.progress[m.id].rootFlag; }).length;
    var pct = total ? Math.round((done / total) * 100) : 0;
    var fill = document.getElementById("hub-progress-fill");
    var lbl = document.getElementById("hub-progress-label");
    if (fill) fill.style.width = pct + "%";
    if (lbl) lbl.innerHTML = "Progression : <b>" + done + "/" + total + "</b> machines rootées · " + pct + "%";
  };

  // ── Navigation Accueil ⇄ HUB (sous-états de la vue "home") ─────────────────
  function setHome(view) {
    document.body.dataset.home = view;
    document.querySelectorAll(".nav-link").forEach(function (a) {
      a.classList.toggle("active", a.dataset.home === view);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  window.LAB_setHome = setHome;

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.body.dataset.home) document.body.dataset.home = "accueil";
    // Accès direct par lien : #hub / #accueil
    if (location.hash === "#hub" || location.hash === "#accueil") setHome(location.hash.slice(1));

    document.querySelectorAll("[data-nav-home]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        setHome(el.getAttribute("data-nav-home"));
      });
    });

    // Retour depuis l'espace de travail → on revient sur le HUB
    var back = document.getElementById("back-home");
    if (back) back.addEventListener("click", function () { setHome("hub"); });

    // Recherche
    var search = document.getElementById("hub-search");
    if (search) search.addEventListener("input", function () {
      curSearch = search.value.trim().toLowerCase();
      window.applyHubFilters();
    });

    // Filtres catégorie
    document.querySelectorAll(".filter-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll(".filter-chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        curFilter = chip.dataset.cat;
        window.applyHubFilters();
      });
    });

    if (window.applyHubFilters) window.applyHubFilters();
    if (window.updateHubProgress) window.updateHubProgress();
  });
})();
