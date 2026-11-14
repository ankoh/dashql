// Does the dev server of the app pick up changes of the source packages? Starts the dev server like `bazel run
// //packages/dashql-app:dev`, opens the app in a headless Chromium, and reports for a module of @ankoh/dashql-sdk and of
// @ankoh/dashql-ui whether the page loaded it from the sources, whether the dev server watches it, and how a change
// reaches the page: as hot updates or as a reload. A change is simulated, no file is written.
//
//   bazel run //packages/dashql-app:check_dev_hmr
import { createRequire } from 'node:module';
import path from 'node:path';

const [configPath, chromiumPath] = process.argv.slice(2).map(arg => path.resolve(arg));
const workspace = process.env.BUILD_WORKSPACE_DIRECTORY;
if (workspace == null) throw new Error('run with bazel run //packages/dashql-app:check_dev_hmr');
const require = createRequire(path.join(workspace, 'package.json'));
const vite = await import(require.resolve('vite'));
const { chromium } = require('playwright-core');

const MODULES = {
    sdk: path.join(workspace, 'packages/dashql-sdk/src/connections/query_executor_service.ts'),
    ui: path.join(workspace, 'packages/dashql-ui/src/wobble/wobble_morph.ts'),
};

process.chdir(path.join(workspace, 'packages/dashql-app'));
const server = await vite.createServer({ configFile: configPath, server: { port: 0 }, logLevel: 'warn', clearScreen: false });
await server.listen();
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
let failed = false;
try {
    const page = await browser.newPage();
    const updates = [];
    let reloads = 0;
    page.on('console', message => { if (message.text().startsWith('[vite] hot updated')) updates.push(message.text()); });
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) reloads++; });
    await page.goto(server.resolvedUrls.local[0], { waitUntil: 'load', timeout: 120_000 });
    await page.waitForTimeout(5000);
    const graph = server.environments.client.moduleGraph;
    const watched = Object.keys(server.watcher.getWatched());
    for (const [name, file] of Object.entries(MODULES)) {
        const loaded = (graph.getModulesByFile(file)?.size ?? 0) > 0;
        const isWatched = watched.some(dir => file.startsWith(`${dir}/`));
        updates.length = 0;
        const reloadsBefore = reloads;
        server.watcher.emit('change', file);
        await page.waitForTimeout(4000);
        const reached = updates.length > 0 || reloads > reloadsBefore;
        console.log(`${name}: loaded from the sources ${loaded}, watched ${isWatched}, a change reached the page ${reached} (${updates.length} hot updates, ${reloads - reloadsBefore} reloads)`);
        failed ||= !loaded || !isWatched || !reached;
        if (reloads > reloadsBefore) await page.waitForLoadState('load');
    }
} finally {
    await browser.close();
    await server.close();
}
process.exit(failed ? 1 : 0);
