// What the package reaches, see docs/design/dashql_runtime.md: React, apache-arrow, vitest in the testing helpers,
// @akohn/dashql, and the few libraries of the components. No import leaves src/, none reaches an app. The components
// (src/components) and their helpers (src/dom) show what they are given: they reach neither the hooks nor the runtime of
// @akohn/dashql, a model only by type. Reads every module of src/ and fails with each import that breaks a rule.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const IMPORT = /(?:^|[\n;])\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
/// The packages that the modules may import, the sprite of the SVG symbols comes from the bundler of the host
const ALLOWED = /^(react|react-dom|apache-arrow|@akohn\/dashql|@akohn\/dashql-svg-symbols|@primer\/behaviors|@react-hook\/resize-observer|react-window|d3)(\/|$)/;
/// The folders of the components and their helpers
const SHOWS = /^(components|dom)\//;
/// What a component may not import
const RUNTIME = /^@akohn\/dashql\/runtime(\/|$)/;
/// Only the tests and their helpers import vitest
const TESTING = /^vitest$/;

function modules(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? modules(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

const failures = [];
for (const module of modules(SRC)) {
    const name = relative(SRC, module);
    const text = readFileSync(module, 'utf8');
    const imports = [...text.matchAll(IMPORT)].map(match => ({ typeOnly: match[1] != null, path: match[2] }));
    const paths = [...imports, ...[...text.matchAll(DYNAMIC_IMPORT)].map(match => ({ typeOnly: false, path: match[1] }))];
    for (const { typeOnly, path } of paths) {
        if (SHOWS.test(name)) {
            const target = path.startsWith('.') ? relative(SRC, normalize(join(dirname(module), path))) : null;
            if (RUNTIME.test(path) || target === 'hooks.js' || target === 'hooks') {
                failures.push(`${name}: imports ${path}, a component gets the runtime as a model or a slot`);
            } else if (target?.startsWith('models/') && !typeOnly) {
                failures.push(`${name}: imports ${path}, a component imports a model by type only`);
            }
        }
        if (path.startsWith('.')) {
            const target = normalize(join(dirname(module), path));
            if (relative(SRC, target).startsWith('..')) failures.push(`${name}: imports ${path}, which leaves src/`);
        } else if (TESTING.test(path)) {
            if (!name.startsWith('testing/') && !/\.test\.tsx?$/.test(name)) failures.push(`${name}: imports ${path}, only the tests and their helpers may`);
        } else if (!ALLOWED.test(path)) {
            failures.push(`${name}: imports ${path}, the package reaches React, apache-arrow and @akohn/dashql only`);
        }
    }
}
if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('the modules of @akohn/dashql-react keep their boundary');
