// Builds dist/ of the package on npm (npm/package.json) from the modules of src/ that Bazel passes as arguments:
//
// 1. Stage the modules with everything they reach into dist/.stage/src: src/core, src/runtime and src/platform keep their
//    paths, the generated packages and the library of hyperdb-edge, which are not on npm, move to wasm/, gen/<name>/ and
//    hyperdb-edge/, and their specifiers become relative ones.
// 2. Vite builds the staged modules as JavaScript, every module keeps its path (preserveModules). Packages of npm and
//    of Node stay imports, the server build leaves `new URL(..., import.meta.url)` as it is, so the glue finds its Wasm
//    and the batch worker client its worker next to them.
// 3. tsc writes the declarations of the staged modules next to them, the declarations of the glue are copied.
//
// The subpaths of the source package stay the subpaths of dist/: @akohn/dashql/runtime/<path> is dist/runtime/<path>.js.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'vite';

const require = createRequire(import.meta.url);
const PACKAGE = process.cwd();
const DIST = path.join(PACKAGE, 'dist');
const STAGE = path.join(DIST, '.stage');

/// The packages that dist/ inlines: the specifier prefix, the folder of its files and its folder in dist/
const INLINED = [
    { prefix: '@akohn/dashql-wasm/', from: path.join(PACKAGE, 'dependencies/dashql-wasm'), to: 'wasm' },
    { prefix: '@akohn/dashql-flatbuffers/', from: path.join(PACKAGE, 'dependencies/dashql-flatbuffers'), to: 'gen/flatbuffers' },
    { prefix: '@akohn/dashql-protobuf/', from: path.join(PACKAGE, 'dependencies/dashql-protobuf'), to: 'gen/protobuf' },
    { prefix: '@akohn/dashql-jsonschema/', from: path.join(PACKAGE, 'dependencies/dashql-jsonschema'), to: 'gen/jsonschema' },
    { prefix: '@akohn/hyperdb-edge/', from: path.join(PACKAGE, '../../node_modules/@akohn/hyperdb-edge/src'), to: 'hyperdb-edge' },
];

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;

/// The file of a specifier that names a module of TypeScript or JavaScript, with or without its extension
function resolveFile(base) {
    const stem = base.replace(/\.js$/, '');
    for (const candidate of [base, `${stem}.ts`, `${stem}.d.ts`, `${base}.ts`]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    throw new Error(`no module ${base}`);
}

/// The path of a file in the staged tree
function stagedPath(file) {
    if (file.startsWith(path.join(PACKAGE, 'src') + path.sep)) return path.relative(PACKAGE, file);
    for (const { from, to } of INLINED) {
        if (file.startsWith(from + path.sep)) return path.join('src', to, path.relative(from, file));
    }
    throw new Error(`${file} is neither a module of src/ nor of an inlined package`);
}

/// The specifier of a staged file from another one, .ts becomes .js like the modules of src/ write it
function relativeSpecifier(from, to) {
    let specifier = path.relative(path.dirname(from), to).split(path.sep).join('/').replace(/(\.d)?\.ts$/, '.js');
    if (!specifier.startsWith('.')) specifier = `./${specifier}`;
    return specifier;
}

const entries = process.argv.slice(2).map(file => path.resolve(PACKAGE, file));
if (entries.length === 0) throw new Error('usage: build.mjs <modules of src/...>');
rmSync(DIST, { recursive: true, force: true });

// 1. Stage everything that the modules reach
const staged = new Map();
const pending = [...entries];
while (pending.length > 0) {
    const file = pending.pop();
    if (staged.has(file)) continue;
    const target = path.join(STAGE, stagedPath(file));
    staged.set(file, target);
    mkdirSync(path.dirname(target), { recursive: true });
    if (!/\.(ts|js)$/.test(file)) {
        copyFileSync(file, target);
        continue;
    }
    // The glue of wasm-bindgen comes with its declarations and its Wasm
    if (file.endsWith('.js')) {
        for (const sibling of [file.replace(/\.js$/, '.d.ts'), file.replace(/\.js$/, '.wasm')]) {
            if (existsSync(sibling)) pending.push(sibling);
        }
    }
    const text = readFileSync(file, 'utf8').replace(SPECIFIER, (match, keyword, quote, specifier) => {
        if (specifier.startsWith('.')) {
            pending.push(resolveFile(path.resolve(path.dirname(file), specifier)));
            return match;
        }
        const inlined = INLINED.find(({ prefix }) => specifier.startsWith(prefix));
        if (inlined == null) return match;
        const resolved = resolveFile(path.join(inlined.from, specifier.slice(inlined.prefix.length)));
        pending.push(resolved);
        return `${keyword}${quote}${relativeSpecifier(target, path.join(STAGE, stagedPath(resolved)))}${quote}`;
    });
    writeFileSync(target, text);
}

// 2. The JavaScript, every module keeps its path
const STAGED_SRC = path.join(STAGE, 'src');
await build({
    configFile: false,
    root: STAGE,
    logLevel: 'warn',
    build: {
        ssr: true,
        outDir: DIST,
        emptyOutDir: false,
        target: 'es2022',
        minify: false,
        copyPublicDir: false,
        rolldownOptions: {
            input: entries.map(file => staged.get(file)),
            external: id => !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('\0'),
            output: {
                format: 'es',
                preserveModules: true,
                preserveModulesRoot: STAGED_SRC,
                entryFileNames: '[name].js',
            },
        },
    },
    // Neutral modules for browsers and Node: the target of Node would let the helpers of the bundler import node:module
    ssr: { target: 'webworker' },
});

// 3. The declarations
writeFileSync(path.join(STAGE, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2022', 'WebWorker'],
        types: ['node'],
        strict: true,
        isolatedModules: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        declaration: true,
        emitDeclarationOnly: true,
        rootDir: 'src',
        outDir: '..',
    },
    include: ['src/**/*.ts'],
    // dist/ holds the stage, which tsc would leave out as the output folder
    exclude: [],
}));
const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', path.join(STAGE, 'tsconfig.json')], { stdio: 'inherit' });
if (tsc.status !== 0) throw new Error(`tsc failed with ${tsc.status ?? tsc.signal}`);
for (const [file, target] of staged) {
    if (/\.(d\.ts|wasm)$/.test(file)) copyFileSync(target, path.join(DIST, path.relative(STAGED_SRC, target)));
}
rmSync(STAGE, { recursive: true });

// Every relative import of dist/ names a file of dist/
function files(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const missing = [];
for (const file of files(DIST).filter(file => /\.(js|d\.ts)$/.test(file))) {
    for (const [, , , specifier] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        if (!specifier.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        if (!existsSync(resolved) && !existsSync(resolved.replace(/\.js$/, '.d.ts'))) missing.push(`${path.relative(DIST, file)}: ${specifier}`);
    }
}
if (missing.length > 0) throw new Error(`dist/ imports files it doesn't have:\n  ${missing.join('\n  ')}`);
