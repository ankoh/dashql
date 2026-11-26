// Import a .dashql file into the app in Chromium and print where the time goes until the app is quiet: the perf marks
// (see "Perf marks" in docs/design/dashql_runtime.md), the long frames of the main thread and the renders of the React
// components. Serves the unminified bundle of :coverage_pages, so that the components keep their names.
//
//   bazel run //packages/dashql-app:perf_workbook -- <file.dashql> [--quiet=<ms>] [--json=<out.json>]
//
// --quiet: the app is quiet after this long without a span or a commit of React, 5000 by default
// --json: also write the spans, the frames and the renders to a file
import { realpathSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { serveBundle } from './static_server.mjs';

const { values: options, positionals } = parseArgs({
    allowPositionals: true,
    options: { quiet: { type: 'string', default: '5000' }, json: { type: 'string' } },
});
const [bundle, input] = positionals;
if (input == null) throw new Error('Usage: perf_workbook <file.dashql> [--quiet=<ms>] [--json=<out.json>]');
// `bazel run` runs in the runfiles, the paths of the user are relative to where they called it
const userPath = path => resolve(process.env.BUILD_WORKING_DIRECTORY ?? '.', path);
const file = userPath(input);
const quietMs = Number(options.quiet);

const server = await serveBundle(bundle);
const browser = await chromium.launch({ executablePath: realpathSync(process.env.DASHQL_BROWSER_EXECUTABLE), headless: true });
try {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    page.on('pageerror', error => console.error(`pageerror: ${error.message}`));
    await page.addInitScript(installObservers);

    await page.goto(`${server.url}/?perf`);
    await page.locator('[data-testid="composer-send"]').first().waitFor({ timeout: 120_000 });
    const started = await page.evaluate(() => {
        window.__perf.reset();
        return performance.now();
    });

    // Drop the file on the window like a user, the dropzone of the app asks before it imports
    await page.evaluate(() => {
        const picker = Object.assign(document.createElement('input'), { type: 'file', id: '__perf_file', hidden: true });
        document.body.appendChild(picker);
    });
    await page.setInputFiles('#__perf_file', file);
    await page.evaluate(() => {
        const files = new DataTransfer();
        for (const picked of document.getElementById('__perf_file').files) files.items.add(picked);
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }));
    });
    await page.getByRole('button', { name: 'Import' }).click({ timeout: 60_000 });

    // Wait until neither a span nor a commit of React came for quietMs, at most ten minutes
    const deadline = Date.now() + 600_000;
    let last = '', lastChange = Date.now();
    while (Date.now() - lastChange < quietMs) {
        if (Date.now() > deadline) throw new Error('The app did not get quiet within ten minutes');
        const now = await page.evaluate(() => `${performance.getEntriesByType('measure').length}/${window.__perf.commits}`);
        if (now !== last) [last, lastChange] = [now, Date.now()];
        await new Promise(resolveTimer => setTimeout(resolveTimer, 250));
    }
    const result = await page.evaluate(start => ({
        spans: performance.getEntriesByType('measure')
            .filter(entry => entry.name.startsWith('dashql:') && entry.startTime >= start)
            .map(entry => ({ name: entry.name.slice('dashql:'.length), start: entry.startTime - start, duration: entry.duration, detail: entry.detail?.text ?? '' })),
        frames: window.__perf.frames.filter(frame => frame.start >= start).map(frame => ({ ...frame, start: frame.start - start })),
        commits: window.__perf.commits,
        renders: [...window.__perf.renders].sort((a, b) => b[1] - a[1]),
    }), started);
    if (options.json) writeFileSync(userPath(options.json), JSON.stringify(result, null, 1));
    report(basename(file), result);
} finally {
    await browser.close();
    await server.close();
}

/// Runs in the page before the app: collects the long frames and counts the renders of every component by name
function installObservers() {
    const perf = { frames: [], renders: new Map(), commits: 0 };
    perf.reset = () => {
        perf.renders.clear();
        perf.commits = 0;
    };
    window.__perf = perf;
    new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            const scripts = [...(entry.scripts ?? [])].sort((a, b) => b.duration - a.duration).slice(0, 3).map(script => {
                const source = `${script.sourceFunctionName || '?'}@${script.sourceURL.split('/').pop()}:${script.sourceCharPosition}`;
                return `${Math.round(script.duration)}ms ${script.invoker} ${source}`;
            });
            perf.frames.push({ start: entry.startTime, duration: entry.duration, blocking: entry.blockingDuration, scripts });
        }
    }).observe({ type: 'long-animation-frame', buffered: true });

    // React reports every commit to the hook of its devtools. A component rendered in a commit if its fiber is new
    // (not in the tree of the previous commit) and either mounted or did work (the flag PerformedWork).
    const nameOf = fiber => {
        const type = fiber.type;
        if (type == null || typeof type === 'string') return null;
        return type.displayName ?? type.name ?? type.render?.name ?? type.type?.displayName ?? type.type?.name ?? null;
    };
    const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]); // function, class, forwardRef, memo, simple memo
    const PERFORMED_WORK = 1;
    let previous = new WeakSet();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        renderers: new Map(),
        inject: () => 1,
        checkDCE() { },
        onScheduleFiberRoot() { },
        onCommitFiberUnmount() { },
        onPostCommitFiberRoot() { },
        onCommitFiberRoot(_renderer, root) {
            perf.commits += 1;
            const seen = new WeakSet();
            const stack = [root.current];
            while (stack.length > 0) {
                const fiber = stack.pop();
                seen.add(fiber);
                if (!previous.has(fiber) && COMPONENT_TAGS.has(fiber.tag) && (fiber.alternate == null || (fiber.flags & PERFORMED_WORK) !== 0)) {
                    const name = nameOf(fiber);
                    if (name) perf.renders.set(name, (perf.renders.get(name) ?? 0) + 1);
                }
                if (fiber.sibling) stack.push(fiber.sibling);
                if (fiber.child) stack.push(fiber.child);
            }
            previous = seen;
        },
    };
}

/// Print the spans by name, the slowest spans, the longest frames and the components that rendered most
function report(name, { spans, frames, commits, renders }) {
    const ms = value => value.toFixed(1).padStart(9);
    const end = Math.max(0, ...spans.map(span => span.start + span.duration));
    console.log(`\n${name}: ${spans.length} spans until ${Math.round(end)} ms after the import, ${frames.length} long frames (${Math.round(frames.reduce((sum, frame) => sum + frame.duration, 0))} ms)`);

    const byName = new Map();
    for (const span of spans) byName.set(span.name, [...(byName.get(span.name) ?? []), span.duration]);
    const rows = [...byName].map(([spanName, durations]) => {
        durations.sort((a, b) => a - b);
        return { spanName, count: durations.length, total: durations.reduce((a, b) => a + b, 0), median: durations[durations.length >> 1], max: durations.at(-1) };
    }).sort((a, b) => b.total - a.total);
    console.log(`\n${'span'.padEnd(24)}${'count'.padStart(7)}${'total'.padStart(9)}${'median'.padStart(9)}${'max'.padStart(9)}`);
    for (const row of rows) console.log(`${row.spanName.padEnd(24)}${String(row.count).padStart(7)}${ms(row.total)}${ms(row.median)}${ms(row.max)}`);

    console.log('\nslowest spans (ms, at ms):');
    for (const span of [...spans].sort((a, b) => b.duration - a.duration).slice(0, 12)) {
        console.log(`${ms(span.duration)}  @${String(Math.round(span.start)).padStart(6)}  ${span.name}  ${span.detail.slice(0, 80)}`);
    }
    console.log('\nlongest frames (ms, at ms, top scripts):');
    for (const frame of [...frames].sort((a, b) => b.duration - a.duration).slice(0, 8)) {
        console.log(`${ms(frame.duration)}  @${String(Math.round(frame.start)).padStart(6)}  ${frame.scripts.join(' | ').slice(0, 140)}`);
    }
    console.log(`\nrenders: ${commits} commits, ${renders.reduce((sum, [, count]) => sum + count, 0)} component renders`);
    for (const [component, count] of renders.slice(0, 25)) console.log(`${String(count).padStart(7)}  ${component}`);
}
