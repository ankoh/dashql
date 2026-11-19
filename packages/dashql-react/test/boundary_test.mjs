// What the package reaches, see docs/design/dashql_runtime.md: React, apache-arrow, vitest in the testing helpers, and
// @akohn/dashql. No import leaves src/, none reaches an app. Reads every module of src/ and fails with each import that
// breaks a rule.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const IMPORT = /(?:^|[\n;])\s*(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
/// The packages that the modules may import
const ALLOWED = /^(react|apache-arrow|@akohn\/dashql)(\/|$)/;
/// Only the helpers of tests import vitest
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
    const paths = [...text.matchAll(IMPORT), ...text.matchAll(DYNAMIC_IMPORT)].map(match => match[1]);
    for (const path of paths) {
        if (path.startsWith('.')) {
            const target = normalize(join(dirname(module), path));
            if (relative(SRC, target).startsWith('..')) failures.push(`${name}: imports ${path}, which leaves src/`);
        } else if (TESTING.test(path)) {
            if (!name.startsWith('testing/')) failures.push(`${name}: imports ${path}, only the helpers of tests may`);
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
