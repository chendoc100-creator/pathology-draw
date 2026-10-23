# 2026-10-24: answer field points (Micro 1) found on the real slides; merge so points set in the admin UI for other slides stay
set -e
node scripts/data.mjs get content/fields out/fields-before.json
node scripts/data.mjs merge content/fields seed/fields.json
node scripts/data.mjs get content/fields out/fields.json
node -e "const f=require('./out/fields.json');console.log('fields slides',Object.keys(f).length,'points',Object.values(f).reduce((a,x)=>a+(x.pts||[]).length,0))"
