// The folders of the package and what they may reach, see docs/design/dashql_runtime.md. Reads every module of src/ and
// fails with each import that breaks a rule:
//
// - The folders of src/: core/ (the bindings of the core module) imports neither runtime/ nor platform/, platform/
//   doesn't import runtime/, runtime/ imports both. The package imports itself relatively, never by its name, and no
//   import leaves src/.
// - Only the bindings import the generated packages of the core module (@akohn/dashql-wasm, @akohn/dashql-flatbuffers),
//   the other folders reach them through the bindings.
// - No module reaches the app, React, an editor, a .tsx module or a bundler asset.
// - In runtime/ and platform/, only the modules of Node (runtime/node, platform/node) import node: and the modules of
//   Node, and no module uses a seam that only a browser or a bundler provides, unless the seam is a known one below.
//   The bindings are portable on their own terms: they load their Wasm in Node and in browsers, and the browser worker
//   is an entry of its own (core/browser_worker.ts).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/// The folders of src/ that a folder may import, besides itself
const REACHES = new Map([
    ['core', []],
    ['platform', ['core']],
    ['runtime', ['core', 'platform']],
]);

/// Packages that only a user interface needs
const FORBIDDEN_PACKAGE = /^(react|react-dom|react-router-dom|react-window|vega-embed|@codemirror\/[^/]+|@lezer\/[^/]+|@primer\/[^/]+|@react-hook\/[^/]+)(\/|$)/;
/// The generated packages of the core module, only the bindings import them
const CORE_GENERATED = /^@akohn\/dashql-(wasm|flatbuffers)(\/|$)/;
/// Bundler assets
const ASSET = /(\?url|\?raw|\.css)$/;

/// The seams that only a browser or a bundler provides. The handles of the origin private file system are no seam:
/// Node passes handles of a folder of the host (platform/node/node_directory_handle.ts), only the root of the browser is
/// one.
const SEAMS = [
    { name: 'a bundler asset', test: text => [...text.matchAll(IMPORT)].some(match => ASSET.test(match[1])) },
    { name: 'import.meta.glob', test: text => /\bimport\.meta\.glob\b/.test(text) },
    { name: 'the origin private file system', test: text => /\bnavigator\.storage\b/.test(text) },
    { name: 'a Web Worker', test: text => /core\/browser_worker|\bnew Worker\(/.test(text) },
    { name: 'the Electron bridge', test: text => /\bdashqlElectron\b/.test(text) },
];
/// The modules that still use a seam, each needs another way to what it does before Node can use it
const KNOWN_SEAMS = new Map([
    ['platform/electron_fs.ts', ['the Electron bridge']],
    ['platform/opfs_root.ts', ['the origin private file system']],
]);

const IMPORT = /(?:^|[\n;])\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function modules(dir) {
    return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap(entry => {
        const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
        if (entry.isDirectory()) return modules(path);
        return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
    });
}

/// Is a path of src/ a module of Node?
const isOfNode = path => /^(runtime|platform)\/node\//.test(path);

const violations = [];
const all = modules('');
for (const file of all) {
    const folder = file.split('/')[0];
    if (!REACHES.has(folder)) {
        violations.push(`${file}: not in one of the folders ${[...REACHES.keys()].join(', ')}`);
        continue;
    }
    const text = readFileSync(join(SRC, file), 'utf8');
    if (file.endsWith('.tsx')) violations.push(`${file}: a .tsx module`);
    const ofNode = isOfNode(file);
    const portable = folder !== 'core';
    for (const match of [...text.matchAll(IMPORT), ...text.matchAll(DYNAMIC_IMPORT)]) {
        const specifier = match[1];
        if (ASSET.test(specifier)) continue;
        if (portable && specifier.startsWith('node:') && !ofNode) violations.push(`${file}: ${specifier} is a module of Node, only the modules of Node import it`);
        if (specifier.startsWith('.')) {
            const target = normalize(join(dirname(file), specifier)).split('\\').join('/');
            const targetFolder = target.split('/')[0];
            if (target.startsWith('..')) violations.push(`${file}: ${specifier} leaves the package`);
            else if (targetFolder !== folder && !REACHES.get(folder).includes(targetFolder)) violations.push(`${file}: ${specifier} reaches ${targetFolder}/, ${folder}/ may only reach ${[folder, ...REACHES.get(folder)].join('/, ')}/`);
            else if (portable && !ofNode && isOfNode(target)) violations.push(`${file}: ${specifier} is a module of Node`);
            else if (/\.tsx$/.test(target) || existsSync(join(SRC, target.replace(/\.js$/, '.tsx')))) violations.push(`${file}: ${specifier} is a .tsx module`);
        } else if (FORBIDDEN_PACKAGE.test(specifier)) {
            violations.push(`${file}: ${specifier}`);
        } else if (specifier === '@akohn/dashql' || specifier.startsWith('@akohn/dashql/')) {
            violations.push(`${file}: ${specifier} imports the package by its name, use a relative import`);
        } else if (CORE_GENERATED.test(specifier) && folder !== 'core') {
            violations.push(`${file}: ${specifier} is a generated package of the core module, import the bindings`);
        }
    }
    // Tests may stand in for a platform, e.g. set a fake Electron bridge, the seams are checked in the modules
    if (!portable || /\.test\.ts$/.test(file)) continue;
    const known = KNOWN_SEAMS.get(file) ?? [];
    for (const seam of SEAMS) {
        const uses = seam.test(text);
        if (uses && !known.includes(seam.name)) violations.push(`${file}: uses ${seam.name}`);
        if (!uses && known.includes(seam.name)) violations.push(`${file} no longer uses ${seam.name}, remove it from KNOWN_SEAMS`);
    }
}
for (const file of KNOWN_SEAMS.keys()) {
    if (!existsSync(join(SRC, file))) violations.push(`${file} is gone, remove it from KNOWN_SEAMS`);
}

if (violations.length > 0) {
    console.error(`The package crosses its boundaries (${violations.length}):`);
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
}
console.log(`${all.length} modules of ${relative(process.cwd(), SRC) || 'src'} keep to their folders`);
