// Firestore REST helper for the data workflow (content/* only — never user data).
// node scripts/data.mjs get <doc> <out.json>      e.g. get content/slides out/slides.json
// node scripts/data.mjs put <doc> <in.json>       replaces the whole document
// node scripts/data.mjs merge <doc> <in.json>     sets only the top-level fields present in the file
import { readFileSync, writeFileSync } from 'node:fs';
const [, , op, doc, file] = process.argv;
if (!/^content\/[A-Za-z0-9_-]+$/.test(doc || '')) { console.error('only content/* documents'); process.exit(2); }
const TOKEN = process.env.TOKEN, P = process.env.PROJECT || 'pathology-draw';
const base = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents/${doc}`;
const enc = x => Array.isArray(x) ? { arrayValue: { values: x.map(enc) } }
  : x === null || x === undefined ? { nullValue: null }
  : typeof x === 'boolean' ? { booleanValue: x }
  : typeof x === 'number' ? (Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x })
  : typeof x === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, y]) => [k, enc(y)])) } }
  : { stringValue: String(x) };
const dec = v => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue
  : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec)
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, y]) => [k, dec(y)])) : 'timestampValue' in v ? v.timestampValue : null;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
if (op === 'get') {
  const r = await fetch(base, { headers: H });
  if (r.status === 404) { writeFileSync(file, 'null'); console.log(doc, 'missing'); process.exit(0); }
  if (!r.ok) { console.error(r.status, await r.text()); process.exit(1); }
  const j = await r.json();
  writeFileSync(file, JSON.stringify(dec({ mapValue: { fields: j.fields || {} } }), null, 1));
  console.log(doc, 'saved', file);
} else if (op === 'put' || op === 'merge') {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const q = op === 'merge' ? '?' + Object.keys(data).map(k => 'updateMask.fieldPaths=' + encodeURIComponent('`' + k + '`')).join('&') : '';
  const r = await fetch(base + q, { method: 'PATCH', headers: H, body: JSON.stringify({ fields: enc(data).mapValue.fields }) });
  if (!r.ok) { console.error(r.status, await r.text()); process.exit(1); }
  console.log(doc, op, 'ok');
} else { console.error('bad op'); process.exit(2); }
