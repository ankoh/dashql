// The archive of the package on npm as a host installs it:
//
// 1. Its files and its metadata: the manifest of npm/package.json with the version of the build, @akohn/dashql a peer
//    of the same version, no tests, the archive byte-reproducible.
// 2. Node renders a page of the components of dist/ (react-dom/server), every module resolves with its extension.
// 3. tsc type checks the page against the declarations of dist/, without skipping them.
// 4. Vite bundles the page like a host without Bazel: the classes of the components are in the stylesheet, the atlas
//    of the icons is a file of its own and the page refers to it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const tests = dirname(fileURLToPath(import.meta.url));
// The folder of the package, packages/dashql-react
const pkg = join(tests, '..', '..');
const consumer = await mkdtemp(join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-react-consumer-'));
const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' };

/// Unpack an archive of npm_tarball into a folder: regular files and folders in ustar format, no links
async function unpack(tarball, into) {
    const archive = gunzipSync(tarball);
    const paths = [];
    for (let offset = 0; offset < archive.length && archive[offset] !== 0;) {
        const header = archive.subarray(offset, offset + 512);
        const field = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, '');
        const prefix = field(345, 155);
        const path = `${prefix ? `${prefix}/` : ''}${field(0, 100)}`.replace(/\/$/, '');
        assert.ok(path === 'package' || path.startsWith('package/'), `unexpected tar path: ${path}`);
        assert.ok(!path.split('/').some(part => part === '..' || part === '.'), `unsafe tar path: ${path}`);
        assert.ok(!paths.includes(path), `duplicate tar path: ${path}`);
        paths.push(path);
        const size = Number.parseInt(field(124, 12).trim(), 8) || 0;
        assert.equal(Number.parseInt(field(108, 8).trim(), 8), 0, `non-normalized uid: ${path}`);
        assert.equal(Number.parseInt(field(116, 8).trim(), 8), 0, `non-normalized gid: ${path}`);
        const destination = join(into, path.slice('package'.length));
        const type = field(156, 1);
        if (type === '5') {
            await mkdir(destination, { recursive: true });
        } else {
            assert.ok(type === '0' || type === '', `unsupported tar entry ${type}: ${path}`);
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, archive.subarray(offset + 512, offset + 512 + size));
        }
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    return paths;
}

/// Run a script of Node in the consumer, fail with its output
function run(args) {
    const result = spawnSync(process.execPath, args, { cwd: consumer, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message ?? `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
}

try {
    // 1. The files and the metadata
    const packageDir = join(consumer, 'node_modules/@akohn/dashql-react');
    const tarball = await readFile(join(pkg, 'dashql-react.tgz'));
    assert.deepEqual(tarball, await readFile(join(pkg, 'dashql-react-rebuilt.tgz')), 'archive actions must be byte-reproducible');
    const paths = await unpack(tarball, packageDir);
    assert.deepEqual((await readdir(packageDir)).sort(), ['LICENSE', 'NOTICE', 'README.md', 'dist', 'fonts', 'package.json', 'styles']);
    assert.ok(paths.every(path => !/\.test\.|\/testing\/|\/node_modules\/|\.tsx?$/.test(path.replace(/\.d\.ts$/, ''))), 'no tests and no sources');
    for (const file of ['dist/style.css', 'dist/symbols.svg', 'dist/svg_symbols.js', 'dist/hooks.js', 'dist/hooks.d.ts', 'fonts/fonts.css', 'styles/tokens.css']) {
        assert.ok(paths.includes(`package/${file}`), `missing ${file}`);
    }
    const metadata = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
    assert.deepEqual(metadata, JSON.parse(await readFile(join(pkg, 'npm_files/package.json'), 'utf8')));
    const source = JSON.parse(await readFile(join(pkg, 'npm/package.json'), 'utf8'));
    assert.deepEqual(metadata, {
        ...source,
        version: metadata.version,
        peerDependencies: { ...source.peerDependencies, '@akohn/dashql': metadata.version },
    });
    assert.match(metadata.version, /^\d+\.\d+\.\d+(-(dev|latest)\.\d+\.g[0-9a-f]+)?$/);
    for (const file of ['LICENSE', 'NOTICE']) {
        assert.deepEqual(await readFile(join(packageDir, file)), await readFile(join(pkg, file)));
    }

    // The packages of the host, linked: the page imports only React
    for (const name of ['react', 'react-dom', '@types/react', '@types/react-dom']) {
        await mkdir(dirname(join(consumer, 'node_modules', name)), { recursive: true });
        await symlink(dirname(require.resolve(`${name}/package.json`)), join(consumer, 'node_modules', name), 'dir');
    }
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));

    // 2. Rendered in Node
    await writeFile(join(consumer, 'render.mjs'), `
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@akohn/dashql-react/components/button';
import { SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
const Play = SymbolIcon('arrow_right_16');
console.log(renderToStaticMarkup(React.createElement(Button, { leadingVisual: Play }, 'Run')));
`);
    const markup = run([join(consumer, 'render.mjs')]);
    assert.match(markup, /class="[^"]*\bdashql_button_[\w-]{6}\b/, markup);
    assert.match(markup, /<use [^>]*href="file:\/\/[^"]*\/node_modules\/@akohn\/dashql-react\/dist\/symbols\.svg#arrow_right_16"/, markup);

    // 3. Type checked against the declarations
    await writeFile(join(consumer, 'page.tsx'), `
import '@akohn/dashql-react/style.css';
import { createRoot } from 'react-dom/client';
import { Button } from '@akohn/dashql-react/components/button';
import { SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';

const Play = SymbolIcon('arrow_right_16');
createRoot(document.getElementById('root')!).render(<Button leadingVisual={Play}>Run</Button>);
`);
    await writeFile(join(consumer, 'css.d.ts'), "declare module '*.css';\n");
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx',
            lib: ['ES2022', 'DOM'], types: [], strict: true, skipLibCheck: false, noEmit: true,
        },
        files: ['page.tsx', 'css.d.ts'],
    }));
    const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
    run([tsc, '--project', join(consumer, 'tsconfig.json')]);

    // 4. Bundled by Vite
    await writeFile(join(consumer, 'index.html'), '<!doctype html><div id="root"></div><script type="module" src="./page.tsx"></script>\n');
    await writeFile(join(consumer, 'bundle.mjs'), `
import { build } from ${JSON.stringify(require.resolve('vite'))};
await build({
    configFile: false,
    root: ${JSON.stringify(consumer)},
    logLevel: 'warn',
    oxc: { jsx: { runtime: 'automatic' } },
    build: { outDir: 'out', minify: false },
});
`);
    run([join(consumer, 'bundle.mjs')]);
    const assets = await readdir(join(consumer, 'out/assets'));
    const atlas = assets.find(file => /^symbols-[\w-]+\.svg$/.test(file));
    assert.ok(atlas != null, `the atlas is a file of its own: ${assets.join(', ')}`);
    const scripts = assets.filter(file => file.endsWith('.js'));
    const code = (await Promise.all(scripts.map(file => readFile(join(consumer, 'out/assets', file), 'utf8')))).join('\n');
    assert.ok(code.includes(atlas), 'the page refers to the atlas');
    assert.ok(!code.includes('data:image/svg+xml'), 'the atlas is no data URL');
    const styles = (await Promise.all(assets.filter(file => file.endsWith('.css')).map(file => readFile(join(consumer, 'out/assets', file), 'utf8')))).join('\n');
    assert.match(styles, /\.dashql_button_[\w-]{6}\b/);
    console.log('Archive, metadata, rendering in Node, declarations and the bundle of a host passed');
} finally {
    await rm(consumer, { recursive: true, force: true });
}
