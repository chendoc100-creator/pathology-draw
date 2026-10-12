// Prints a Firestore REST document body for content/slides from seed/slides.json
import { readFileSync } from 'node:fs';
const v = x => Array.isArray(x) ? { arrayValue: { values: x.map(v) } }
  : x && typeof x === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(x).map(([k, y]) => [k, v(y)])) } }
  : typeof x === 'number' ? { integerValue: String(x) } : { stringValue: String(x ?? '') };
const list = JSON.parse(readFileSync('seed/slides.json', 'utf8'));
process.stdout.write(JSON.stringify({ fields: { list: v(list), at: v(Date.now()) } }));
