// End-to-end check against the Firebase emulators, in Chromium, Firefox and WebKit (Safari engine).
// A mock microteaching list (port 5057) and an OpenSeadragon mock viewer (port 5056) stand in for NTU's pages.
// Writes screenshots and a results log to ci-out/.
import { chromium, firefox, webkit, devices } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';

const OUT = 'ci-out'; mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:5055/';
const VIEW = 'http://127.0.0.1:5056', LIST = 'http://127.0.0.1:5057';
const EXE = process.env.PW_CHROMIUM || undefined;
const log = s => { console.log(s); appendFileSync(`${OUT}/ui.log`, s + '\n'); };
let fails = 0;
let last = '';
const check = (ok, what) => { last = what; log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails++; };
const step = what => { last = what; log('  .. ' + what); };

const slides = JSON.parse(readFileSync('seed/slides.json', 'utf8'));
const catalog = JSON.parse(readFileSync('seed/catalog.json', 'utf8'));
const fsUrl = 'http://127.0.0.1:8080/v1/projects/demo-pd/databases/(default)/documents';
const toVal = v => Array.isArray(v) ? { arrayValue: { values: v.map(toVal) } }
  : v && typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toVal(x)])) } }
  : typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v ?? '') };
const png = Buffer.from(readFileSync('test/sample.png'));
const put = (path, fields) => fetch(`${fsUrl}/${path}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
async function seed() {
  await put('content/slides', { list: toVal(slides), at: toVal(1) });
  await put('content/catalog', { list: toVal(catalog.list) });
  await put('content/fields', { PA0306: toVal({ vid: 'PA0306', pts: [{ k: 'dx', x: 900, y: 300, obj: 40, conf: '中', note: 'test point' }] }) });
}
await seed();

async function run(name, type, ctxOpts, viewer) {
  log(`\n=== ${name} ===`);
  const browser = await type.launch(type === chromium && EXE ? { executablePath: EXE } : {});
  let dead = false;
  const wd = setTimeout(() => { dead = true; fails++; log(`FAIL ${name}: watchdog (stuck after: ${last})`); browser.close().catch(() => {}); }, 240000);
  const ctx = await browser.newContext({ acceptDownloads: true, ...ctxOpts });
  await ctx.addInitScript(([v, l]) => { window.__EMU = true; window.__VIEW_ORIGIN = v; window.__LIST_ORIGIN = l; window.__PORTAL = l + '/list.html'; window.__VIEWURL = v + '/viewer.html'; }, [VIEW, LIST]);
  const page = await ctx.newPage();
  const errs = [];
  const watch = p => { p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); };
  watch(page); ctx.on('page', watch);
  const shot = (n, p = page) => p.screenshot({ path: `${OUT}/${name}-${n}.png`, fullPage: false });
  try {
    await page.goto(BASE);
    await page.waitForSelector('#gate:not([hidden])', { timeout: 20000 });
    check(await page.isHidden('#app'), `${name}: content hidden before login`);

    await page.evaluate(() => window.__emuLogin({ sub: 'alice', email: 'alice@example.com', name: 'Alice' }));
    await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
    check(await page.isHidden('#admbtn') && await page.isHidden('#t-adm'), `${name}: no admin button/tab for classmate`);
    check((await page.textContent('#units')).includes('Respiratory system'), `${name}: category chips shown`);
    check((await page.textContent('#prog')).includes('/ ' + slides.length), `${name}: ${slides.length} slides in pool`);
    await page.uncheck('#altc');
    check((await page.textContent('#prog')).includes('/ ' + slides.filter(d => !d.parent).length), `${name}: online look-alikes can be left out`);
    await page.check('#altc');

    await page.click('#units button:has-text("Infection")');
    check((await page.textContent('#prog')).includes('/ ' + slides.filter(d => d.units.includes('Infection')).length), `${name}: category filter (incl. review slides)`);
    await page.click('#units button:has-text("全部")');
    await page.click('#units .gb:has-text("Micro 1")');
    check((await page.textContent('#prog')).includes('Cell injury and adaption') && (await page.textContent('#prog')).includes('Infection'), `${name}: Micro 1 selects its units`);
    check(await page.locator('#units .grp:has(.gb:has-text("Micro 1")) button[aria-pressed="true"]').count() === 5 && (await page.textContent('#units')).includes('Micro 3'), `${name}: Micro 1 row all on`);
    await page.click('#units button:has-text("全部")');

    await page.click('#draw');
    await page.waitForSelector('#slot .it');
    const id = (await page.textContent('#slot .head')).match(/PA\d{4}/)[0];
    log(`${name}: drew ${id}`);
    const unitNames = [...new Set(slides.flatMap(d => d.units))];
    const headTxt = await page.textContent('#slot .head');
    check(!unitNames.some(u => headTxt.includes(u)), `${name}: question card does not name the unit`);
    await page.click('#slot .r');
    check(await page.isVisible('#slot .ans-w .ansblk'), `${name}: answer shown`);

    // personal edit with highlight + bold
    await page.click('#slot .ed');
    const ta = page.locator('#slot .e-ds');
    await ta.fill('*1. Key finding one\n2. Second point');
    await ta.evaluate(t => { t.focus(); t.setSelectionRange(4, 15); });
    await page.click('#slot .tb button[data-m="=="]');
    await ta.evaluate(t => { const s = t.value.indexOf('Second'); t.focus(); t.setSelectionRange(s, s + 6); });
    await page.click('#slot .tb button[data-m="__"]');
    check((await ta.inputValue()) === '*1. ==Key finding== one\n2. __Second__ point', `${name}: highlight/bold markup inserted`);
    await page.click('#slot .sv');
    await page.waitForSelector('#slot mark');
    check((await page.textContent('#slot mark')) === 'Key finding', `${name}: highlight rendered`);
    check((await page.textContent('#slot .ans-w')).includes('我的版本'), `${name}: personal version label`);

    // whole-slide note + image with caption
    await page.click('#slot .nb');
    await page.fill('#slot .n-t', 'my note about this slide');
    await page.waitForFunction(() => document.querySelector('#slot .n-s').textContent === '已儲存', null, { timeout: 15000 });
    await page.setInputFiles('#slot .n-f', { name: 's.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('#slot .th img', { timeout: 20000 });
    check(true, `${name}: image uploaded`);
    await page.click('#slot .th');
    await page.waitForSelector('#lb:not([hidden])');
    await page.fill('#lb-n', 'caption: fibrin and neutrophils');
    await page.waitForFunction(() => document.querySelector('#lb-s').textContent === '已儲存', null, { timeout: 15000 });
    await page.click('#lb-x');
    await page.waitForSelector('#slot .tcap');
    check((await page.textContent('#slot .tcap')).includes('caption'), `${name}: image caption saved`);

    // report
    await page.click('#slot .rp');
    await page.fill('#slot .r-t', 'organ should be X');
    await page.click('#slot .r-s');
    await page.waitForFunction(() => document.querySelector('#slot .rp-w').textContent.includes('已送出'), null, { timeout: 10000 });
    check(true, `${name}: report sent`);

    // review tab
    await page.click('#slot .v');
    await page.click('#t-rev');
    await page.waitForSelector('#l-rev .it');
    check((await page.locator('#l-rev .n-t').first().inputValue()) === 'my note about this slide', `${name}: review shows notes`);
    await page.click('#rv-hide');
    await shot('2-review');

    // catalog
    await page.click('#t-cat');
    await page.fill('#c-q', 'PA0306');
    await page.waitForSelector('#l-cat tbody tr');
    const cells = await page.locator('#l-cat tbody tr').first().locator('td').allTextContents();
    check(cells[0] === '4' && /endocarditis/i.test(cells[2]), `${name}: catalog maps PA0306 to slide 4`);
    await page.fill('#c-q', 'PA0349');
    check((await page.textContent('#l-cat')).includes('線上沒有'), `${name}: physical-only slide listed`);
    await page.fill('#c-q', '');
    await shot('3-catalog');

    // export to Word
    await page.click('#t-exp');
    await page.waitForSelector('#l-exp input');
    check(await page.isChecked(`#l-exp input[value="${id}"]`), `${name}: slide with notes pre-selected for export`);
    const dl = page.waitForEvent('download', { timeout: 20000 });
    await page.click('#x-go');
    const file = await (await dl).path();
    const buf = readFileSync(file);
    const s = buf.toString('utf8');
    check(buf.slice(0, 2).toString() === 'PK' && s.includes('word/document.xml') && s.includes('標楷體') && s.includes('Times New Roman'), `${name}: .docx with 標楷體 / Times New Roman`);
    check(s.includes('word/media/image1.jpeg') && s.includes('caption: fibrin') && s.includes('my note about this slide') && s.includes('Key finding'), `${name}: export has answer, note, image and caption`);

    // persistence after reload
    await page.reload();
    await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
    check((await page.textContent('#rc')) === '1', `${name}: review list persisted`);

    if (viewer) {
      // 看片: app opens the NTU viewer server page; one bookmarklet press there opens the slide in our locked viewer
      await page.click('#t-cat'); await page.fill('#c-q', 'PA0306');
      await page.click('#l-cat tbody tr button');
      const pop = page.waitForEvent('popup');
      await page.click('#l-cat tr.exp .sv2');
      const vw = await pop;
      await vw.waitForURL(/viewer\.html\?pd=PA0306/, { timeout: 15000 });
      check(true, `${name}: 看片 opens the viewer page for PA0306`);
      check(await page.isVisible('#bmd'), `${name}: first-use bookmarklet guide shown`);
      step('viewer bookmarklet');
      await vw.addScriptTag({ url: BASE + 'h.js' });
      await vw.waitForFunction(() => window.__pdh && window.__pdh.viewer() && window.__pdh.viewer().world.getItemCount() > 0 && window.__pdh.state().id === 'PA0306', null, { timeout: 20000 });
      await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('已連上看片分頁（PA0306）'), null, { timeout: 15000 });
      check(true, `${name}: bookmarklet opened PA0306 and the app connected`);
      check(await page.isHidden('#bmd'), `${name}: guide closes once the viewer connects`);
      const iz = () => vw.evaluate(() => { const v = window.__pdh.viewer().viewport; return v.viewportToImageZoom(v.getZoom()); });
      const D = await vw.evaluate(() => { const r = document.getElementById('pdh-v').getBoundingClientRect(); return Math.floor(Math.min(r.width, r.height) * 0.94); });
      const want = o => 10 * D / { 4: 5500, 10: 2200, 40: 550 }[o];
      await vw.waitForTimeout(1200);
      check(Math.abs(await iz() / want(4) - 1) < 0.03, `${name}: 4× field = 5.5 mm (${(await iz()).toFixed(4)} vs ${want(4).toFixed(4)})`);
      check(await vw.isVisible('#pdh-root') && await vw.isVisible('#pdh-hole'), `${name}: circular locked viewer covers the page`);
      await vw.click('#pdh-bar [data-o="40"]'); await vw.waitForTimeout(1500);
      check(Math.abs(await iz() / want(40) - 1) < 0.03, `${name}: 40× field = 0.55 mm`);
      const box = await vw.locator('#pdh-v').boundingBox();
      await vw.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await vw.mouse.wheel(0, 200); await vw.waitForTimeout(1500);
      check(Math.abs(await iz() / want(10) - 1) < 0.03, `${name}: wheel steps 40× → 10× (no free zoom)`);
      await vw.mouse.down(); await vw.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 40, { steps: 6 }); await vw.mouse.up();
      await vw.waitForTimeout(1000);
      check(Math.abs(await iz() / want(10) - 1) < 0.03, `${name}: dragging keeps the objective`);
      await shot('4-viewer', vw);

      // answer point in the main app jumps the viewer
      if (await page.isHidden('#l-cat tr.exp .ans-w')) await page.click('#l-cat tr.exp .r');
      await page.waitForSelector('#l-cat tr.exp .ln.vw', { timeout: 10000 });
      await page.click('#l-cat tr.exp .ln.vw');
      await vw.waitForTimeout(1800);
      let c = await vw.evaluate(() => window.__pdh.state());
      check(c.obj === 40 && Math.abs(c.x - 900) < 15 && Math.abs(c.y - 300) < 15, `${name}: answer point moves viewer to (900,300) at 40× (got ${c.x},${c.y} ${c.obj}×)`);
      check(Math.abs(await iz() / want(40) - 1) < 0.03, `${name}: answer point uses the locked 40×`);

      // capture from the viewer goes into this slide's notes
      step('capture');
      await vw.click('#pdh-cap');
      await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('已把擷取的視野存進 PA0306'), null, { timeout: 15000 });
      check(true, `${name}: viewer capture saved into PA0306 notes`);

      // another slide's 看片 switches the same tab (no new popup, no second bookmarklet press)
      let popups = 0; ctx.on('page', () => popups++);
      await page.fill('#c-q', 'PA0097');
      await page.click('#l-cat tbody tr button');
      await page.click('#l-cat tr.exp .sv2');
      await vw.waitForFunction(() => window.__pdh && window.__pdh.state().id === 'PA0097', null, { timeout: 15000 });
      check(popups === 0, `${name}: 看片 on another slide switches the open viewer tab`);

      step('closing viewer');
      await vw.click('#pdh-x');
      await vw.waitForTimeout(300);
      check(!(await vw.$('#pdh-root')), `${name}: closing removes the viewer overlay`);
      await vw.close();
    }

    step('admin');
    // admin: same screen until the 管理 button is pressed
    await page.click('#login');
    await page.waitForSelector('#gate:not([hidden])');
    await page.evaluate(() => window.__emuLogin({ sub: 'kevin', email: 'chendoc100@gmail.com', name: 'Kevin' }));
    await page.waitForSelector('#admbtn:not([hidden])', { timeout: 20000 });
    check(await page.isHidden('#t-adm'), `${name}: admin starts in the normal view`);
    check((await page.textContent('#rc')) === '0', `${name}: admin does not see Alice's progress`);
    await page.click('#admbtn');
    await page.waitForSelector('#t-adm:not([hidden])');
    await page.waitForSelector('#a-rep .rep', { timeout: 10000 });
    check((await page.textContent('#a-rep')).includes('organ should be X'), `${name}: admin sees report`);
    await page.click('#a-new');
    const fill = (k, v) => page.fill(`#a-form [data-k="${k}"]`, v);
    await fill('id', 'PA9' + String(Math.floor(Math.random() * 900) + 100));
    await fill('units', 'Micro 2'); await fill('dxfull', 'Test lesion, liver'); await fill('organ', 'liver');
    await fill('desc', '*1. Test point');
    await page.click('#a-form .sv');
    await page.waitForFunction(() => document.querySelector('#units').textContent.includes('Micro 2'), null, { timeout: 10000 });
    check(true, `${name}: new category appears after adding slide`);
    await page.click('#a-rep .dn');
    await page.waitForFunction(() => !document.querySelector('#a-rep .rep'), null, { timeout: 10000 });
    check(true, `${name}: report marked done`);
    await shot('6-admin');
    await page.click('#admbtn');
    check(await page.isHidden('#t-adm'), `${name}: leaving admin hides admin tab`);
  } catch (e) {
    fails++; log(`FAIL ${name}: exception ${e.message.split('\n')[0]}`);
    await shot('ERR').catch(() => {});
  }
  const real = errs.filter(e => !/emulator|Failed to load resource|127\.0\.0\.1:(8080|9099)|ERR_|favicon/i.test(e));
  check(real.length === 0, `${name}: no page errors ${real.length ? JSON.stringify(real.slice(0, 3)) : ''}`);
  clearTimeout(wd);
  if (!dead) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 20000))]);
}

async function wipe() {
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-pd/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-pd/accounts', { method: 'DELETE' });
  await seed();
}

const only = process.env.ONLY;
const runs = [
  ['chromium-desktop', chromium, { viewport: { width: 1280, height: 900 } }, true],
  ['firefox-desktop', firefox, { viewport: { width: 1280, height: 900 } }, true],
  ['webkit-desktop', webkit, { viewport: { width: 1280, height: 900 } }, true],
  ['webkit-iphone', webkit, { ...devices['iPhone 13'] }, false],
  ['chromium-android', chromium, { ...devices['Pixel 7'] }, false],
].filter(r => !only || r[0] === only);
for (let i = 0; i < runs.length; i++) { if (i) await wipe(); await run(...runs[i]); }
log(`\nTOTAL FAILS: ${fails}`);
writeFileSync(`${OUT}/status.txt`, fails ? 'FAIL' : 'PASS');
process.exit(0);
