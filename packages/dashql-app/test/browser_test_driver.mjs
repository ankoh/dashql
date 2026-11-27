import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const playwright = await import('playwright-core');
const { mapCoverage, toLcov, toSummary } = await import('./browser_coverage.mjs');
const { formatPageError, isBenignConsoleError, isBenignPageError, runPageTests } = await import('./browser_page_tests.mjs');
const { serveBundle } = await import('./static_server.mjs');

const root = resolve(process.argv[2]);
const requestedFile = process.argv[3] ?? '';
const timeout = Number.parseInt(process.env.DASHQL_BROWSER_TEST_TIMEOUT ?? '600000', 10);
const browserName = process.env.DASHQL_BROWSER ?? 'chromium';
const browserType = playwright[browserName];
if (!browserType) throw new Error(`Unsupported browser: ${browserName}`);
const outputs = process.env.TEST_UNDECLARED_OUTPUTS_DIR;
const collectCoverage = process.env.DASHQL_BROWSER_COVERAGE === '1';
const pageTestsOnly = process.env.DASHQL_BROWSER_PAGE_TESTS_ONLY === '1';
if (collectCoverage && browserName !== 'chromium') throw new Error('Coverage needs the V8 profiler of Chromium');
const executablePath = process.env.DASHQL_BROWSER_EXECUTABLE;
// The pages of a run share the test files, every page has a browser context and a Hyper of its own. A page keeps about
// two cores busy, more than one page per four cores barely gets faster. Coverage reads the counters of one page.
const shardCount = requestedFile || collectCoverage
    ? 1
    : Number.parseInt(process.env.DASHQL_BROWSER_TEST_SHARDS ?? String(Math.min(4, Math.max(1, Math.floor(availableParallelism() / 4)))), 10);
// A job of CI runs a part of the suite: DASHQL_BROWSER_TEST_PARTITION=index/count picks the test files and the page tests
// of one of count parts, the other jobs run the rest. Its pages split the files of the part.
const partition = process.env.DASHQL_BROWSER_TEST_PARTITION ?? '0/1';
const [partitionIndex, partitionCount] = partition.split('/').map(Number);
if (!(Number.isInteger(partitionIndex) && Number.isInteger(partitionCount) && partitionIndex >= 0 && partitionIndex < partitionCount)) {
    throw new Error(`DASHQL_BROWSER_TEST_PARTITION is not index/count: ${partition}`);
}
if (partitionCount > 1 && (requestedFile || collectCoverage)) throw new Error('A single test file and coverage run the whole suite');
// With several shards, the page tests run next to them, half as many at once: at most six pages, the cpu tag of the
// suites in BUILD.bazel. A single shard (a runner of CI with four cores, coverage) runs them one by one after it, two
// pages on four cores timed tests out.
const pageTestsAlongside = shardCount > 1;
const pageTestConcurrency = pageTestsAlongside ? Math.ceil(shardCount / 2) : 1;

const server = await serveBundle(root);
const launchOptions = {
    // Firefox resolves XPCOM resources relative to the physical app bundle, not a runfiles symlink.
    executablePath: realpathSync(executablePath),
    headless: true,
};
// The ephemeral contexts of WebKit have no OPFS, navigator.storage.getDirectory() fails and Hyper never starts. A
// context of WebKit is a persistent one with a profile of its own instead, a browser process per context.
const persistentContexts = browserName === 'webkit';
const browser = persistentContexts ? null : await browserType.launch(launchOptions);
const contexts = [];

/// A new browser context, isolated from the others like a context of Chromium
async function newContext(options = {}) {
    const context = persistentContexts
        ? await browserType.launchPersistentContext(mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), 'profile-')), { ...launchOptions, ...options })
        : await browser.newContext(options);
    contexts.push(context);
    return context;
}

/// Run the test files of a shard on a page of its own
async function runShard(shard) {
    const page = await (await newContext()).newPage();
    const browserErrors = [];
    page.on('console', message => {
        if (message.type() === 'error' && !isBenignConsoleError(message.text())) browserErrors.push(message.text());
    });
    page.on('pageerror', error => { if (!isBenignPageError(error)) browserErrors.push(formatPageError(error)); });
    // Precise coverage keeps the counters of the scripts of every test frame alive until we take them at the end
    const profiler = collectCoverage ? await page.context().newCDPSession(page) : null;
    if (profiler) {
        await profiler.send('Profiler.enable');
        await profiler.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    }

    const query = new URLSearchParams({ autorun: '1' });
    if (requestedFile) query.set('file', requestedFile);
    // The shards of all parts, every part takes shardCount of them
    const allShards = partitionCount * shardCount;
    if (allShards > 1) query.set('shard', `${partitionIndex * shardCount + shard}/${allShards}`);
    await page.goto(`${server.url}/tests.html?${query}`, { waitUntil: 'domcontentloaded' });
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
        // The errors of the first failed files, a run that fails every file fails them with the same error
        for (const file of (current?.files ?? []).filter(file => file.error != null).slice(0, 3)) {
            console.error(`\n${file.file}\n${file.error.stack ?? file.error.message ?? 'Failed'}`);
        }
        if (browserErrors.length > 0) console.error(`\nBrowser errors:\n${browserErrors.join('\n')}`);
        throw error;
    }
    const summary = await page.evaluate(() => globalThis.__DASHQL_BROWSER_TESTS__);
    let scriptCoverages = [];
    if (profiler) {
        const { result } = await profiler.send('Profiler.takePreciseCoverage');
        await profiler.send('Profiler.stopPreciseCoverage');
        scriptCoverages = result;
    }
    return { browserErrors, scriptCoverages, summary };
}

try {
    const startedAt = performance.now();
    const runShards = async () => pageTestsOnly ? [] : await Promise.all(Array.from({ length: shardCount }, (_, shard) => runShard(shard)));
    // A run of a single test file leaves out the pages
    const runPages = async () => requestedFile
        ? { durations: {}, failures: [], scriptCoverages: [] }
        : await runPageTests(newContext, server.url, { collectCoverage, concurrency: pageTestConcurrency, outputs, partitionIndex, partitionCount });
    const [shards, pages] = pageTestsAlongside
        ? await Promise.all([runShards(), runPages()])
        : [await runShards(), await runPages()];
    if (collectCoverage) {
        const coverage = mapCoverage(root, [...shards.flatMap(shard => shard.scriptCoverages), ...pages.scriptCoverages]);
        const coverageSummary = toSummary(coverage);
        console.log(coverageSummary.split('\n', 1)[0]);
        if (outputs) {
            writeFileSync(join(outputs, 'coverage.dat'), toLcov(coverage.lines, 'packages/dashql-app/'));
            writeFileSync(join(outputs, 'coverage_summary.txt'), `${coverageSummary}\n`);
        }
    }
    const sum = key => shards.reduce((total, shard) => total + shard.summary[key], 0);
    const summary = {
        duration: performance.now() - startedAt,
        failed: sum('failed'),
        files: shards.flatMap(shard => shard.summary.files).sort((a, b) => a.file.localeCompare(b.file)),
        passed: sum('passed'),
        skipped: sum('skipped'),
        status: shards.every(shard => shard.summary.status === 'passed') && pages.failures.length === 0 ? 'passed' : 'failed',
        pageFailures: pages.failures,
        pageSeconds: pages.durations,
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

    console.log(`${summary.files.length} files, ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped in ${(summary.duration / 1000).toFixed(2)}s${partitionCount > 1 ? ` in part ${partition}` : ''} on ${shardCount} ${shardCount === 1 ? 'page' : 'pages'} and ${pageTestConcurrency} for the page tests`);
    if (failures.length > 0) console.error(`\n${failures.join('\n\n')}`);
    if (browserErrors.length > 0) console.error(`\nBrowser errors:\n${browserErrors.join('\n')}`);
    if (pages.failures.length > 0) console.error(`\nPage tests:\n${pages.failures.join('\n\n')}`);
    if (summary.status !== 'passed' || browserErrors.length > 0) process.exitCode = 1;
} finally {
    await Promise.all(contexts.map(context => context.close()));
    await browser?.close();
    await server.close();
}
