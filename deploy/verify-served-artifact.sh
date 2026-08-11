#!/bin/sh
# Ridgeline — assert that a RUNNING deployment serves an artifact that can work.
#
# Why this exists
# ---------------
# Every gate in this repository, before this one, inspected the source tree.
# The two worst production defects to date were invisible to all of them
# because they lived in the built image, not in the source:
#
#   1. `apps/web/Dockerfile` declared `ARG VITE_DEM_TEMPLATE=""`, so the
#      variable was defined-and-EMPTY in every image. Vite inlined `""`, every
#      DEM tile URL resolved to `""`, and every terrain layer — hillshade,
#      slope, aspect, landform, bedding, corridors — rendered blank in every
#      container ever deployed. Nothing threw. 330 web tests passed, against a
#      code path production never takes.
#
#   2. `index.html` was served with no `Cache-Control`, so browsers applied
#      heuristic freshness and kept serving the old shell, which references
#      the previous `/assets/` hashes that are cached `immutable` for a year.
#      A correctly built, correctly published release was invisible.
#
# Both are properties of the SERVED BYTES. So this script asserts against the
# served bytes, over HTTP, against whatever is actually running — a container,
# a compose stack, a `kubectl port-forward`, or the public ingress URL.
#
# Usage
# -----
#   deploy/verify-served-artifact.sh http://localhost:8080
#   deploy/verify-served-artifact.sh https://ridgeline.example.com
#   deploy/verify-served-artifact.sh http://localhost:8080 \
#       --dem-template='https://your-host/dem/{z}/{x}/{y}.png'
#
# Exits 0 when every assertion holds, non-zero otherwise, and prints every
# failure rather than stopping at the first — an operator running this after
# an upgrade wants the whole picture in one pass.
#
# What this can and cannot prove
# ------------------------------
# It proves the shipped bundle CONTAINS a usable DEM tile template and that the
# cache headers are the ones the deploy depends on. It does not execute the
# bundle, so it cannot prove the app *chooses* that template at runtime; that
# needs a browser and lives in the web app's Playwright suite. Necessary, not
# sufficient — and it is exactly the necessary condition both P0s violated.

set -u

BASE=''
# The documented fallback in apps/web/src/lib/map/demSource.ts. An image built
# with no build args must contain this; an image built with
# --build-arg VITE_DEM_TEMPLATE=... must contain that instead, so pass it.
EXPECT_DEM='https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

for arg in "$@"; do
  case "$arg" in
    --dem-template=*) EXPECT_DEM="${arg#--dem-template=}" ;;
    -h | --help)
      sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
    *) BASE="$arg" ;;
  esac
done

if [ -z "$BASE" ]; then
  echo "usage: $0 <base-url> [--dem-template='https://…/{z}/{x}/{y}.png']" >&2
  exit 2
fi
BASE="${BASE%/}"

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 2; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

FAILURES=0
pass() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

# fetch <url> <body-file> <header-file> -> prints the HTTP status code
fetch() {
  curl -sS --max-time 30 -o "$2" -D "$3" -w '%{http_code}' "$1" 2>"$WORK/curl.err" || echo '000'
}

# header <name> <header-file> -> every value of that header, joined by ' | '.
# Joined rather than "the" value on purpose: nginx emits two Cache-Control
# headers here (one from `expires`, one from `add_header`), and a check that
# reads only the first would pass or fail on ordering.
header() {
  tr -d '\r' <"$2" | awk -v want="$1" '
    { line = $0
      p = index(line, ":")
      if (p > 0) {
        k = tolower(substr(line, 1, p - 1))
        if (k == tolower(want)) {
          v = substr(line, p + 1)
          sub(/^[ \t]+/, "", v)
          out = (out == "" ? v : out " | " v)
        }
      }
    }
    END { print out }
  '
}

contains() { case "$2" in *"$1"*) return 0 ;; *) return 1 ;; esac; }

echo "Verifying the artifact served at $BASE"
echo

# ---------------------------------------------------------------------------
# 1. index.html — the file that makes a release visible at all
# ---------------------------------------------------------------------------
echo "index.html"
code=$(fetch "$BASE/index.html" "$WORK/index.html" "$WORK/index.h")
if [ "$code" != "200" ]; then
  fail "GET /index.html returned $code (curl: $(cat "$WORK/curl.err" 2>/dev/null))"
  echo
  echo "Nothing else can be checked without the entry document."
  exit 1
fi
pass "GET /index.html -> 200"

cc=$(header Cache-Control "$WORK/index.h")
if [ -z "$cc" ]; then
  fail "index.html has NO Cache-Control header. Browsers then apply heuristic freshness (~10% of the file's age) and keep serving the old shell, which references /assets/ hashes cached immutable for a year — the release is invisible to anyone who has loaded the site before."
elif contains 'no-cache' "$cc" || contains 'no-store' "$cc" || contains 'max-age=0' "$cc"; then
  pass "index.html revalidates: Cache-Control: $cc"
else
  fail "index.html Cache-Control is '$cc' — it must include no-cache (or no-store). Without revalidation the previous shell keeps being served from cache and the deploy is invisible."
fi

# ---------------------------------------------------------------------------
# 2. Discover the assets the served index actually points at
# ---------------------------------------------------------------------------
# From index.html, plus the service worker's precache manifest — the worker
# chunk that runs the terrain engine offline is referenced only from there, and
# the offline path is the product.
#
# Match with and without the leading slash and normalise: index.html writes
# `/assets/…` while the service worker's precache manifest writes `assets/…`,
# and the terrain worker chunk — the module that runs the whole analysis engine
# offline — is referenced ONLY from the precache manifest. Matching one form
# silently drops it, and the offline path is the product.
: >"$WORK/assets.raw"
grep -oE 'assets/[A-Za-z0-9._@-]+\.(js|css)' "$WORK/index.html" >>"$WORK/assets.raw" 2>/dev/null || true

sw_code=$(fetch "$BASE/sw.js" "$WORK/sw.js" "$WORK/sw.h")
if [ "$sw_code" = "200" ]; then
  grep -oE 'assets/[A-Za-z0-9._@-]+\.(js|css)' "$WORK/sw.js" >>"$WORK/assets.raw" 2>/dev/null || true
fi
sed 's|^|/|' "$WORK/assets.raw" >"$WORK/assets.txt"

sort -u "$WORK/assets.txt" >"$WORK/assets.uniq" && mv "$WORK/assets.uniq" "$WORK/assets.txt"
asset_count=$(grep -c . "$WORK/assets.txt" || true)
echo
echo "assets ($asset_count referenced)"
if [ "$asset_count" -eq 0 ]; then
  fail "the served index.html references no hashed /assets/ bundle at all — this is not a built Ridgeline artifact"
fi

: >"$WORK/all.js"
js_count=0
while IFS= read -r asset; do
  [ -n "$asset" ] || continue
  acode=$(fetch "$BASE$asset" "$WORK/asset.bin" "$WORK/asset.h")
  if [ "$acode" != "200" ]; then
    fail "GET $asset returned $acode"
    continue
  fi

  # A missing asset does NOT 404 here: nginx's SPA fallback (`try_files $uri
  # $uri/ /index.html`) answers 200 with the HTML shell. A status check alone
  # would pass on a bundle that is not present at all, so check the type.
  ctype=$(header Content-Type "$WORK/asset.h")
  case "$asset" in
    *.js)
      if contains 'text/html' "$ctype"; then
        fail "$asset was served as $ctype — that is the SPA fallback, i.e. the bundle is MISSING from the image and nginx answered with index.html"
        continue
      fi
      cat "$WORK/asset.bin" >>"$WORK/all.js"
      js_count=$((js_count + 1))
      ;;
  esac

  acc=$(header Cache-Control "$WORK/asset.h")
  if contains 'immutable' "$acc"; then
    :
  else
    fail "$asset Cache-Control is '${acc:-<none>}' — hashed assets must be immutable, or every navigation re-downloads the bundle over a hunting-camp connection"
  fi
done <"$WORK/assets.txt"

[ "$asset_count" -gt 0 ] && pass "all $asset_count hashed assets served with Cache-Control: immutable, none falling back to the HTML shell"

# ---------------------------------------------------------------------------
# 3. The DEM template — the P0 itself
# ---------------------------------------------------------------------------
echo
echo "DEM tile template"
missing=''
for ph in '{z}' '{x}' '{y}'; do
  contains "$ph" "$EXPECT_DEM" || missing="$missing $ph"
done
if [ -n "$missing" ]; then
  fail "the expected template '$EXPECT_DEM' cannot address a tile — missing$missing. Check the --dem-template argument."
elif [ "$js_count" -eq 0 ]; then
  fail "no JavaScript was served, so the DEM template could not be checked"
elif grep -qF "$EXPECT_DEM" "$WORK/all.js"; then
  pass "served JavaScript embeds $EXPECT_DEM"
else
  fail "the served JavaScript does NOT contain the expected DEM tile template '$EXPECT_DEM'. Every elevation-derived layer will render blank, silently — no error, just a map with no terrain on it."
  echo "        tile-shaped templates that ARE present in the served bundle:" >&2
  found=$(grep -ohE 'https?://[^"'"'"'`]{0,240}' "$WORK/all.js" | grep -F '{z}' | sort -u | head -10)
  if [ -n "$found" ]; then
    echo "$found" | sed 's/^/          /' >&2
    echo "        (an imagery or topo template is NOT a DEM source — only the DEM template feeds terrain analysis)" >&2
  else
    echo "          none — the bundle contains no tile template whatsoever, which is the signature of an empty VITE_DEM_TEMPLATE being inlined at build time" >&2
  fi
fi

# ---------------------------------------------------------------------------
# 4. The unhashed PWA files must never be cached
# ---------------------------------------------------------------------------
echo
echo "service worker"
if [ "$sw_code" != "200" ]; then
  fail "GET /sw.js returned $sw_code — the PWA has no service worker, so there is no offline mode at all"
else
  swcc=$(header Cache-Control "$WORK/sw.h")
  if contains 'no-store' "$swcc"; then
    pass "/sw.js is no-store"
  else
    fail "/sw.js Cache-Control is '${swcc:-<none>}' — it must include no-store, or a client stays pinned to a stale shell and their offline app is last week's build"
  fi
fi

for extra in /registerSW.js /manifest.webmanifest; do
  ecode=$(fetch "$BASE$extra" "$WORK/extra.bin" "$WORK/extra.h")
  [ "$ecode" = "200" ] || continue
  ecc=$(header Cache-Control "$WORK/extra.h")
  if contains 'no-store' "$ecc" || contains 'no-cache' "$ecc"; then
    pass "$extra revalidates"
  else
    fail "$extra Cache-Control is '${ecc:-<none>}' — it is unhashed and fetched by URL, so a cached copy can pin clients to a service worker generation that no longer exists"
  fi
done

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "PASS — the artifact served at $BASE can render terrain and a new release will be seen."
  exit 0
fi
echo "FAIL — $FAILURES assertion(s) failed against $BASE" >&2
exit 1
