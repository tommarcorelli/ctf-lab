#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Capture d'écran headless du CTF Lab — pour revue visuelle.
#
#   tools/shot.sh            # accueil + menu ouvert
#   tools/shot.sh accueil    # une seule vue
#
# Montre la VRAIE page : barres de défilement VISIBLES (pas masquées), et l'intro
# "boot" sautée (via reduced-motion) pour voir l'accueil réel. Sorties dans .shots/.
# Nécessite Google Chrome.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
[ -x "$CHROME" ] || CHROME="/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
[ -x "$CHROME" ] || { echo "Chrome introuvable — édite le chemin en tête de shot.sh"; exit 1; }

# Chemin ABSOLU façon Windows (D:/...) : Chrome résout --screenshot par rapport
# à SON répertoire, un chemin relatif échoue donc silencieusement.
cd "$(dirname "$0")/.."
ROOT="$(pwd -W 2>/dev/null || pwd)"
OUT="${SHOT_DIR:-$ROOT/.shots}"
mkdir -p "$OUT"

URL="file:///$(printf '%s' "$ROOT/index.html" | sed 's/ /%20/g')"
W="${W:-1440}"; H="${H:-1000}"; VT="${VT:-2600}"

shot() { # $1 = nom  $2 = hash
  local png="$OUT/$1.png"
  "$CHROME" --headless=new --disable-gpu --force-prefers-reduced-motion \
    --window-size="${W},${H}" --virtual-time-budget="$VT" \
    --screenshot="$png" "${URL}${2:-}" >/dev/null 2>&1 || true
  if [ -f "$png" ]; then echo "  ok $png"; else echo "  ECHEC: $1"; fi
}

echo "Captures ($W x $H) → $OUT"
if [ "$#" -ge 1 ]; then
  shot "$1" "${2:-}"
else
  shot accueil ""
  shot menu "#open=settings"
fi
