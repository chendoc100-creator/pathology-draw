# 2026-10-24: 35/40/69 follow the physical tray; handout PA number shown in brackets. Applied to the live list (keeps admin edits).
set -e
node scripts/data.mjs get content/slides out/slides-before.json
node scripts/swap-physical.mjs out/slides-before.json out/slides-put.json
node scripts/data.mjs put content/slides out/slides-put.json
node scripts/data.mjs get content/slides out/slides.json
node -e "const s=require('./out/slides.json').list;for(const i of ['PA0328','PA0329','PA0280','PA0310','PA0284']){const d=s.find(x=>x.id===i);console.log(i,d.n||'-',d.parent||'',d.warn||'')}"
