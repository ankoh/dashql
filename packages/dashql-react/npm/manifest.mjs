// Writes the manifest of the package on npm (npm_files/package.json): npm/package.json with the version of the build
// (DASHQL_VERSION_NPM of version.env) and @akohn/dashql a peer of exactly that version. After its files the exports
// hold the modules that the source package exports (package.json), as their JavaScript and declarations in dist/. The
// tests and their helpers (testing/) and the CSS modules stay in the workspace: on npm the classes of the components
// are in dist/style.css.
//
// Usage: manifest.mjs <npm/package.json> <package.json> <version.env> <out>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [npmManifest, sourceManifest, versionEnv, out] = process.argv.slice(2);
if (out == null) {
    throw new Error('usage: manifest.mjs <npm/package.json> <package.json> <version.env> <out>');
}
const version = readFileSync(versionEnv, 'utf8').match(/^DASHQL_VERSION_NPM=(.+)$/m)?.[1];
if (version == null) {
    throw new Error(`no DASHQL_VERSION_NPM in ${versionEnv}`);
}
const manifest = JSON.parse(readFileSync(npmManifest, 'utf8'));
manifest.version = version;
manifest.peerDependencies['@akohn/dashql'] = version;
for (const [subpath, file] of Object.entries(JSON.parse(readFileSync(sourceManifest, 'utf8')).exports)) {
    const module = file.match(/^\.\/src\/(.+)\.tsx?$/)?.[1];
    if (module == null || module.startsWith('testing/')) continue;
    if (subpath !== `./${module}`) {
        throw new Error(`the subpath ${subpath} is not the path of its module ${file}`);
    }
    manifest.exports[subpath] = { types: `./dist/${module}.d.ts`, import: `./dist/${module}.js` };
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
