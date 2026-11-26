// Tests of the real pages of the bundle: index.html, shell.html, demos.html, embed.html, oauth.html and tools.html.
//
// Their entry points call createRoot when they are imported, so a test in the test frame can't load them, and tests in
// the frame replace parts of the composition with fakes. These tests boot the pages like a browser does, with the
// headers and the Content-Security-Policy of the deployment. Every test has a browser context of its own, the tests in
// the frame share an origin and would see its storage and its app ownership lock otherwise.
//
// A test fails if the page logs a console error, throws, or does not reach the state that the test waits for.
//
// The pages run without WebGL, they have to work on machines without it.

import { join } from 'node:path';

/// A page has to boot the core and Hyper
const PAGE_TIMEOUT = 60_000;

/// The editor with the script of a workbook that holds the text
const scriptEditor = (page, text) => page.locator('.cm-content').filter({ hasText: text });

/// Wait until the query of the script cell is done, in a workbook with a single one.
/// A failed query fails the test right away with its message, it doesn't wait for a timeout.
/// The query gets the time of a page: the first query of a page also waits for Hyper to boot.
async function waitForQuery(page) {
    const done = page.locator('[data-testid="entry-status"]:is([data-status="succeeded"], [data-status="failed"])');
    await done.waitFor();
    if (await done.getAttribute('data-status') !== 'succeeded') throw new Error(`The query failed: ${await done.textContent()}`);
}

/// Wait until the send button of the composer runs the draft. Until the connection of the draft is online, the first one
/// also waits for Hyper to boot, the button is the "Connect to run" button: a click only points at the connection and the
/// draft stays.
async function waitForComposerSend(page) {
    await page.locator('[data-testid="composer-send"]:not([data-connect])').waitFor();
}

/// Click a target that the completion list of the focused editor may cover. The list can open after an Escape that
/// came too early, so the click dismisses it as long as it shows.
async function clickPastCompletion(page, target) {
    const completion = page.locator('[data-dashql-completion-list]');
    const deadline = Date.now() + PAGE_TIMEOUT;
    for (;;) {
        if (await completion.isVisible()) await page.keyboard.press('Escape');
        try {
            await target.click({ timeout: 1000 });
            return;
        } catch (error) {
            if (Date.now() > deadline) throw error;
        }
    }
}

/// Run a query from the composer of the greeter, its first script creates the workbook
async function sendFromComposer(page, text) {
    await waitForComposerSend(page);
    await page.locator('.cm-content').first().click();
    await page.keyboard.insertText(text);
    await page.getByTestId('composer-send').click();
    await waitForQuery(page);
}

/// Open the app and run a query in the composer of the new workbook
async function openWorkbookWithQuery(page, navigate) {
    await navigate('/');
    await sendFromComposer(page, 'select 42 as answer');
    // The result card counts the rows, the bar of Wobble tells them too
    await page.getByText(/^1 row\b/).first().waitFor();
    await page.getByText('42', { exact: true }).last().waitFor();
}

/// The pathname of the page
const pathnameOf = page => new URL(page.url()).pathname;

/// Wait until the storage wrote a script with the text to OPFS. The writer debounces the edits, and a reload doesn't
/// wait for the write that the page starts when it goes away; a slow machine loses it.
/// Only the `.sql` files count: Chromium writes into a swap file `<name>.crswap` and moves it over the script when the
/// write closes, a reload before that keeps the old script.
async function waitForScriptWrite(page, text) {
    await page.waitForFunction(async text => {
        const root = await navigator.storage.getDirectory();
        const workbooks = await root.getDirectoryHandle('workbooks').catch(() => null);
        for await (const workbook of workbooks?.values() ?? []) {
            if (workbook.kind !== 'directory') continue;
            const scripts = await workbook.getDirectoryHandle('scripts').catch(() => null);
            for await (const script of scripts?.values() ?? []) {
                if (script.kind === 'file' && script.name.endsWith('.sql') && (await (await script.getFile()).text()).includes(text)) return true;
            }
        }
        return false;
    }, text, { polling: 100 });
}

/// A long line wraps in the card of the feed, the editor is as high as its text and does not scroll sideways.
/// An editor that measured before the list had a width would stay thousands of pixels too high.
async function testAppWrappedScript(page, navigate) {
    await navigate('/');
    const columns = Array.from({ length: 30 }, (_, i) => `1 as column_${i}_with_a_long_name`);
    await sendFromComposer(page, `select ${columns.join(', ')};`);
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

/// The greeter at the root: a workbook only appears with its first script, a reload stays in it, the brand goes back
async function testAppGreeter(page, navigate) {
    const expectGreeter = async () => {
        await page.getByTestId('feed-landing-wobble').waitFor();
        await page.getByTestId('workbook-ephemeral-row').waitFor();
        if (pathnameOf(page) !== '/') throw new Error(`The greeter is at ${page.url()}`);
        if (!await page.getByTestId('create-workbook').isDisabled()) throw new Error('The greeter can jump to itself');
    };
    await navigate('/');
    await expectGreeter();
    if (await page.getByTestId('workbook-row-menu').count() !== 0) throw new Error('The greeter created a workbook');
    // A reload doesn't create a workbook either
    await navigate();
    await expectGreeter();
    if (await page.getByTestId('workbook-row-menu').count() !== 0) throw new Error('The reload created a workbook');

    await sendFromComposer(page, 'select 42 as answer');
    await page.waitForURL(url => url.pathname.startsWith('/workbooks/'));
    const workbookPathname = pathnameOf(page);
    await page.getByTestId('workbook-row-menu').waitFor();
    await page.getByTestId('workbook-ephemeral-row').waitFor();

    await waitForScriptWrite(page, 'select 42 as answer');
    await navigate();
    await scriptEditor(page, 'select 42 as answer').waitFor();
    if (pathnameOf(page) !== workbookPathname) throw new Error(`The reload left the workbook for ${page.url()}`);

    await page.getByTestId('brand-home').click();
    await expectGreeter();
    await page.getByTestId('workbook-row-menu').waitFor();
    // The workbook is one step back
    await page.goBack();
    await scriptEditor(page, 'select 42 as answer').waitFor();
    await page.getByTestId('create-workbook').click();
    await expectGreeter();
    await page.goBack();
    await scriptEditor(page, 'select 42 as answer').waitFor();
    await page.getByTestId('workbook-ephemeral-row').locator('button').click();
    await expectGreeter();
    // Opening the app at the root greets as well, with workbooks in the list
    await navigate('/');
    await expectGreeter();
    await page.getByTestId('workbook-row-menu').waitFor();
}

/// The views of a workbook on the real providers: the dashboard, the dataflow canvas and its editor dialog.
/// An edit in the dialog is still there after a reload.
async function testAppWorkbook(page, navigate) {
    await openWorkbookWithQuery(page, navigate);

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
    await waitForScriptWrite(page, 'select 43 as answer');
    await navigate();
    await scriptEditor(page, 'select 43 as answer').waitFor();
}

/// The web app has no agents: AI tells the user to switch to the desktop app, the draft stays for SQL
async function testAppAgentWeb(page, navigate) {
    await navigate('/');
    await waitForComposerSend(page);
    const editor = page.locator('[data-testid="composer-prompt"] .cm-content');
    await editor.click();
    await page.keyboard.insertText('select 7 as answer');
    await clickPastCompletion(page, page.locator('[data-testid="composer-mode"][data-mode="ai"]'));
    const notice = page.getByTestId('composer-agent-desktop');
    await notice.waitFor();
    if (!(await notice.textContent()).includes('desktop app')) throw new Error(`The notice tells ${await notice.textContent()}`);
    if (await page.getByTestId('composer-agent-harness').count() !== 0) throw new Error('The web app offers harnesses');
    if (await editor.isVisible()) throw new Error('The editor shows in AI');
    await page.locator('[data-testid="composer-mode"][data-mode="sql"]').click();
    await notice.waitFor({ state: 'detached' });
    await waitForComposerSend(page);
    await page.getByTestId('composer-send').click();
    await scriptEditor(page, 'select 7 as answer').waitFor();
}

/// The storage of the workbook, the navbar and the color scheme
async function testAppChrome(page, navigate) {
    await openWorkbookWithQuery(page, navigate);

    await page.getByTestId('workbook-row-menu').first().click();
    await page.locator('[data-testid="workbook-menu-item"][data-action="storage"]').click();
    await page.getByText('Workbook Storage').waitFor();
    await page.getByRole('button', { name: 'close-overlay' }).click();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Client' }).click();
    await page.getByText('Logs', { exact: true }).waitFor();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /^Version/ }).click();
    await page.getByText('Current Version').waitFor();
    await page.keyboard.press('Escape');

    const scheme = await page.locator('html').getAttribute('data-color-scheme');
    await page.getByTestId('color-scheme-toggle').click();
    await page.waitForFunction(previous => document.documentElement.dataset.colorScheme !== (previous ?? undefined), scheme);
}

/// The catalog tree follows statements of scripts: a table shows once a script created it, and is gone once another
/// script dropped it, although the first script still declares it
async function testAppCatalogFollowsStatements(page, navigate) {
    await navigate('/');
    await waitForComposerSend(page);
    const send = async (text, label) => {
        await page.locator('.cm-content').last().click();
        await page.keyboard.type(text);
        await page.getByTestId('composer-send').click();
        await scriptEditor(page, label).waitFor();
    };
    await send('create table page_catalog_workbook (page_column int)', 'page_catalog_workbook');
    const tree = page.getByLabel('Connections and catalogs');
    const table = tree.getByText('page_catalog_workbook');
    for (const name of ['Expand hyper', 'Expand public']) {
        const row = tree.getByRole('button', { name, exact: true });
        await row.waitFor({ timeout: 30_000 });
        await row.click();
    }
    await table.first().waitFor({ state: 'attached', timeout: 30_000 });
    await send('drop table page_catalog_workbook', 'drop table page_catalog_workbook');
    await table.first().waitFor({ state: 'detached', timeout: 30_000 });
}

/// The link of a workbook opens a second workbook with its script, without the workbench until it is shown
async function testAppSharedWorkbook(page, navigate) {
    await openWorkbookWithQuery(page, navigate);
    await page.getByTestId('workbook-actions').click();
    await page.locator('[data-testid="workbook-action"][data-action="share-url"]').click();
    const field = page.locator('input[disabled]').first();
    await page.waitForFunction(element => element.value.length > 0, await field.elementHandle());
    const link = new URL(await field.inputValue());
    await navigate(`/${link.search}`);
    await scriptEditor(page, 'select 42 as answer').waitFor();
    const toggle = page.getByTestId('workbench-toggle');
    await page.locator('[data-testid="workbench-toggle"][aria-expanded="false"]').waitFor();
    await toggle.click();
    await page.getByTestId('workbook-row-menu').nth(1).waitFor();
}

/// The script of a feed row in the scroll test, the chart makes its card much taller once it has a result.
/// Its long line wraps, CodeMirror estimates it far above its height until the editor is inside of the window.
/// The line is long but the result has two columns, 24 more columns made the run 4x slower and the CI run out of time.
const scrollTestScript = i => `/**
 * @vis vegalite {"mark": "bar", "encoding": {"x": {"field": "k", "type": "nominal"}, "y": {"field": "v", "type": "quantitative"}}}
 */
select k, k * ${i + 1}${Array.from({ length: 24 }, (_, c) => ` + k * ${c} - k * ${c}`).join('')} as v from generate_series(1, 4) as t(k)`;

/// The rows above the viewport get taller while the feed scrolls up, the rows in the viewport only follow the scrolling.
/// The rows at the start of the feed are unmounted while their results arrive, a row that mounts again is measured far
/// above its cached height. The list positions its rows with transforms, so the browser does not anchor it.
/// A row that enters the viewport keeps its height, the editor of its script measures itself only inside of the window.
async function testAppFeedScrollPosition(page, navigate) {
    await navigate('/');
    await waitForComposerSend(page);
    await page.locator('.cm-content').first().click();
    await page.keyboard.insertText(scrollTestScript(0));
    await page.getByTestId('composer-send').click();
    const rows = page.getByTestId('script-feed-item');
    await rows.first().waitFor();
    // The chart of the first script makes its card taller, the scripts are added once it is there
    await waitForQuery(page);
    // The add buttons create scripts that did not run. A created script comes into view, the rows at the start unmount.
    // The rows move while the feed follows a created script and measures its editor: a mouse click that Playwright
    // aimed before a row moved lands next to the button, and the page does nothing. The click goes to the button.
    const scriptCount = 30;
    for (let i = 1; i < scriptCount; ++i) {
        const last = rows.last();
        const lastKey = await last.getAttribute('data-script-key');
        await last.getByTestId('script-insert-below').dispatchEvent('click');
        await page.waitForFunction(key => {
            const items = document.querySelectorAll('[data-testid="script-feed-item"]');
            return items.length > 0 && items[items.length - 1].dataset.scriptKey !== key;
        }, lastKey).catch(async error => {
            const keys = await rows.evaluateAll(items => items.map(item => item.dataset.scriptKey));
            throw new Error(`Adding script ${i + 1} after script ${lastKey} left the rows ${keys.join(', ')}: ${error.message}`);
        });
        await rows.last().locator('.cm-content').click();
        await page.keyboard.insertText(scrollTestScript(i));
        await scriptEditor(page, `k * ${i + 1} + k * 0`).waitFor();
    }

    // The wheel stops the feed from following the created script
    const box = await page.getByTestId('feed-list').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 100);

    // The feed stays at its end during the run, the rows at its start stay unmounted while their results arrive.
    // The scroll element is the list in the feed, a row may unmount between finding it and evaluating on it.
    const feedList = page.getByTestId('feed-list');
    const unpin = await feedList.evaluateHandle(container => {
        const list = [...container.children].find(child => getComputedStyle(child).overflowY === 'auto');
        let pinned = true;
        const pin = () => {
            if (!pinned) return;
            list.scrollTop = list.scrollHeight;
            requestAnimationFrame(pin);
        };
        pin();
        return () => { pinned = false; };
    });
    await page.getByTestId('execute-all').click();
    await page.locator('[data-testid="execution-status"][data-phase="succeeded"]').waitFor();
    await unpin.evaluate(stop => stop());

    const { maxMoved, movedRow, anchored } = await feedList.evaluate(async container => {
        const STEP = 200;
        const FRAMES_PER_STEP = 3;
        const list = [...container.children].find(child => getComputedStyle(child).overflowY === 'auto');
        const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
        // A task that a frame posts runs after its paint, it sees what the user saw
        const afterPaint = () => new Promise(resolve => {
            const channel = new MessageChannel();
            channel.port1.onmessage = resolve;
            channel.port2.postMessage(0);
        });
        const measure = () => {
            const listTop = list.getBoundingClientRect().top;
            const measured = new Map();
            for (const row of list.querySelectorAll('[data-testid="script-feed-item"]')) {
                const rect = row.getBoundingClientRect();
                measured.set(row.dataset.scriptKey, { top: rect.top - listTop, bottom: rect.bottom - listTop });
            }
            return { scrollTop: list.scrollTop, rows: measured };
        };
        // The wheel of the test scrolls a few frames later
        for (let stable = 0, scrollTop = list.scrollTop; stable < 10; ++stable) {
            await nextFrame();
            if (list.scrollTop !== scrollTop) {
                scrollTop = list.scrollTop;
                stable = 0;
            }
        }
        let maxMoved = 0;
        let movedRow = null;
        let anchored = 0;
        let previous = measure();
        for (let frame = 0; list.scrollTop >= STEP; ++frame) {
            await nextFrame();
            const step = frame % FRAMES_PER_STEP === 0 ? STEP : 0;
            list.scrollTop -= step;
            await afterPaint();
            const next = measure();
            anchored += next.scrollTop - previous.scrollTop + step;
            for (const [key, row] of previous.rows) {
                const followed = next.rows.get(key);
                if (followed == null || row.bottom <= 0 || row.top >= list.clientHeight) continue;
                const moved = Math.abs(followed.top - row.top - step);
                if (moved > maxMoved) {
                    maxMoved = moved;
                    movedRow = key;
                }
            }
            previous = next;
        }
        return { maxMoved, movedRow, anchored };
    });
    if (maxMoved > 1) throw new Error(`The row ${movedRow} in the viewport moved ${maxMoved}px on the screen while the feed scrolled`);
    if (anchored <= 0) throw new Error('No row above the viewport changed its height, the test did not check anything');
}

/// Find what a window drag gets wrong in the bars at the top of the window, once content scrolled behind them.
/// Follows the region that Electron hit-tests: the boxes with an app region in tree order, unclipped, later ones win.
/// `ELECTRON_DEBUG_DRAGGABLE_REGIONS` logs the real one, see docs/design/electron.md.
const findDragRegionErrors = page => page.evaluate(() => {
    const regions = [];
    const collect = element => {
        const style = getComputedStyle(element);
        if (style.display === 'none') return;
        const region = style.getPropertyValue('-webkit-app-region');
        // Only boxes count, an inline element is none unless it is replaced
        const isBox = style.display !== 'inline' || ['svg', 'img', 'canvas'].includes(element.localName);
        if (region !== 'none' && isBox && style.visibility === 'visible') {
            regions.push({ drag: region === 'drag', rect: element.getBoundingClientRect() });
        }
        for (const child of element.children) collect(child);
    };
    collect(document.documentElement);
    const isDraggable = (x, y) => regions.reduce((drag, { drag: next, rect }) =>
        x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom ? next : drag, false);

    const bars = [...document.querySelectorAll('header[data-electron-drag-region]')];
    const errors = bars.length > 0 ? [] : ['Expected the bars of the window, found none'];
    for (const bar of bars) {
        const rect = bar.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        let free = 0;
        for (let x = rect.left + 1; x < rect.right; x += 4) {
            if (document.elementFromPoint(x, y) !== bar) continue;
            ++free;
            if (!isDraggable(x, y)) errors.push(`The bar at y=${y} does not drag at x=${x}`);
        }
        if (free === 0) errors.push(`The bar at y=${y} has no free space`);
        for (const button of bar.querySelectorAll('button')) {
            const box = button.getBoundingClientRect();
            if (box.width > 0 && isDraggable(box.left + box.width / 2, box.top + box.height / 2)) {
                errors.push(`The button ${button.textContent} of the bar at y=${y} drags the window`);
            }
        }
    }
    return errors;
});

/// The bars at the top of the window drag it, also when no-drag content scrolled behind them.
/// Firefox and WebKit know neither app regions nor reading-flow. A persistent context of WebKit has no browser(), the
/// driver names the browser instead.
async function testAppDragRegions(page, navigate) {
    if ((process.env.DASHQL_BROWSER ?? 'chromium') !== 'chromium') return;
    await navigate('/');
    // 200 lines but one column, the analysis of a result with 200 columns took longer than the test on CI
    await sendFromComposer(page, `select\n${Array.from({ length: 200 }, (_, i) => i).join(' +\n')} as total;`);

    // The row reaches behind both bars when the feed follows its end
    const cell = page.getByTestId('script-cell').first();
    await cell.evaluate(element => {
        let list = element.parentElement;
        while (getComputedStyle(list).overflowY !== 'auto') list = list.parentElement;
        list.scrollTop = element.getBoundingClientRect().height / 2;
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="script-cell"]').getBoundingClientRect().top < 0);
    const errors = await findDragRegionErrors(page);
    if (errors.length > 0) throw new Error(`${errors.length} errors, the first ones:\n${errors.slice(0, 5).join('\n')}`);

    // The bars come last in the DOM, the keyboard still goes from the stripe to the rail to the view bar
    await page.getByTestId('color-scheme-toggle').focus();
    await page.keyboard.press('Tab');
    if (!await page.evaluate(() => document.activeElement?.closest('nav[aria-label="Areas"]') != null)) {
        throw new Error('Tab does not move from the top bar to the rail');
    }
    await page.getByRole('navigation', { name: 'Areas' }).getByRole('button').last().focus();
    await page.keyboard.press('Tab');
    if (!await page.evaluate(() => document.activeElement?.closest('header[data-electron-drag-region]') != null)) {
        throw new Error('Tab does not move from the rail to the view bar');
    }
}

/// The warning on a narrow screen, then the app with the workbench in a drawer
async function testAppNarrow(page, navigate) {
    await navigate('/');
    await page.getByRole('heading', { name: 'Narrow Screen' }).waitFor();
    await page.getByRole('button', { name: 'Enable Narrow Screen Layout' }).click();
    await page.getByTestId('open-workbench').click();
    await page.getByRole('heading', { name: 'Workbooks' }).last().waitFor();
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

    await page.getByRole('link', { name: /^Wobble Wobble glances/ }).click();
    await page.getByRole('heading', { name: 'Wobble' }).waitFor();
    await page.getByRole('button', { name: 'Dark' }).click();
    await page.getByRole('button', { name: 'Logo' }).click();
}

/// The embed starts the core and Hyper in their workers and runs its query in both
async function testEmbed(page, navigate) {
    await navigate('/embed.html');
    await page.waitForFunction(() => globalThis.__DASHQL_EMBED__?.done === true);
    const probe = await page.evaluate(() => globalThis.__DASHQL_EMBED__);
    if (probe.environment.crossOriginIsolated !== 'true') throw new Error('The embed is not isolated');
    const failed = probe.steps.filter(step => !step.ok);
    if (failed.length > 0) throw new Error(`The embed failed: ${JSON.stringify(failed)}`);
    if (!probe.steps.some(step => /n=\d+/.test(step.detail))) throw new Error(`Hyper returned ${JSON.stringify(probe.steps)}`);
}

/// The unpacker tool on the tools page. The browser tests of the app read real archives, the page only boots and reports
/// a file that is no archive.
async function testUnpackerTool(page, navigate) {
    await navigate('/tools.html#/unpacker');
    await page.getByRole('heading', { name: 'Unpacker' }).waitFor();
    await page.getByRole('button', { name: /Drop a \.dashql file/ }).waitFor();
    await page.getByLabel('Open a .dashql file').setInputFiles({ name: 'script.sql', mimeType: 'text/plain', buffer: Buffer.from('select 1;') });
    await page.getByRole('alert').filter({ hasText: 'script.sql is not a ZIP archive' }).waitFor();
}

/// The analyzer tool on the tools page: the scripts are scanned, parsed and analyzed against the catalog script
async function testAnalyzerTool(page, navigate) {
    await navigate('/tools.html#/analyzer');
    await page.getByRole('heading', { name: 'Analyzer' }).waitFor();
    const editorScript = page.getByRole('region', { name: 'Editor Script' });
    await editorScript.getByRole('region', { name: 'Scanner' }).getByText('ps_supplycost', { exact: true }).first().waitFor();
    await editorScript.getByRole('region', { name: 'Analyzer' }).getByText(/(\d+) table refs \(\1 resolved\)/).waitFor();
}

/// The redirect page of OAuth without a provider response
async function testOAuth(page, navigate) {
    await navigate('/oauth.html');
    await page.getByText('Authorization Failed').waitFor();
}

const DESKTOP = { viewport: { width: 1280, height: 720 } };
const NARROW = { viewport: { width: 420, height: 800 } };

const PAGE_TESTS = [
    { name: 'app_workbook', options: DESKTOP, test: testAppWorkbook },
    { name: 'app_greeter', options: DESKTOP, test: testAppGreeter },
    { name: 'app_wrapped_script', options: DESKTOP, test: testAppWrappedScript },
    { name: 'app_chrome', options: DESKTOP, test: testAppChrome },
    { name: 'app_agent_web', options: DESKTOP, test: testAppAgentWeb },
    { name: 'app_catalog', options: DESKTOP, test: testAppCatalogFollowsStatements },
    { name: 'app_shared_workbook', options: DESKTOP, test: testAppSharedWorkbook },
    { name: 'app_feed_scroll_position', options: DESKTOP, test: testAppFeedScrollPosition },
    { name: 'app_drag_regions', options: DESKTOP, test: testAppDragRegions },
    { name: 'app_narrow', options: NARROW, test: testAppNarrow },
    { name: 'shell', options: DESKTOP, test: testShell },
    { name: 'demos', options: DESKTOP, test: testDemos },
    { name: 'embed', options: NARROW, test: testEmbed },
    { name: 'tools_unpacker', options: DESKTOP, test: testUnpackerTool },
    { name: 'tools_analyzer', options: DESKTOP, test: testAnalyzerTool },
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

/// Run the tests of the pages, `concurrency` of them at once.
/// Every test has a browser context of its own, from `newContext(options)`.
/// Returns the failures in the order of the tests, the seconds of every test, and the V8 coverage of the pages if
/// `collectCoverage` is set.
export async function runPageTests(newContext, origin, { collectCoverage, concurrency = 1, outputs }) {
    const results = new Array(PAGE_TESTS.length);
    let next = 0;
    const lane = async () => {
        while (next < PAGE_TESTS.length) {
            const index = next++;
            results[index] = await runPageTest(newContext, origin, PAGE_TESTS[index], { collectCoverage, outputs });
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane));
    return {
        durations: Object.fromEntries(results.map(({ duration }, index) => [PAGE_TESTS[index].name, duration])),
        failures: results.flatMap(({ failure }) => failure == null ? [] : [failure]),
        scriptCoverages: results.flatMap(({ scriptCoverages }) => scriptCoverages),
    };
}

/// Run a test of a page in a browser context of its own
async function runPageTest(newContext, origin, { name, options, test }, { collectCoverage, outputs }) {
    const startedAt = performance.now();
    const scriptCoverages = [];
    let failure = null;
    const context = await newContext(options);
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
        if (errors.length > 0) failure = `${name}: the page logged errors:\n${errors.join('\n')}`;
    } catch (error) {
        if (outputs) await page.screenshot({ path: join(outputs, `page_${name}.png`) }).catch(() => { });
        failure = `${name}: ${error.stack ?? error.message}${errors.length > 0 ? `\nThe page logged errors:\n${errors.join('\n')}` : ''}`;
    }
    await takeCoverage();
    await context.close();
    return { duration: (performance.now() - startedAt) / 1000, failure, scriptCoverages };
}
