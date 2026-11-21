// How the app reaches the runtime, see docs/agents/writing_components.md and docs/design/dashql_runtime.md:
//
// - The components that show a model import nothing of the runtime. Reads every module of COMPONENTS and fails with
//   each import that reaches the runtime: the hooks and the provider of the runtime, the runtime package
//   (@akohn/dashql/runtime/...), and the models other than by type. A component takes its model as a prop; what reads
//   the runtime itself comes in as a slot. A component that is written against a model adds its module here.
// - No module of the app calls the core module past the facade (`runtime.module`), the tests and their helpers may.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/// The modules of the components that show a model
const COMPONENTS = [
    'src/workbook/feed/script_card.tsx',
    'src/tools/unpack/parquet_file_card.tsx',
];

const IMPORT = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/// What a component may not import, a model only by type
const RUNTIME = [
    { test: path => /^@akohn\/dashql-react\/hooks$/.test(path) || /(^|\/)host\/(runtime_provider|standalone_runtime)(\.js)?$/.test(path), reason: 'the hooks or a provider of the runtime' },
    { test: path => /^@akohn\/dashql\/runtime(\/|$)/.test(path), reason: 'the runtime package' },
];
const MODEL = path => /^@akohn\/dashql-react\/models\//.test(path);

const failures = [];
for (const module of COMPONENTS) {
    const text = readFileSync(join(ROOT, module), 'utf8');
    for (const match of text.matchAll(IMPORT)) {
        const [, , typeOnly, path] = match;
        for (const rule of RUNTIME) {
            if (rule.test(path)) failures.push(`${module}: imports ${path}, ${rule.reason}`);
        }
        if (MODEL(path) && typeOnly == null) failures.push(`${module}: imports ${path} for more than its types, a component takes its model as a prop`);
    }
    for (const match of text.matchAll(DYNAMIC_IMPORT)) {
        const path = match[1];
        if (RUNTIME.some(rule => rule.test(path)) || MODEL(path)) failures.push(`${module}: imports ${path} dynamically`);
    }
}
/// The modules of the app, without the tests and their helpers
function appModules(dir) {
    const modules = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'tests') modules.push(...appModules(path));
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            modules.push(path);
        }
    }
    return modules;
}
const MODULE_CALL = /\bruntime\??\.module\b/;
for (const path of appModules(join(ROOT, 'src'))) {
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, i) => {
        if (MODULE_CALL.test(line)) failures.push(`${relative(ROOT, path)}:${i + 1}: calls the core module past the facade of the runtime`);
    });
}

if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log(`${COMPONENTS.length} components import nothing of the runtime, the app calls the module through the facade only`);
