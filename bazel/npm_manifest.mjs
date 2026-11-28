// Writes the manifest of a package on npm, see npm_manifest.bzl: npm/package.json with the version of the build
// (DASHQL_VERSION_NPM of version.env), @akohn/dashql a peer of exactly that version where it is one, and the exports of
// the source package (package.json) without the condition `@akohn/source`. That condition points the workspace at the
// sources, the archive has only dist/; an export that only the workspace has (tests, mocks, CSS modules) is left out.
//
// Usage: npm_manifest.mjs <npm/package.json> <package.json> <version.env> <out>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [npmManifest, sourceManifest, versionEnv, out] = process.argv.slice(2);
if (out == null) {
    throw new Error('usage: npm_manifest.mjs <npm/package.json> <package.json> <version.env> <out>');
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
manifest.exports = {};
for (const [subpath, target] of Object.entries(JSON.parse(readFileSync(sourceManifest, 'utf8')).exports)) {
    if (typeof target === 'string') {
        manifest.exports[subpath] = target;
        continue;
    }
    const { '@akohn/source': _, ...published } = target;
    if (Object.keys(published).length > 0) manifest.exports[subpath] = published;
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
