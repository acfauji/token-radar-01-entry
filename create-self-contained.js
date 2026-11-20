const fs = require('fs');
const path = require('path');

const repoPath = '/root/token-radar-01-entry';
const outPath = path.join(repoPath, 'out');

// Read the generated files
const dataJs = fs.readFileSync(path.join(outPath, 'data.js'), 'utf8');
const appJs = fs.readFileSync(path.join(repoPath, 'dashboard', 'app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(repoPath, 'dashboard', 'app.css'), 'utf8');

// Create self-contained HTML
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Token Radar: pre-token protocols ranked by implied launch value</title>
<style>${appCss}</style>
</head>
<body>
<a class="skip" href="#board">Skip to the board</a>
<main id="board" tabindex="-1" aria-busy="true"></main>
<script>${dataJs}</script>
<script>${appJs}</script>
</body>
</html>`;

fs.writeFileSync(path.join(outPath, 'dashboard', 'index-self-contained.html'), html);
console.log('Self-contained HTML written to out/dashboard/index-self-contained.html');