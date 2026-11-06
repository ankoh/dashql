import { createReadStream, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { availableParallelism } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';

const playwright = await import('playwright-core');
const { mapCoverage, toLcov, toSummary } = await import('./browser_coverage.mjs');

const root = resolve(process.argv[2]);
const requestedFile = process.argv[3] ?? '';
const timeout = Number.parseInt(process.env.DASHQL_BROWSER_TEST_TIMEOUT ?? '600000', 10);
const browserName = process.env.DASHQL_BROWSER ?? 'chromium';
const browserType = playwright[browserName];
if (!browserType) throw new Error(`Unsupported browser: ${browserName}`);
const outputs = process.env.TEST_UNDECLARED_OUTPUTS_DIR;
const collectCoverage = process.env.DASHQL_BROWSER_COVERAGE === '1';
if (collectCoverage && browserName !== 'chromium') throw new Error('Coverage needs the V8 profiler of Chromium');
const executableRoot = process.env.DASHQL_BROWSER_EXECUTABLE_ROOT;
const executablePath = executableRoot
    ? join(executableRoot, process.platform === 'darwin' ? 'firefox/Nightly.app/Contents/MacOS/firefox' : 'firefox/firefox')
    : process.env.DASHQL_BROWSER_EXECUTABLE;
// The pages of a run share the test files, every page has a browser context and a Hyper of its own. A page keeps about
// two cores busy, more than one page per four cores barely gets faster. Coverage reads the counters of one page.
const shardCount = requestedFile || collectCoverage
    ? 1
    : Number.parseInt(process.env.DASHQL_BROWSER_TEST_SHARDS ?? String(Math.min(4, Math.max(1, Math.floor(availableParallelism() / 4)))), 10);

const mimeTypes = {
    '.br': 'application/octet-stream',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2',
};

// The headers of the Cloudflare Pages deployment, read from the _headers file of the bundle. A line without indentation
// is a URL pattern where `*` matches any characters, the indented `Name: value` lines below it are its headers. The
// headers of every matching rule apply, a header of several rules joins their values with a comma, as on Pages.
function readHeaderRules(file) {
    const rules = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
        if (!/^\s/.test(line)) {
            const pattern = line.trim().split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
            rules.push({ pattern: new RegExp(`^${pattern}$`), headers: [] });
            continue;
        }
        const separator = line.indexOf(':');
        if (separator < 0 || rules.length === 0) throw new Error(`_headers: cannot read the line "${line}"`);
        rules.at(-1).headers.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
    }
    return rules;
}

const headerRules = readHeaderRules(join(root, '_headers'));

function responseHeaders(pathname, file, size) {
    const matched = {};
    for (const rule of headerRules) {
        if (!rule.pattern.test(pathname)) continue;
        for (const [name, value] of rule.headers) {
            matched[name] = matched[name] == null ? value : `${matched[name]}, ${value}`;
        }
    }
    return { 'Content-Length': String(size), 'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream', ...matched };
}

// The URL of the test frame of a shard lists its files
const server = createServer({ maxHeaderSize: 1024 * 1024 }, (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const relative = normalize(pathname === '/' ? 'index.html' : pathname.slice(1));
    const file = resolve(join(root, relative));
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
    }
    try {
        const stat = statSync(file);
        if (!stat.isFile()) throw new Error('Not a file');
        response.writeHead(200, responseHeaders(pathname, file, stat.size));
        createReadStream(file).pipe(response);
    } catch {
        response.writeHead(404).end('Not found');
    }
});

await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListening);
});

const address = server.address();
if (!address || typeof address === 'string') throw new Error('Static server did not bind a TCP port');
const browser = await browserType.launch({
    // Firefox resolves XPCOM resources relative to the physical app bundle, not a runfiles symlink.
    executablePath: realpathSync(executablePath),
    headless: true,
});

/// Run the test files of a shard on a page of its own
async function runShard(shard) {
    const page = await (await browser.newContext()).newPage();
    const browserErrors = [];
    page.on('console', message => {
        if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', error => browserErrors.push(error.stack ?? error.message));
    // Precise coverage keeps the counters of the scripts of every test frame alive until we take them at the end
    const profiler = collectCoverage ? await page.context().newCDPSession(page) : null;
    if (profiler) {
        await profiler.send('Profiler.enable');
        await profiler.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    }

    const query = new URLSearchParams({ autorun: '1' });
    if (requestedFile) query.set('file', requestedFile);
    if (shardCount > 1) query.set('shard', `${shard}/${shardCount}`);
    await page.goto(`http://127.0.0.1:${address.port}/tests.html?${query}`, { waitUntil: 'domcontentloaded' });
    // Poll with a timer, animation frames can stop on a page in the background
    const polling = 100;
    try {
        await page.waitForFunction(() => globalThis.__DASHQL_BROWSER_TESTS__?.status === 'running', null, { polling, timeout: 30_000 });
    } catch (error) {
        const current = await page.evaluate(() => globalThis.__DASHQL_BROWSER_TESTS__);
        console.error(`Browser test run did not start; current status: ${current?.status ?? 'unavailable'}`);
        if (browserErrors.length > 0) console.error(`\nBrowser errors:\n${browserErrors.join('\n')}`);
        throw error;
    }
    try {
        await page.waitForFunction(() => {
            const status = globalThis.__DASHQL_BROWSER_TESTS__?.status;
            return status === 'passed' || status === 'failed';
        }, null, { polling, timeout });
    } catch (error) {
        const current = await page.evaluate(() => globalThis.__DASHQL_BROWSER_TESTS__);
        const running = current?.files.find(file => file.status === 'running');
        console.error(`Timed out with ${current?.passed ?? 0} passed and ${current?.failed ?? 0} failed; active file: ${running?.file ?? 'none'}`);
        if (browserErrors.length > 0) console.error(`\nBrowser errors:\n${browserErrors.join('\n')}`);
        throw error;
    }
    const summary = await page.evaluate(() => globalThis.__DASHQL_BROWSER_TESTS__);
    if (profiler) {
        const { result } = await profiler.send('Profiler.takePreciseCoverage');
        await profiler.send('Profiler.stopPreciseCoverage');
        const coverage = mapCoverage(root, result);
        const coverageSummary = toSummary(coverage);
        console.log(coverageSummary.split('\n', 1)[0]);
        if (outputs) {
            writeFileSync(join(outputs, 'coverage.dat'), toLcov(coverage.lines, 'packages/dashql-app/'));
            writeFileSync(join(outputs, 'coverage_summary.txt'), `${coverageSummary}\n`);
        }
    }
    return { browserErrors, summary };
}

try {
    const startedAt = performance.now();
    const shards = await Promise.all(Array.from({ length: shardCount }, (_, shard) => runShard(shard)));
    const sum = key => shards.reduce((total, shard) => total + shard.summary[key], 0);
    const summary = {
        duration: performance.now() - startedAt,
        failed: sum('failed'),
        files: shards.flatMap(shard => shard.summary.files).sort((a, b) => a.file.localeCompare(b.file)),
        passed: sum('passed'),
        skipped: sum('skipped'),
        status: shards.every(shard => shard.summary.status === 'passed') ? 'passed' : 'failed',
        total: sum('total'),
    };
    const browserErrors = shards.flatMap(shard => shard.browserErrors);
    if (outputs) writeFileSync(join(outputs, 'browser_test_summary.json'), JSON.stringify(summary, null, 2));

    // V8 stacks start with the error message, Firefox stacks only list frames.
    const formatError = error => {
        if (!error) return 'Failed';
        const header = `${error.name ?? 'Error'}: ${error.message ?? ''}`;
        if (!error.stack) return header;
        return error.stack.startsWith(header) ? error.stack : `${header}\n${error.stack}`;
    };
    const failures = summary.files.flatMap(file => {
        const fileFailure = file.error ? [`${file.file}\n${formatError(file.error)}`] : [];
        const testFailures = file.tests
            .filter(test => test.status === 'failed')
            .map(test => `${file.file}: ${test.titlePath.join(' > ')}\n${formatError(test.error)}`);
        return [...fileFailure, ...testFailures];
    });

    console.log(`${summary.files.length} files, ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped in ${(summary.duration / 1000).toFixed(2)}s on ${shardCount} ${shardCount === 1 ? 'page' : 'pages'}`);
    if (failures.length > 0) console.error(`\n${failures.join('\n\n')}`);
    if (browserErrors.length > 0) console.error(`\nBrowser errors:\n${browserErrors.join('\n')}`);
    if (summary.status !== 'passed' || browserErrors.length > 0) process.exitCode = 1;
} finally {
    await browser.close();
    server.closeIdleConnections();
    server.closeAllConnections();
    await new Promise(resolveClosed => server.close(resolveClosed));
}
