// Builds the static site for GitHub Pages into ../../dist
// index.html is written without <!doctype>/<head> (the Claude artifact host adds them),
// so this wraps it into a full document and copies the data files next to it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(SRC, '..', 'dist');

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

const page = await fs.readFile(path.join(SRC, 'index.html'), 'utf8');
const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#e6b655"/><text x="32" y="45" font-family="Arial Black,Arial" font-size="38" text-anchor="middle" fill="#1d1504">M</text></svg>');
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#121827">
<meta name="description" content="Тир-лист MLBB, билды против конкретных героев, контрпики и профиль игрока.">
<link rel="icon" href="${icon}">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}</style>
</head>
<body>
${page}
</body>
</html>
`;
await fs.writeFile(path.join(OUT, 'index.html'), html);
for (const f of ['data.json', 'img.json']) await fs.copyFile(path.join(SRC, f), path.join(OUT, f));
await fs.writeFile(path.join(OUT, '.nojekyll'), '');
console.log('dist/ готов:', (await fs.readdir(OUT)).join(', '));
