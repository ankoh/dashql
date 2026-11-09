// Tests of the real pages of the bundle: index.html, shell.html, demos.html and oauth.html.
//
// Their entry points call createRoot when they are imported, so a test in the test frame can't load them, and tests in
// the frame replace parts of the composition with fakes. These tests boot the pages like a browser does, with the
// headers and the Content-Security-Policy of the deployment. Every test has a browser context of its own, the tests in
// the frame share an origin and would see its storage and its app ownership lock otherwise.
//
// A test fails if the page logs a console error, throws, or does not reach the state that the test waits for.
//
// The pages run without WebGL. Without a GPU, the particle flow of some pages stalls the main thread for seconds in software
// rendering. The pages have to work without WebGL anyway.

import { join } from 'node:path';

/// A page has to boot the core and Hyper
const PAGE_TIMEOUT = 60_000;

/// The editor with the script of a session that holds the text
const scriptEditor = (page, text) => page.locator('.cm-content').filter({ hasText: text });

/// Open the app and run a query in the composer of the new session
async function openSessionWithQuery(page, navigate) {
    await navigate('/');
    await page.getByRole('navigation', { name: 'Areas' }).waitFor();
    await page.getByTestId('composer-send').waitFor();
    await page.locator('.cm-content').first().click();
    await page.keyboard.type('select 42 as answer');
    await page.getByTestId('composer-send').click();
    await page.getByText('Statement executed successfully').waitFor();
    await page.getByText('1 row').waitFor();
    await page.getByText('42', { exact: true }).last().waitFor();
}

/// The pathname of the page
const pathnameOf = page => new URL(page.url()).pathname;

/// A long line wraps in the card of the feed, the editor is as high as its text and does not scroll sideways.
/// An editor that measured before the list had a width would stay thousands of pixels too high.
async function testAppWrappedScript(page, navigate) {
    await navigate('/');
    await page.getByTestId('composer-send').waitFor();
    await page.locator('.cm-content').first().click();
    const columns = Array.from({ length: 30 }, (_, i) => `1 as column_${i}_with_a_long_name`);
    await page.keyboard.insertText(`select ${columns.join(', ')};`);
    await page.getByTestId('composer-send').click();
    await page.getByText('Statement executed successfully').waitFor();
    const { contentHeight, scrollerHeight, overflow, rowHeight } = await scriptEditor(page, 'column_0_with_a_long_name').evaluate(content => {
        const scroller = content.closest('.cm-scroller');
        return {
            contentHeight: content.getBoundingClientRect().height,
            scrollerHeight: scroller.getBoundingClientRect().height,
            overflow: scroller.scrollWidth - scroller.clientWidth,
            rowHeight: parseFloat(getComputedStyle(content).lineHeight),
        };
    });
    if (contentHeight < 2 * rowHeight) throw new Error(`The line does not wrap, the text is ${contentHeight}px high`);
    if (Math.abs(scrollerHeight - contentHeight) > 1) throw new Error(`The editor is ${scrollerHeight}px high, its text ${contentHeight}px`);
    if (overflow > 0) throw new Error(`The editor scrolls ${overflow}px sideways`);
}

/// The greeter at the root: a session only appears with its first script, a reload stays in it, the brand goes back
async function testAppGreeter(page, navigate) {
    const expectGreeter = async () => {
        await page.getByTestId('feed-landing-wobble').waitFor();
        await page.getByTestId('session-ephemeral-row').waitFor();
        if (pathnameOf(page) !== '/') throw new Error(`The greeter is at ${page.url()}`);
        if (!await page.getByTestId('create-session').isDisabled()) throw new Error('The greeter can jump to itself');
    };
    await navigate('/');
    await expectGreeter();
    if (await page.getByTestId('session-row-menu').count() !== 0) throw new Error('The greeter created a session');
    // A reload doesn't create a session either
    await navigate();
    await expectGreeter();
    if (await page.getByTestId('session-row-menu').count() !== 0) throw new Error('The reload created a session');

    await page.getByTestId('composer-send').waitFor();
    await page.locator('.cm-content').first().click();
    await page.keyboard.type('select 42 as answer');
    await page.getByTestId('composer-send').click();
    await page.getByText('Statement executed successfully').waitFor();
    await page.waitForURL(url => url.pathname.startsWith('/sessions/'));
    const sessionPathname = pathnameOf(page);
    await page.getByTestId('session-row-menu').waitFor();
    await page.getByTestId('session-ephemeral-row').waitFor();

    await navigate();
    await scriptEditor(page, 'select 42 as answer').waitFor();
    if (pathnameOf(page) !== sessionPathname) throw new Error(`The reload left the session for ${page.url()}`);

    await page.getByTestId('brand-home').click();
    await expectGreeter();
    await page.getByTestId('session-row-menu').waitFor();
    // The session is one step back
    await page.goBack();
    await scriptEditor(page, 'select 42 as answer').waitFor();
    await page.getByTestId('create-session').click();
    await expectGreeter();
    await page.goBack();
    await scriptEditor(page, 'select 42 as answer').waitFor();
    await page.getByTestId('session-ephemeral-row').locator('button').click();
    await expectGreeter();
    // Opening the app at the root greets as well, with sessions in the list
    await navigate('/');
    await expectGreeter();
    await page.getByTestId('session-row-menu').waitFor();
}

/// The views of a session on the real providers: the dashboard, the dataflow canvas and its editor dialog.
/// An edit in the dialog is still there after a reload.
async function testAppSession(page, navigate) {
    await openSessionWithQuery(page, navigate);

    await page.getByRole('button', { name: 'Dashboard' }).click();
    await page.getByTestId('dashboard-card-edit').first().click();
    const editorOverlay = page.getByTestId('dashboard-editor-overlay');
    await editorOverlay.locator('.cm-content').filter({ hasText: 'select 42 as answer' }).waitFor();
    await editorOverlay.getByRole('button', { name: 'Close', exact: true }).click();
    await editorOverlay.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Dataflow' }).click();
    await page.getByTestId('script-edit').first().click();
    const editorDialog = page.getByTestId('script-editor-dialog');
    await editorDialog.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('select 43 as answer');
    await editorDialog.locator('.cm-content').filter({ hasText: 'select 43 as answer' }).waitFor();
    await page.getByTestId('script-editor-dialog-close').click();
    await editorDialog.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Feed' }).click();
    await scriptEditor(page, 'select 43 as answer').waitFor();
    await navigate();
    await scriptEditor(page, 'select 43 as answer').waitFor();
}

/// The storage of the session, the navbar and the color scheme
async function testAppChrome(page, navigate) {
    await openSessionWithQuery(page, navigate);

    await page.getByTestId('session-row-menu').first().click();
    await page.locator('[data-testid="session-menu-item"][data-action="storage"]').click();
    await page.getByText('Session Storage').waitFor();
    await page.getByRole('button', { name: 'close-overlay' }).click();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Client' }).click();
    await page.getByText('Logs', { exact: true }).waitFor();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /^Version/ }).click();
    await page.getByText('Current Version').waitFor();
    await page.keyboard.press('Escape');

    await page.getByTestId('agent-settings').click();
    await page.getByText('Looking for the server').waitFor();
    await page.keyboard.press('Escape');

    const scheme = await page.locator('html').getAttribute('data-color-scheme');
    await page.getByTestId('color-scheme-toggle').click();
    await page.waitForFunction(previous => document.documentElement.dataset.colorScheme !== (previous ?? undefined), scheme);
}

/// The catalog tree follows statements of scripts: a table shows once a script created it, and is gone once another
/// script dropped it, although the first script still declares it
async function testAppCatalogFollowsStatements(page, navigate) {
    await navigate('/');
    await page.getByTestId('composer-send').waitFor();
    const send = async (text, label) => {
        await page.locator('.cm-content').last().click();
        await page.keyboard.type(text);
        await page.getByTestId('composer-send').click();
        await scriptEditor(page, label).waitFor();
    };
    await send('create table page_catalog_session (page_column int)', 'page_catalog_session');
    const tree = page.getByLabel('Connections and catalogs');
    const table = tree.getByText('page_catalog_session');
    for (const name of ['Expand hyper', 'Expand public']) {
        const row = tree.getByRole('button', { name, exact: true });
        await row.waitFor({ timeout: 30_000 });
        await row.click();
    }
    await table.first().waitFor({ state: 'attached', timeout: 30_000 });
    await send('drop table page_catalog_session', 'drop table page_catalog_session');
    await table.first().waitFor({ state: 'detached', timeout: 30_000 });
}

/// The link of a session opens a second session with its script
async function testAppSharedSession(page, navigate) {
    await openSessionWithQuery(page, navigate);
    await page.getByTestId('share-url').click();
    const field = page.locator('input[disabled]').first();
    await page.waitForFunction(element => element.value.length > 0, await field.elementHandle());
    const link = new URL(await field.inputValue());
    await navigate(`/${link.search}`);
    await page.getByTestId('session-row-menu').nth(1).waitFor();
    await scriptEditor(page, 'select 42 as answer').waitFor();
}

/// The warning on a narrow screen, then the app with the workbench in a drawer
async function testAppNarrow(page, navigate) {
    await navigate('/');
    await page.getByRole('heading', { name: 'Narrow Screen' }).waitFor();
    await page.getByRole('button', { name: 'Enable Narrow Screen Layout' }).click();
    await page.getByTestId('open-workbench').click();
    await page.getByRole('heading', { name: 'Sessions' }).last().waitFor();
}

/// Firefox under Playwright fires `cancel` on a file input when the test intercepts its chooser, before the test picks
/// the files. A page would take that as a cancelled selection, so it does not get to listen for it.
async function ignoreFileInputCancel(page) {
    await page.addInitScript(() => {
        const addEventListener = HTMLInputElement.prototype.addEventListener;
        HTMLInputElement.prototype.addEventListener = function (type, ...args) {
            if (type === 'cancel' && this.type === 'file') return;
            addEventListener.call(this, type, ...args);
        };
    });
}

/// Run a query in the shell, see its result and find it in the query history, then mount a file
async function testShell(page, navigate) {
    await ignoreFileInputCancel(page);
    await navigate('/shell.html');
    const input = page.getByRole('textbox', { name: 'HyperDB shell input' });
    await input.waitFor({ state: 'attached' });
    await input.focus();
    await page.keyboard.type('select 42 as answer;');
    await page.keyboard.press('Enter');
    // The result opens in the overlay, the screen reader rows of the terminal have the status line
    const result = page.getByRole('dialog', { name: 'Shell query results' });
    await result.getByRole('gridcell', { name: '42' }).waitFor();
    await page.getByRole('listitem').filter({ hasText: 'Query completed (1 row)' }).waitFor({ state: 'attached' });
    // Escape returns to the prompt, and the result opens again
    await page.keyboard.press('Escape');
    await result.waitFor({ state: 'detached' });
    await page.keyboard.type('.last');
    await page.keyboard.press('Enter');
    await result.getByRole('gridcell', { name: '42' }).waitFor();
    await page.keyboard.press('Escape');
    await result.waitFor({ state: 'detached' });

    await page.getByRole('button', { name: 'Client' }).click();
    await page.getByLabel('Query history').click();
    await page.getByText('Shell Query', { exact: true }).waitFor();
    // The analysis of the result that the overlay shows is listed as well
    await page.getByText(/^succeeded$/i).first().waitFor();
    await page.keyboard.press('Escape');

    await input.focus();
    // The catalog follows statements: the shell completes a table that a statement created, with its columns
    const noResults = page.getByRole('listitem').filter({ hasText: /^\W*No results\W*$/ });
    await page.keyboard.type('create table page_catalog_orders (order_id int);');
    await page.keyboard.press('Enter');
    await noResults.nth(0).waitFor({ state: 'attached' });
    await page.keyboard.type('alter table page_catalog_orders add column order_total int;');
    await page.keyboard.press('Enter');
    await noResults.nth(1).waitFor({ state: 'attached' });
    await page.keyboard.type('select order_total from page_catalog_or');
    await page.keyboard.press('Tab');
    await page.keyboard.type(';');
    await page.keyboard.press('Enter');
    await page.getByRole('listitem').filter({ hasText: 'select order_total from page_catalog_orders;' }).first().waitFor({ state: 'attached', timeout: 30_000 });
    await result.waitFor();
    await page.keyboard.press('Escape');
    await result.waitFor({ state: 'detached' });
    await page.keyboard.type('.fs');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Mount filesystem entry' }).click();
    await page.getByRole('heading', { name: 'Filesystem Mount' }).waitFor();
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByRole('dialog').getByText('File', { exact: true }).click(),
    ]);
    await chooser.setFiles({ name: 'answers.csv', mimeType: 'text/csv', buffer: Buffer.from('answer\n42\n') });
    await page.getByRole('heading', { name: 'Mount Path' }).waitFor();
    await page.getByRole('button', { name: 'Mount', exact: true }).click();
    await page.getByRole('dialog').getByText('/mnt/external/answers.csv', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close filesystem', exact: true }).click();

    await page.getByTestId('shell-reset').click();
    await input.waitFor({ state: 'attached' });
}

/// The index of the demos and their pages. The routes are hashes, going back keeps the document.
async function testDemos(page, navigate) {
    await navigate('/demos.html');
    await page.getByRole('link', { name: /Stock Analysis/ }).click();
    const board = page.getByTestId('live-board');
    await board.getByRole('row').nth(2).click();
    await page.getByTestId('stat-rows').getByText(/\d/).waitFor();
    await page.getByRole('button', { name: '100/s' }).click();
    await page.goBack();

    await page.getByRole('link', { name: /UI Foundations/ }).click();
    await page.getByText('UI Design System', { exact: true }).waitFor();
    await page.goBack();

    await page.getByRole('link', { name: /Wobble/ }).click();
    await page.getByRole('heading', { name: 'Wobble' }).waitFor();
    await page.getByRole('button', { name: 'Dark' }).click();
    await page.getByRole('button', { name: 'Logo' }).click();
}

/// The redirect page of OAuth without a provider response
async function testOAuth(page, navigate) {
    await navigate('/oauth.html');
    await page.getByText('Authorization Failed').waitFor();
}

const DESKTOP = { viewport: { width: 1280, height: 720 } };
const NARROW = { viewport: { width: 420, height: 800 } };

const PAGE_TESTS = [
    { name: 'app_session', options: DESKTOP, test: testAppSession },
    { name: 'app_greeter', options: DESKTOP, test: testAppGreeter },
    { name: 'app_wrapped_script', options: DESKTOP, test: testAppWrappedScript },
    { name: 'app_chrome', options: DESKTOP, test: testAppChrome },
    { name: 'app_catalog', options: DESKTOP, test: testAppCatalogFollowsStatements },
    { name: 'app_shared_session', options: DESKTOP, test: testAppSharedSession },
    { name: 'app_narrow', options: NARROW, test: testAppNarrow },
    { name: 'shell', options: DESKTOP, test: testShell },
    { name: 'demos', options: DESKTOP, test: testDemos },
    { name: 'oauth', options: DESKTOP, test: testOAuth },
];

/// The release manifest of the version check, the tests don't reach the network
const RELEASE_MANIFEST = JSON.stringify({
    release_id: 'test',
    pub_date: '2026-01-01T00:00:00Z',
    version: '0.0.1',
    git_commit_hash: '0000000',
    git_commit_url: 'https://github.com/ankoh/dashql',
    update_manifest_url: 'https://get.dashql.app/update.json',
    bundles: [],
});

/// Run the tests of the pages.
/// Returns the failures and the V8 coverage of the pages if `collectCoverage` is set.
export async function runPageTests(browser, origin, { collectCoverage, outputs }) {
    const failures = [];
    const scriptCoverages = [];
    for (const { name, options, test } of PAGE_TESTS) {
        const context = await browser.newContext(options);
        await context.addInitScript(() => {
            const getContext = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
                return kind.startsWith('webgl') ? null : getContext.call(this, kind, ...args);
            };
        });
        const page = await context.newPage();
        page.setDefaultTimeout(PAGE_TIMEOUT);
        const errors = [];
        await context.route(url => url.origin !== origin, route => {
            const url = new URL(route.request().url());
            if (url.hostname === 'get.dashql.app') {
                return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: RELEASE_MANIFEST });
            }
            errors.push(`Unexpected request: ${route.request().url()}`);
            return route.abort();
        });
        // The local agent server, a machine that runs the tests may have a real one. It is not there for the tests.
        await context.routeWebSocket(/^ws:\/\/127\.0\.0\.1:47100\//, socket => socket.close());
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        page.on('pageerror', error => errors.push(error.stack ?? error.message));
        const profiler = collectCoverage ? await context.newCDPSession(page) : null;
        if (profiler) {
            await profiler.send('Profiler.enable');
            await profiler.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
        }
        // The counters of the scripts of a document are gone after it navigated, so they are taken before
        const takeCoverage = async () => {
            if (profiler) scriptCoverages.push(...(await profiler.send('Profiler.takePreciseCoverage')).result);
        };
        /// Load a path of the origin, or reload the page without a path
        const navigate = async path => {
            await takeCoverage();
            await (path == null ? page.reload() : page.goto(`${origin}${path}`));
        };
        try {
            await test(page, navigate);
            if (errors.length > 0) failures.push(`${name}: the page logged errors:\n${errors.join('\n')}`);
        } catch (error) {
            if (outputs) await page.screenshot({ path: join(outputs, `page_${name}.png`) }).catch(() => { });
            failures.push(`${name}: ${error.stack ?? error.message}${errors.length > 0 ? `\nThe page logged errors:\n${errors.join('\n')}` : ''}`);
        }
        await takeCoverage();
        await context.close();
    }
    return { failures, scriptCoverages };
}
