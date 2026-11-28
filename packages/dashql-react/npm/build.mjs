// Builds dist/ of the package on npm (npm/package.json) from the modules of src/ that Bazel passes as arguments, the
// first argument is the SVG symbol atlas (//packages/dashql-react:svg_symbols):
//
// 1. Vite builds the modules as JavaScript, every module keeps its path (preserveModules). Packages stay imports, also
//    @akohn/dashql and React. The CSS modules become their class names in the JavaScript and, with the other
//    stylesheets of the modules, one stylesheet: dist/style.css, which a host imports once.
// 2. The atlas is a file next to the modules, dist/symbols.svg, and `@akohn/dashql-svg-symbols` the module
//    dist/svg_symbols.js with its URL (`new URL('./symbols.svg', import.meta.url)`): the bundler of a host emits it
//    as an asset. A data URL would not do, browsers don't resolve the `<use>` of one.
// 3. tsc writes the declarations of the modules next to them.
//
// The modules keep their paths in dist/: @akohn/dashql-react/components/button is dist/components/button.js. Which of
// them a host imports is the exports of the manifest, see //bazel:npm_manifest.mjs.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'vite';

const require = createRequire(import.meta.url);
const PACKAGE = process.cwd();
const SRC = path.join(PACKAGE, 'src');
const DIST = path.join(PACKAGE, 'dist');
const SYMBOLS = '@akohn/dashql-svg-symbols';

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;

const [atlas, ...modules] = process.argv.slice(2).map(file => path.resolve(PACKAGE, file));
if (atlas == null || !atlas.endsWith('.svg') || modules.length === 0) {
    throw new Error('usage: build.mjs <atlas.svg> <modules of src/...>');
}
rmSync(DIST, { recursive: true, force: true });

// 1. The JavaScript and the stylesheet
await build({
    configFile: false,
    root: PACKAGE,
    logLevel: 'warn',
    oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
    css: {
        // The classes of a module are `dashql_<class>_<hash of the module and the class>`: they don't collide with those
        // of other modules or of the host, and they are the same with every build
        modules: {
            generateScopedName: (name, filename) => {
                const module = path.relative(SRC, filename.split('?')[0]).split(path.sep).join('/');
                return `dashql_${name}_${createHash('sha256').update(`${module}:${name}`).digest('base64url').slice(0, 6)}`;
            },
        },
    },
    build: {
        outDir: DIST,
        emptyOutDir: false,
        target: 'es2022',
        minify: false,
        cssMinify: false,
        cssCodeSplit: false,
        copyPublicDir: false,
        rolldownOptions: {
            input: modules,
            // Packages, the atlas among them, stay imports
            external: id => !id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('\0'),
            preserveEntrySignatures: 'strict',
            // No comment with the path of each module: the paths of the sandbox differ between machines
            experimental: { attachDebugInfo: 'none' },
            output: {
                format: 'es',
                preserveModules: true,
                preserveModulesRoot: SRC,
                entryFileNames: '[name].js',
                assetFileNames: asset => (asset.names.some(name => name.endsWith('.css')) ? 'style.css' : 'assets/[name][extname]'),
            },
        },
    },
});

// 2. The atlas
copyFileSync(atlas, path.join(DIST, 'symbols.svg'));
writeFileSync(
    path.join(DIST, 'svg_symbols.js'),
    `// The URL of the SVG symbol atlas, a symbol is \`\${url}#<id>\`\nexport default new URL('./symbols.svg', import.meta.url).href;\n`,
);
writeFileSync(path.join(DIST, 'svg_symbols.d.ts'), 'declare const url: string;\nexport default url;\n');

function files(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
}

/// The specifier of a file of dist/ from another one
function relativeSpecifier(from, to) {
    const specifier = path.relative(path.dirname(from), to).split(path.sep).join('/');
    return specifier.startsWith('.') ? specifier : `./${specifier}`;
}

for (const file of files(DIST).filter(file => file.endsWith('.js'))) {
    const text = readFileSync(file, 'utf8');
    const replaced = text.replace(SPECIFIER, (match, keyword, quote, specifier) =>
        specifier === SYMBOLS ? `${keyword}${quote}${relativeSpecifier(file, path.join(DIST, 'svg_symbols.js'))}${quote}` : match,
    );
    if (replaced !== text) writeFileSync(file, replaced);
}

// 3. The declarations, against the sources of @akohn/dashql like the type check of the package
const TSCONFIG = path.join(PACKAGE, 'tsconfig.npm.json');
writeFileSync(TSCONFIG, JSON.stringify({
    extends: './tsconfig.bazel.json',
    compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        rootDir: 'src',
        outDir: 'dist',
    },
    include: ['src/assets.d.ts', ...modules.map(file => path.relative(PACKAGE, file))],
}));
const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', TSCONFIG], { stdio: 'inherit' });
rmSync(TSCONFIG);
if (tsc.status !== 0) throw new Error(`tsc failed with ${tsc.status ?? tsc.signal}`);
// tsc keeps the imports of stylesheets for their side effects, they are in dist/style.css and mean nothing to types
for (const file of files(DIST).filter(file => file.endsWith('.d.ts'))) {
    const text = readFileSync(file, 'utf8');
    const stripped = text.replace(/^import\s+(['"])[^'"]+\.css\1;\n/gm, '');
    if (stripped !== text) writeFileSync(file, stripped);
}

// Every module has its declarations, and every relative import of dist/ names a file of dist/
const missing = [];
for (const module of modules) {
    const stem = path.join(DIST, path.relative(SRC, module)).replace(/\.tsx?$/, '');
    for (const file of [`${stem}.js`, `${stem}.d.ts`]) {
        if (!existsSync(file)) missing.push(path.relative(DIST, file));
    }
}
for (const file of files(DIST).filter(file => /\.(js|d\.ts)$/.test(file))) {
    for (const [, , , specifier] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        if (specifier === SYMBOLS) missing.push(`${path.relative(DIST, file)}: ${specifier}, the atlas`);
        if (!specifier.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        if (!existsSync(resolved) && !existsSync(resolved.replace(/\.js$/, '.d.ts'))) missing.push(`${path.relative(DIST, file)}: ${specifier}`);
    }
}
if (!existsSync(path.join(DIST, 'style.css'))) missing.push('style.css');
if (missing.length > 0) throw new Error(`dist/ misses files:\n  ${missing.join('\n  ')}`);
