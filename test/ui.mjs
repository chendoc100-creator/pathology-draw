// End-to-end check against the Firebase emulators, in Chromium, Firefox and WebKit (Safari engine).
// Writes screenshots and a results log to ci-out/.
import { chromium, firefox, webkit, devices } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';

const OUT = 'ci-out'; mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:5055/';
const log = s => { console.log(s); appendFileSync(`${OUT}/ui.log`, s + '\n'); };
let fails = 0;
const check = (ok, what) => { log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };

// seed the emulator (rules bypassed with the emulator owner token)
const slides = JSON.parse(readFileSync('seed/slides.json', 'utf8'));
const fsUrl = 'http://127.0.0.1:8080/v1/projects/demo-pd/databases/(default)/documents';
const toVal = v => Array.isArray(v) ? { arrayValue: { values: v.map(toVal) } }
  : v && typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toVal(x)])) } }
  : typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v ?? '') };
await fetch(`${fsUrl}/content/slides`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { list: toVal(slides), at: toVal(1) } }) });

// a small synthetic "histology" picture for upload tests
const png = Buffer.from(readFileSync('test/sample.png'));

async function run(name, type, ctxOpts) {
  log(`\n=== ${name} ===`);
  const browser = await type.launch();
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(() => { window.__EMU = true; });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const shot = n => page.screenshot({ path: `${OUT}/${name}-${n}.png`, fullPage: false });
  try {
    await page.goto(BASE);
    await page.waitForSelector('#gate:not([hidden])', { timeout: 20000 });
    check(await page.isHidden('#app'), `${name}: content hidden before login`);
    await shot('1-gate');

    await page.evaluate(() => window.__emuLogin({ sub: 'alice', email: 'alice@example.com', name: 'Alice' }));
    await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
    check(await page.isHidden('#t-adm'), `${name}: admin tab hidden for classmate`);
    check((await page.textContent('#units')).includes('Micro 1'), `${name}: unit chip shown`);
    check((await page.textContent('#prog')).includes('/ 45'), `${name}: 45 slides in pool`);

    await page.click('#draw');
    await page.waitForSelector('#slot .it');
    const id = (await page.textContent('#slot .head')).match(/PA\d{4}/)[0];
    log(`${name}: drew ${id}`);
    await page.click('#slot .r');
    check(await page.isVisible('#slot .ans-w .ansblk'), `${name}: answer shown`);

    // personal edit with highlight + bold
    await page.click('#slot .ed');
    const ta = page.locator('#slot .e-ds');
    await ta.fill('*1. Key finding one\n2. Second point');
    await ta.evaluate(t => { t.focus(); t.setSelectionRange(5, 16); });
    await page.click('#slot .tb button[data-m="=="]');
    await ta.evaluate(t => { const s = t.value.indexOf('Second'); t.focus(); t.setSelectionRange(s, s + 6); });
    await page.click('#slot .tb button[data-m="__"]');
    check((await ta.inputValue()) === '*1. ==Key finding== one\n2. __Second__ point', `${name}: highlight/bold markup inserted`);
    await page.click('#slot .sv');
    await page.waitForSelector('#slot mark');
    check((await page.textContent('#slot mark')) === 'Key finding', `${name}: highlight rendered`);
    check((await page.textContent('#slot .ans-w b')) === 'Second', `${name}: bold rendered`);
    check((await page.textContent('#slot .ans-w')).includes('我的版本'), `${name}: personal version label`);
    await shot('2-edited');

    // notes + image
    await page.click('#slot .nb');
    await page.fill('#slot .n-t', 'my note about this slide');
    await page.waitForFunction(() => document.querySelector('#slot .n-s').textContent === '已儲存', null, { timeout: 15000 });
    await page.setInputFiles('#slot .n-f', { name: 's.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('#slot .th img', { timeout: 20000 });
    check(true, `${name}: image uploaded`);

    // microscope: open, change objective, save view for line 1, then reopen from the answer line
    await page.click('#slot .th');
    await page.waitForSelector('#scope:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#sc-img').naturalWidth > 0);
    const f = await page.locator('#sc-f').boundingBox();
    check(Math.abs(f.width - f.height) < 2, `${name}: field is circular (${Math.round(f.width)}x${Math.round(f.height)})`);
    await page.click('#sc-obj button[data-o="40"]');
    check((await page.textContent('#sc-info')).includes('400×'), `${name}: 40x objective`);
    await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
    await page.mouse.down(); await page.mouse.move(f.x + f.width / 2 - 60, f.y + f.height / 2 - 30, { steps: 5 }); await page.mouse.up();
    await page.selectOption('#sc-line', { index: 1 });
    await page.click('#sc-sv');
    await shot('3-scope40');
    await page.click('#sc-x');
    await page.waitForSelector('#slot .ln.vw', { timeout: 10000 });
    await page.click('#slot .ln.vw');
    await page.waitForSelector('#scope:not([hidden])');
    await page.waitForTimeout(900);
    check((await page.textContent('#sc-info')).includes('400×'), `${name}: answer line reopens at saved 40x view`);
    await shot('4-reopen');
    await page.click('#sc-x');

    // report
    await page.click('#slot .rp');
    await page.fill('#slot .r-t', 'organ should be X');
    await page.click('#slot .r-s');
    await page.waitForFunction(() => document.querySelector('#slot .rp-w').textContent.includes('已送出'), null, { timeout: 10000 });
    check((await page.textContent('#slot .rp-w')).includes('已送出'), `${name}: report sent`);

    // review tab
    await page.click('#slot .v');
    await page.click('#t-rev');
    await page.waitForSelector('#l-rev .it');
    check((await page.textContent('#l-rev')).includes('my note about this slide'), `${name}: review shows notes`);
    await page.click('#rv-key');
    check((await page.locator('#l-rev .ans-w .ln').count()) >= 1, `${name}: key-points filter`);
    await page.click('#rv-hide');
    await shot('5-review');

    // persistence after reload
    await page.reload();
    await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
    check((await page.textContent('#rc')) === '1', `${name}: review list persisted`);
    check((await page.textContent('#sc')) === '1', `${name}: seen persisted`);

    // admin
    await page.click('#login');
    await page.waitForSelector('#gate:not([hidden])');
    await page.evaluate(() => window.__emuLogin({ sub: 'kevin', email: 'chendoc100@gmail.com', name: 'Kevin' }));
    await page.waitForSelector('#t-adm:not([hidden])', { timeout: 20000 });
    check(true, `${name}: admin tab visible for admin`);
    check((await page.textContent('#rc')) === '0', `${name}: admin does not see Alice's progress`);
    await page.click('#t-adm');
    await page.waitForSelector('#a-rep .rep', { timeout: 10000 });
    check((await page.textContent('#a-rep')).includes('organ should be X'), `${name}: admin sees report`);
    await page.click('#a-new');
    const fill = (k, v) => page.fill(`#a-form [data-k="${k}"]`, v);
    await fill('id', 'pa9' + String(Math.floor(Math.random() * 900) + 100));
    await fill('unit', 'Micro 2'); await fill('dxfull', 'Test lesion, liver'); await fill('organ', 'liver');
    await fill('desc', '*1. Test point'); await fill('link', 'http://microteaching.ntu.edu.tw:9002/GestaltViewer?wlGUID=x');
    await page.click('#a-form .sv');
    await page.waitForFunction(() => document.querySelector('#units').textContent.includes('Micro 2'), null, { timeout: 10000 });
    check(true, `${name}: new unit appears after adding slide`);
    await page.click('#a-rep .dn');
    await page.waitForFunction(() => !document.querySelector('#a-rep .rep'), null, { timeout: 10000 });
    check(true, `${name}: report marked done`);
    await shot('6-admin');
    await page.click('#units button:has-text("Micro 2")');
    check((await page.textContent('#prog')).includes('/ 1'), `${name}: unit filter limits pool`);
    await page.click('#t-draw'); await page.click('#draw');
    await page.waitForSelector('#slot .mt');
    check((await page.getAttribute('#slot .mt', 'href')).startsWith('http://microteaching'), `${name}: microteaching link button`);
  } catch (e) {
    fails++; log(`FAIL ${name}: exception ${e.message.split('\n')[0]}`);
    await shot('ERR').catch(() => {});
  }
  const real = errs.filter(e => !/emulator|Failed to load resource/i.test(e));
  check(real.length === 0, `${name}: no page errors ${real.length ? JSON.stringify(real.slice(0, 3)) : ''}`);
  await browser.close();
}

// reset the emulator users between engines so each run starts clean
async function wipe() {
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-pd/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-pd/accounts', { method: 'DELETE' });
  await fetch(`${fsUrl}/content/slides`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { list: toVal(slides), at: toVal(1) } }) });
}

await run('chromium-desktop', chromium, { viewport: { width: 1280, height: 900 } });
await wipe(); await run('firefox-desktop', firefox, { viewport: { width: 1280, height: 900 } });
await wipe(); await run('webkit-iphone', webkit, { ...devices['iPhone 13'] });
await wipe(); await run('chromium-android', chromium, { ...devices['Pixel 7'] });
log(`\nTOTAL FAILS: ${fails}`);
writeFileSync(`${OUT}/status.txt`, fails ? 'FAIL' : 'PASS');
process.exit(0);
