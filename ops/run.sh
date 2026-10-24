# 2026-10-24: Micro 1/2/3 unit groups
set -e
node scripts/data.mjs merge content/meta seed/meta.json
node scripts/data.mjs get content/meta out/meta.json
cat out/meta.json
