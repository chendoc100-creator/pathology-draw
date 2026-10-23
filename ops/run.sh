# 2026-10-23: this semester's categories (97 slides + online look-alikes) and the full slide catalog
set -e
node scripts/data.mjs get content/slides out/slides-before.json
node -e "const fs=require('fs');fs.writeFileSync('out/slides-put.json',JSON.stringify({list:JSON.parse(fs.readFileSync('seed/slides.json','utf8')),at:Date.now()}))"
node -e "const fs=require('fs');fs.writeFileSync('out/catalog-put.json',fs.readFileSync('seed/catalog.json','utf8'))"
node scripts/data.mjs put content/slides out/slides-put.json
node scripts/data.mjs put content/catalog out/catalog-put.json
node scripts/data.mjs get content/slides out/slides.json
node scripts/data.mjs get content/catalog out/catalog.json
node -e "const s=require('./out/slides.json'),c=require('./out/catalog.json');console.log('slides',s.list.length,'catalog',c.list.length)"
