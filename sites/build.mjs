import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const assets = Object.fromEntries(['index.html','app.js','styles.css','admin.html','admin.js','live-voice.js'].map(name => [name, readFileSync('web/'+name,'utf8')]));
mkdirSync('dist/server',{recursive:true});
mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/.openai/hosting.json',readFileSync('.openai/hosting.json'));
writeFileSync('dist/server/index.js', 'const assets = '+JSON.stringify(assets)+';\n'+readFileSync('worker/index.js','utf8'));
