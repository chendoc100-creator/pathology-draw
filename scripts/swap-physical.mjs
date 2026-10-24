// 35 / 40 / 69: the physical tray decides the slide; the handout's PA number goes in brackets.
// usage: node scripts/swap-physical.mjs <in.json> <out.json>   (file = array, or {list:[...]} )
import { readFileSync, writeFileSync } from 'node:fs';
const [, , inp, out] = process.argv;
const raw = JSON.parse(readFileSync(inp, 'utf8'));
const list = Array.isArray(raw) ? raw : raw.list;
const by = id => list.find(x => x.id === id);
function swap(mainId, oldId, n, dxfull, organ) {
  const a = by(mainId), b = by(oldId);
  if (!a || !b) throw new Error('missing ' + mainId + ' / ' + oldId);
  const ia = list.indexOf(a), ib = list.indexOf(b);
  const main = { ...b, id: mainId, n, dxfull, organ, warn: '（講義：' + oldId + '）',
    alt: [...new Set([...(b.alt || []).filter(x => x !== mainId), oldId])] };
  delete main.parent; delete main.site;
  const look = { id: oldId, dxfull: b.dx, dx: b.dx, organ: '', desc: '', note: '', n: '', site: b.organ,
    parent: mainId, units: b.units, unit: b.unit, alt: [] };
  list[ib] = main; list[ia] = look;
  list.forEach(x => { if (x.parent === oldId) x.parent = mainId; });
}
swap('PA0328', 'PA0280', '35', "Crohn's disease, large intestine/colon", 'large intestine/colon');
swap('PA0329', 'PA0310', '40', 'Ulcerative colitis, large intestine/colon', 'large intestine/colon');
const r = by('PA0284'); r.n = ''; r.warn = '（講義：(69)；實體 69 號是 PA0342）';
writeFileSync(out, JSON.stringify(Array.isArray(raw) ? list : { ...raw, list, at: Date.now() }, null, Array.isArray(raw) ? 1 : 0));
console.log('ok', list.length);
