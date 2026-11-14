// Editors resolve every import of the SDK, see docs/wip/dashql_sdk.md. An editor checks a module of the SDK with the
// tsconfig.json of the package, which extends the root tsconfig.json: every package that a module imports must be a
// dependency of the root package.json or a path of the root tsconfig.json. Bazel checks with tsconfig.bazel.json.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(PACKAGE, '..', '..');

/// A tsconfig.json with comments
function readJsonc(path) {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
}

const violations = [];
const config = readJsonc(join(PACKAGE, 'tsconfig.json'));
if (config.extends !== '../../tsconfig.json') violations.push(`tsconfig.json must extend the root tsconfig.json, it extends ${config.extends}`);

const rootPaths = Object.keys(readJsonc(join(ROOT, 'tsconfig.json')).compilerOptions.paths ?? {});
const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const dependencies = new Set([...Object.keys(rootPackage.dependencies ?? {}), ...Object.keys(rootPackage.devDependencies ?? {})]);

/// Does a path of the root tsconfig.json map the specifier?
function mapped(specifier) {
    return rootPaths.some(path => path.endsWith('/*') ? specifier.startsWith(path.slice(0, -1)) : specifier === path);
}

/// The name of the package of a specifier
function packageName(specifier) {
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const IMPORT = /(?:^|[\n;])\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
function modules(dir) {
    return readdirSync(join(PACKAGE, dir), { withFileTypes: true }).flatMap(entry => {
        const path = `${dir}/${entry.name}`;
        return entry.isDirectory() ? modules(path) : entry.name.endsWith('.ts') ? [path] : [];
    });
}
for (const file of modules('src')) {
    for (const [, specifier] of readFileSync(join(PACKAGE, file), 'utf8').matchAll(IMPORT)) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
        if (!mapped(specifier) && !dependencies.has(packageName(specifier))) {
            violations.push(`${file}: ${specifier} is neither a dependency of the root package.json nor a path of the root tsconfig.json`);
        }
    }
}

if (violations.length > 0) {
    console.error(`Editors can't resolve everything of the SDK (${violations.length}):`);
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
}
console.log('editors resolve every import of the SDK');
