// Writes the manifest of a package on npm, see npm_manifest.bzl: npm/package.json with the version of the build
// (DASHQL_VERSION_NPM of version.env), @akohn/dashql a peer of exactly that version where it is one. After the exports
// of npm/package.json, the files that aren't modules of src/ (Wasm, stylesheets, the icons), come the exports of the
// source package (package.json) that name a module of the package on npm, with its JavaScript and declarations in
// dist/. The exports of tests, mocks and CSS modules stay in the workspace.
//
// Usage: npm_manifest.mjs <npm/package.json> <package.json> <version.env> <out> <modules of src/...>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [npmManifest, sourceManifest, versionEnv, out, ...modules] = process.argv.slice(2);
if (out == null || modules.length === 0) {
    throw new Error('usage: npm_manifest.mjs <npm/package.json> <package.json> <version.env> <out> <modules of src/...>');
}
const version = readFileSync(versionEnv, 'utf8').match(/^DASHQL_VERSION_NPM=(.+)$/m)?.[1];
if (version == null) {
    throw new Error(`no DASHQL_VERSION_NPM in ${versionEnv}`);
}
const manifest = JSON.parse(readFileSync(npmManifest, 'utf8'));
manifest.version = version;
if (manifest.peerDependencies?.['@akohn/dashql'] != null) {
    manifest.peerDependencies['@akohn/dashql'] = version;
}
// The modules of the package on npm, as paths of the source package (`./src/core/index.ts`)
const packageDir = path.dirname(sourceManifest);
const compiled = new Set(modules.map(module => `./${path.relative(packageDir, module).split(path.sep).join('/')}`));
for (const [subpath, file] of Object.entries(JSON.parse(readFileSync(sourceManifest, 'utf8')).exports)) {
    if (!compiled.has(file)) continue;
    if (subpath in manifest.exports) {
        throw new Error(`npm/package.json exports ${subpath}, a module of package.json`);
    }
    const module = file.replace(/^\.\/src\//, '').replace(/\.tsx?$/, '');
    manifest.exports[subpath] = { types: `./dist/${module}.d.ts`, import: `./dist/${module}.js` };
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
