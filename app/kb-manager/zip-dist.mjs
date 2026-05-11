import { execSync } from 'child_process';
import { readFileSync, existsSync, unlinkSync, copyFileSync } from 'fs';
import { resolve } from 'path';

const distPath = resolve('dist');
const manifest = JSON.parse(readFileSync(`${distPath}/manifest.json`, 'utf8'));
const appId = manifest['sap.app'].id;

const outZip = resolve(`dist/${appId}.zip`);

if (existsSync(outZip)) unlinkSync(outZip);

// Copy xs-app.json into dist so it gets zipped in
const xsAppSrc = resolve('xs-app.json');
if (existsSync(xsAppSrc)) {
  copyFileSync(xsAppSrc, resolve('dist/xs-app.json'));
}

// Zip all dist/* (excluding *.zip) into app zip
execSync(
  `powershell -Command "Get-ChildItem -Path '${distPath}' -Exclude '*.zip' | Compress-Archive -DestinationPath '${outZip}' -Force"`,
  { stdio: 'inherit' }
);

if (!existsSync(outZip)) {
  console.error('Zip not created:', outZip);
  process.exit(1);
}

console.log(`Created: dist/${appId}.zip`);
