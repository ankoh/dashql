// Editors resolve every import of the package, see docs/design/dashql_runtime.md. An editor checks a module of the
// package with the tsconfig.json of the package, which extends the root tsconfig.json: every package that a module
// imports must be a dependency of the root package.json or a path of the root tsconfig.json. Bazel checks with
// tsconfig.bazel.json.
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

const rootPathMap = readJsonc(join(ROOT, 'tsconfig.json')).compilerOptions.paths ?? {};
const rootPaths = Object.keys(rootPathMap);

// The generated packages of the package resolve to its own outputs, not to the copies of another package
for (const name of ['@ankoh/dashql-protobuf', '@ankoh/dashql-jsonschema', '@ankoh/dashql-wasm', '@ankoh/dashql-flatbuffers']) {
    for (const path of [name, `${name}/*`]) {
        for (const target of rootPathMap[path] ?? []) {
            if (!target.startsWith('./bazel-bin/packages/dashql/dependencies/')) {
                violations.push(`the root tsconfig.json maps ${path} to ${target}, not to the outputs of the package`);
            }
        }
    }
}

// The source package exports what the package on npm exports, and the root tsconfig.json maps it
const sourceExports = Object.keys(JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')).exports ?? {});
const npmExports = Object.keys(JSON.parse(readFileSync(join(PACKAGE, 'npm', 'package.json'), 'utf8')).exports ?? {});
for (const name of npmExports) {
    if (!sourceExports.includes(name)) violations.push(`package.json doesn't export ${name} of npm/package.json`);
}
for (const name of sourceExports) {
    if (!npmExports.includes(name)) violations.push(`npm/package.json doesn't export ${name} of package.json`);
    const specifier = name === '.' ? '@ankoh/dashql' : `@ankoh/dashql/${name.slice(2)}`;
    // The Wasm files resolve through the package, editors import no module of them
    if (!specifier.includes('wasm') && !specifier.endsWith('batch-worker') && !(specifier in rootPathMap)) {
        violations.push(`the root tsconfig.json doesn't map ${specifier}`);
    }
}
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
    console.error(`Editors can't resolve everything of the package (${violations.length}):`);
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
}
console.log('editors resolve every import of the package');
