// The runtime reaches no code of the app and no user interface, see docs/wip/dashql_runtime.md. Reads every module of src/
// and fails with each import that leaves the package, reaches React, an editor, a .tsx module or a bundler asset, and
// with each use of a seam that only a browser or a bundler provides, unless the seam is a known one below. Only the
// modules of Node in src/node import node:, and the other modules don't import them.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/// Packages that only a user interface needs
const FORBIDDEN_PACKAGE = /^(react|react-dom|react-router-dom|react-window|vega-embed|@codemirror\/[^/]+|@lezer\/[^/]+|@primer\/[^/]+|@react-hook\/[^/]+)(\/|$)/;
/// Bundler assets
const ASSET = /(\?url|\?raw|\.css)$/;

/// The seams that only a browser or a bundler provides
const SEAMS = [
    { name: 'a bundler asset', test: text => [...text.matchAll(IMPORT)].some(match => ASSET.test(match[1])) },
    { name: 'import.meta.glob', test: text => /\bimport\.meta\.glob\b/.test(text) },
    { name: 'the origin private file system', test: text => /\bnavigator\.storage\b|\bFileSystem(Directory|File)Handle\b/.test(text) },
    { name: 'the Electron bridge', test: text => /\bdashqlElectron\b/.test(text) },
];
/// The modules that still use a seam, step 4 gives each another way to what it needs
const KNOWN_SEAMS = new Map([
    ['platform/database/embedded_database.ts', ['the origin private file system']],
    ['platform/electron_fs.ts', ['the Electron bridge']],
    // Node gives the modules of the origin private file system a folder of the host with its handles
    ['node/node_directory_handle.ts', ['the origin private file system']],
    ['node/node_hyperdb.ts', ['the origin private file system']],
    ['platform/native_globals.ts', ['the Electron bridge']],
    ['platform/hyperdb/hyperdb_parquet_export.ts', ['the origin private file system']],
    ['platform/hyperdb/hyperdb_wasm.ts', ['the origin private file system']],
    ['platform/opfs_root.ts', ['the origin private file system']],
    ['storage/migration/migration_folder.ts', ['the origin private file system']],
    ['storage/opfs_query_result_cache.ts', ['the origin private file system']],
    ['storage/workbook_tree.ts', ['the origin private file system']],
    ['workbook/attachments/attachment_mirror.ts', ['the origin private file system']],
    ['workbook/attachments/attachment_mounts.ts', ['the origin private file system']],
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

const violations = [];
for (const file of modules('')) {
    const text = readFileSync(join(SRC, file), 'utf8');
    if (file.endsWith('.tsx')) violations.push(`${file}: a .tsx module`);
    for (const match of [...text.matchAll(IMPORT), ...text.matchAll(DYNAMIC_IMPORT)]) {
        const specifier = match[1];
        if (ASSET.test(specifier)) continue;
        const ofNode = file.startsWith('node/');
        if (specifier.startsWith('node:') && !ofNode) violations.push(`${file}: ${specifier} is a module of Node, only src/node imports it`);
        if (specifier.startsWith('.')) {
            const target = normalize(join(dirname(file), specifier));
            if (target.startsWith('..')) violations.push(`${file}: ${specifier} leaves the package`);
            else if (!ofNode && target.startsWith('node/')) violations.push(`${file}: ${specifier} is a module of Node`);
            else if (/\.tsx$/.test(target) || existsSync(join(SRC, target.replace(/\.js$/, '.tsx')))) violations.push(`${file}: ${specifier} is a .tsx module`);
        } else if (FORBIDDEN_PACKAGE.test(specifier)) {
            violations.push(`${file}: ${specifier}`);
        } else if (specifier.startsWith('@ankoh/dashql-runtime')) {
            violations.push(`${file}: ${specifier} imports the package by its name, use a relative import`);
        }
    }
    // Tests may stand in for a platform, e.g. set a fake Electron bridge, the seams are checked in the modules
    if (/\.test\.ts$/.test(file)) continue;
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
    console.error(`The runtime crosses its boundary (${violations.length}):`);
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
}
console.log(`${modules('').length} modules of ${relative(process.cwd(), SRC) || 'src'} stay inside the runtime`);
