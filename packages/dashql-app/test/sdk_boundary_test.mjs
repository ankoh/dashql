// The modules that move into packages/dashql-sdk must not reach React, an editor, a .tsx module or a bundler asset,
// see docs/wip/dashql_sdk.md. Follows every import of the roots, type imports included, and fails with the chain
// of each import that crosses the line.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/// The modules of the SDK and everything they import
const ROOTS = [
    'utils/store.ts',
    'workbook/scripts/workbook_scripts.ts',
    'workbook/scripts/workbook_scripts_registry_state.ts',
    'connections/connection_state.ts',
    'connections/connection_registry_state.ts',
    'query/query_execution_state.ts',
    'storage/workbook_tables.ts',
    'storage/storage_writer.ts',
];

/// Packages that only a user interface needs
const FORBIDDEN_PACKAGE = /^(react|react-dom|react-router-dom|react-window|vega-embed|@codemirror\/[^/]+|@lezer\/[^/]+|@primer\/[^/]+|@react-hook\/[^/]+)(\/|$)/;
/// Bundler assets
const FORBIDDEN_ASSET = /(\?url|\?raw|\.css)$/;
/// The modules that still import a bundler asset, each needs another way to its asset before the package moves
const KNOWN_ASSET_IMPORTS = new Map([
    ['connections/catalog/prefetched_hyper_functions.ts', 'the functions of Hyper as SQL text'],
]);

const IMPORT = /(?:^|[\n;])\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(file) {
    const text = readFileSync(join(SRC, file), 'utf8');
    return [...text.matchAll(IMPORT), ...text.matchAll(DYNAMIC_IMPORT)].map(match => match[1]);
}

function resolveLocal(from, specifier) {
    const base = normalize(join(dirname(from), specifier));
    const candidates = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
    return candidates.find(candidate => existsSync(join(SRC, candidate)) && /\.tsx?$/.test(candidate)) ?? null;
}

const parent = new Map(ROOTS.map(root => [root, null]));
const queue = [...ROOTS];
const violations = [];
const knownAssetImports = new Set();

function chain(file) {
    const files = [];
    for (let current = file; current != null; current = parent.get(current)) files.push(current);
    return files.join(' <- ');
}

for (const root of ROOTS) {
    if (!existsSync(join(SRC, root))) violations.push(`missing root ${root}`);
}
while (queue.length > 0) {
    const file = queue.shift();
    if (!existsSync(join(SRC, file))) continue;
    for (const specifier of importsOf(file)) {
        if (FORBIDDEN_ASSET.test(specifier)) {
            if (KNOWN_ASSET_IMPORTS.has(file)) {
                knownAssetImports.add(file);
            } else {
                violations.push(`${specifier}: ${chain(file)}`);
            }
        } else if (specifier.startsWith('.')) {
            const target = resolveLocal(file, specifier);
            if (target == null) continue;
            if (target.endsWith('.tsx')) {
                violations.push(`${target}: ${chain(file)}`);
            } else if (!parent.has(target)) {
                parent.set(target, file);
                queue.push(target);
            }
        } else if (FORBIDDEN_PACKAGE.test(specifier)) {
            violations.push(`${specifier}: ${chain(file)}`);
        }
    }
}

for (const file of KNOWN_ASSET_IMPORTS.keys()) {
    if (!knownAssetImports.has(file)) violations.push(`${file} no longer imports an asset, remove it from KNOWN_ASSET_IMPORTS`);
}
if (violations.length > 0) {
    console.error(`The SDK modules reach code of the user interface (${violations.length}):`);
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
}
console.log(`${parent.size} modules reachable from ${ROOTS.length} roots, none reaches the user interface`);
