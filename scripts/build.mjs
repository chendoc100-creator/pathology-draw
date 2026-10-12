import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { minify } from 'terser';
import { minify as minifyHtml } from 'html-minifier-terser';

const h = s => createHash('sha256').update(s).digest('hex').slice(0, 10);
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');

const js = (await minify(readFileSync('src/app.js', 'utf8'), {
  ecma: 2017, toplevel: true, compress: { passes: 2, drop_console: true }, mangle: { toplevel: true }, format: { comments: false },
})).code;
const css = readFileSync('src/app.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').replace(/\s*([{};:,])\s*/g, '$1');
const jn = `a.${h(js)}.js`, cn = `a.${h(css)}.css`;
writeFileSync(`dist/${jn}`, js);
writeFileSync(`dist/${cn}`, css);
let html = readFileSync('src/index.html', 'utf8').replace('app.css', cn).replace('app.js', jn);
html = await minifyHtml(html, { collapseWhitespace: true, removeComments: true, minifyCSS: true });
writeFileSync('dist/index.html', html);
writeFileSync('dist/robots.txt', 'User-agent: *\nDisallow: /\n');
console.log('built', jn, js.length, cn, css.length, 'index', html.length);
