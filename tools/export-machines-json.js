#!/usr/bin/env node
// tools/export-machines-json.js — Extraction déclarative des machines en JSON pur (dev only).
//
// Le runtime charge toujours `js/machines.js` (littéral JS) — c'est ce qui permet d'ouvrir
// `index.html` directement en file:// sans serveur (un fetch de .json y échouerait). Mais on
// veut prouver/garantir que les données des machines sont 100% sérialisables en JSON pur : cet
// outil sérialise l'objet MACHINES en `machines.json`, en encodant les seules valeurs non-JSON
// (les RegExp des exploits) sous une forme balisée { "__regex__": source, "__flags__": flags }
// reconstructible au chargement.
//
// Usage :
//   node tools/export-machines-json.js          # (ré)génère machines.json à la racine
//   node tools/export-machines-json.js --check   # vérifie que machines.json est à jour (CI)
//
// Round-trip garanti : le JSON produit, une fois re-parsé et ses regex reconstruites, se
// re-sérialise à l'identique. Code de sortie non-nul si le round-trip échoue, ou si --check
// détecte une dérive entre machines.js et machines.json committé.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const OUT = path.join(__dirname, "..", "machines.json");
const check = process.argv.includes("--check");

// Réplicateur commun (réalm-agnostique) : encode les RegExp, laisse le reste tel quel.
function regexReplacer(key, value) {
  if (Object.prototype.toString.call(value) === "[object RegExp]") {
    return { __regex__: value.source, __flags__: value.flags };
  }
  return value;
}
function reviveRegex(key, value) {
  if (value && typeof value === "object" && typeof value.__regex__ === "string") {
    return new RegExp(value.__regex__, value.__flags__ || "");
  }
  return value;
}

// Charge MACHINES depuis le vrai fichier (dans un contexte isolé) et sérialise DANS ce
// contexte, pour que les RegExp soient bien détectées quel que soit leur realm.
const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "machines.js"), "utf8"), context, { filename: "machines.js" });
context.__replacer = regexReplacer;
const json = vm.runInContext("JSON.stringify(MACHINES, __replacer, 2)", context) + "\n";

// Round-trip : reparse, reconstruit les regex, re-sérialise -> doit être identique.
const revived = JSON.parse(json, reviveRegex);
const roundtrip = JSON.stringify(revived, regexReplacer, 2) + "\n";
if (roundtrip !== json) {
  console.error("❌ Round-trip JSON incohérent : la re-sérialisation diffère de l'originale.");
  process.exit(1);
}

const count = revived.length;
const regexCount = (json.match(/"__regex__"/g) || []).length;

if (check) {
  if (!fs.existsSync(OUT)) {
    console.error(`❌ ${path.basename(OUT)} est absent — lance \`node tools/export-machines-json.js\` pour le générer.`);
    process.exit(1);
  }
  const current = fs.readFileSync(OUT, "utf8");
  if (current !== json) {
    console.error(`❌ ${path.basename(OUT)} est désynchronisé de js/machines.js — régénère-le.`);
    process.exit(1);
  }
  console.log(`✅ ${path.basename(OUT)} à jour (${count} machines, ${regexCount} regex sérialisées, round-trip OK).`);
  process.exit(0);
}

fs.writeFileSync(OUT, json);
console.log(`✅ ${path.basename(OUT)} généré : ${count} machines, ${regexCount} regex encodées en { __regex__, __flags__ }, round-trip vérifié.`);
