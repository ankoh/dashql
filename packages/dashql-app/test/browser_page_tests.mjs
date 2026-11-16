// Tests of the real pages of the bundle: index.html, shell.html, demos.html, embed.html and oauth.html.
//
// Their entry points call createRoot when they are imported, so a test in the test frame can't load them, and tests in
// the frame replace parts of the composition with fakes. These tests boot the pages like a browser does, with the
// headers and the Content-Security-Policy of the deployment. Every test has a browser context of its own, the tests in
// the frame share an origin and would see its storage and its app ownership lock otherwise.
//
// A test fails if the page logs a console error, throws, or does not reach the state that the test waits for.
//
// The pages run without WebGL, they have to work on machines without it.

import assert from 'node:assert/strict';
import http from 'node:http';
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

/// Run a query from the composer of the greeter, its first script creates the workbook
async function sendFromComposer(page, text) {
    await page.getByTestId('composer-send').waitFor();
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
    await page.getByText('1 row, 4 bytes').waitFor();
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

/// A server of the session of an agent, like `dashql session serve`, that streams the states that the test pushes
/// Wait until a condition in the test process holds, e.g. a request reached a server of the test
async function waitUntil(condition, timeout = PAGE_TIMEOUT) {
    const end = Date.now() + timeout;
    while (!condition()) {
        if (Date.now() > end) throw new Error('The condition did not hold in time');
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

/// A server of a session like the one of dashql. It speaks protocol 1 (agent_session_protocol.ts), the page speaks
/// with it until the page needs a newer server; `protocol: null` is a server older than the protocol.
async function startSessionServer({ port = 0, token = 'secret', protocol = 1 } = {}) {
    const streams = new Set();
    let state = { harness: 'claude', folder: '/work', ended: false, turns: [], workbooks: [], log: [], logins: [], version: 0 };
    // The files that the page wrote into the copy of its workbook, in the order of the writes
    const writes = [];
    const broadcast = () => { for (const stream of streams) stream.write(`data: ${JSON.stringify(state)}\n\n`); };
    // The copy, the state names it once it has its workbook file, like the server of dashql
    const files = new Map();
    let results = [];
    // The requests for results, the page fetches them for its query result cache
    const resultRequests = [];
    // The connections that the page let the agent use, in the order it sent them
    const connectionLists = [];
    let clock = 0;
    const announce = workbookId => {
        const named = files.has('dashql-workbook.json')
            ? [{ path: `.dashql/workbooks/${workbookId}`, workbookId, files: [...files].map(([path, file]) => ({ path, size: file.body.length, mtimeMs: file.mtimeMs })), results, running: null }]
            : [];
        state = { ...state, workbooks: named, version: state.version + 1 };
        broadcast();
    };
    const server = http.createServer((request, response) => {
        response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '*');
        if (protocol != null) {
            response.setHeader('X-DashQL-Protocol', String(protocol));
            response.setHeader('X-DashQL-Min-Protocol', '1');
            response.setHeader('Access-Control-Expose-Headers', 'X-DashQL-Protocol, X-DashQL-Min-Protocol');
        }
        if (request.method === 'OPTIONS') {
            // The preflight of the server of dashql
            return response.writeHead(204, {
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-DashQL-Protocol',
                'Access-Control-Allow-Private-Network': 'true',
            }).end();
        }
        const copy = `/v1/workbooks/${encodeURIComponent(token)}/`;
        if ((request.method === 'PUT' || request.method === 'DELETE') && request.url.startsWith(copy)) {
            const [workbookId, ...parts] = request.url.slice(copy.length).split('/').map(decodeURIComponent);
            const chunks = [];
            request.on('data', chunk => chunks.push(chunk));
            request.on('end', () => {
                const path = parts.join('/');
                const body = Buffer.concat(chunks).toString('utf8');
                writes.push({ method: request.method, workbookId, path, body });
                if (request.method === 'PUT') files.set(path, { body, mtimeMs: ++clock });
                else if (path.length > 0) files.delete(path);
                else files.clear();
                announce(workbookId);
                response.writeHead(204).end();
            });
            return;
        }
        if (request.method === 'PUT' && request.url === `/v1/connections/${encodeURIComponent(token)}`) {
            const chunks = [];
            request.on('data', chunk => chunks.push(chunk));
            request.on('end', () => {
                connectionLists.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).connections);
                response.writeHead(204).end();
            });
            return;
        }
        if (request.method === 'GET' && request.url.startsWith(`/v1/results/${encodeURIComponent(token)}/`)) {
            resultRequests.push(request.url.split('/').pop());
            return response.writeHead(404).end();
        }
        if (request.method === 'GET' && request.url.startsWith(copy)) {
            const file = files.get(request.url.slice(copy.length).split('/').slice(1).map(decodeURIComponent).join('/'));
            return file == null ? response.writeHead(404).end() : response.writeHead(200).end(file.body);
        }
        if (request.url !== `/v1/stream?token=${encodeURIComponent(token)}`) return response.writeHead(401).end();
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        response.write(`data: ${JSON.stringify(state)}\n\n`);
        streams.add(response);
        request.on('close', () => streams.delete(response));
    });
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    return {
        port: server.address().port,
        writes,
        resultRequests,
        connectionLists,
        push: next => {
            state = { ...state, ...next, version: state.version + 1 };
            broadcast();
        },
        /// The agent writes a file of the copy
        agentWrites: (workbookId, path, body) => {
            files.set(path, { body, mtimeMs: ++clock });
            announce(workbookId);
        },
        /// The agent ran the copy, the journal names the results
        agentRan: (workbookId, ran) => {
            results = ran;
            announce(workbookId);
        },
        close: () => {
            for (const stream of streams) stream.destroy();
            return new Promise(resolve => server.close(resolve));
        },
    };
}

/// A link of `dashql session hook SessionStart` makes the page follow the session of an agent in the terminal: the bar
/// shows the harness and its questions, the prompt switches to AI and back to SQL. The switch to AI shows the line of
/// `dashql connect`, the page waits on its port and secret.
async function testAppAgentSession(page, navigate) {
    const session = await startSessionServer();
    try {
        await page.context().route(url => url.port === String(session.port), route => route.continue());
        const turn = { turnId: 1, question: 'how many orders', status: 'dashql lint scripts/orders.sql', error: null, note: null, files: ['scripts/orders.sql'] };
        session.push({ turns: [turn] });
        const data = Buffer.from(JSON.stringify({ agentSession: { endpoint: `http://127.0.0.1:${session.port}`, token: 'secret' } })).toString('base64url');
        await navigate(`/?data=${data}`);
        await page.getByTestId('composer-connect-status').getByText('Claude Code works on this workbook in the terminal').waitFor();
        assert.equal(await page.getByTestId('composer-send').count(), 0);
        await page.locator('[data-testid="workbook-agent-state"][data-state="working"]').waitFor();
        // The log opens by itself while the agent works
        await page.getByTestId('composer-agent-turn').getByText('how many orders').waitFor();
        await page.getByRole('status').getByText('dashql lint scripts/orders.sql').first().waitFor();

        session.push({ turns: [{ ...turn, status: null, note: 'There are 42 orders' }] });
        await page.getByRole('note').getByText('There are 42 orders').waitFor();
        await page.locator('[data-testid="workbook-agent-state"][data-state="connected"]').waitFor();

        // SQL opens the prompt, the bar keeps the session
        session.push({ ended: true });
        await page.locator('[data-testid="composer-mode"][data-mode="sql"]').click();
        await page.getByTestId('composer-connect').waitFor({ state: 'detached' });
        await page.getByTestId('composer-agent-turn').getByText('how many orders').waitFor();
    } finally {
        await session.close();
    }

    // A workbook with a script, the next session gets a copy of it
    await sendFromComposer(page, 'select 42 as copied_answer');

    // AI waits on a new port with a new secret, `dashql connect` starts the server there. The page tries the port before.
    await page.context().route(url => url.hostname === '127.0.0.1' && url.port !== new URL(page.url()).port, route => route.continue());
    await page.locator('[data-testid="composer-mode"][data-mode="ai"]').click();
    await page.getByTestId('composer-connect-renew').click();
    await page.locator('[data-testid="composer-connect-harness"][data-harness="codex"]').click();
    const line = await page.getByTestId('composer-connect-command').inputValue();
    const match = /^npx -y @akohn\/dashql-cli@latest connect --launch codex --port (\d+) --secret ([\w-]+)$/.exec(line ?? '');
    assert.ok(match, line);
    // An older dashql-cli answers on the port first: the page tells to run the command again
    const outdated = await startSessionServer({ port: Number(match[1]), token: match[2], protocol: null });
    try {
        await page.getByTestId('composer-connect-status').getByText('The session runs an older dashql-cli, stop it and run the command again').waitFor();
    } finally {
        await outdated.close();
    }
    const connected = await startSessionServer({ port: Number(match[1]), token: match[2] });
    try {
        connected.push({ harness: 'codex' });
        await page.getByTestId('composer-connect-status').getByText('Codex works on this workbook in the terminal').waitFor();
        // The page writes its workbook into the folder of the session: the old copy goes, the workbook file comes last
        await waitUntil(() => connected.writes.some(write => write.path === 'dashql-workbook.json'));
        const { writes } = connected;
        assert.equal(writes[0].method, 'DELETE');
        assert.equal(writes[0].path, '');
        assert.equal(writes[writes.length - 1].path, 'dashql-workbook.json');
        assert.ok(writes.some(write => write.path.startsWith('scripts/') && write.body.includes('select 42 as copied_answer')), JSON.stringify(writes.map(write => write.path)));
        assert.equal(new Set(writes.map(write => write.workbookId)).size, 1);
        // A reload follows the same session and leaves the copy to the agent
        const written = writes.length;
        await page.reload();
        await page.getByTestId('composer-connect-status').getByText('Codex works on this workbook in the terminal').waitFor();
        connected.push({ turns: [] });
        await page.waitForTimeout(500);
        assert.equal(writes.length, written);

        // The user edits the script, the copy gets the edit
        const script = writes.find(write => write.path.startsWith('scripts/'));
        await scriptEditor(page, 'copied_answer').click();
        await page.keyboard.press('End');
        await page.keyboard.insertText(', 43 as more');
        await waitUntil(() => writes.some(write => write.method === 'PUT' && write.path === script.path && write.body.includes('43 as more')));

        // The agent rewrites the script in the copy, the page stages the rewrite to accept
        connected.agentWrites(script.workbookId, script.path, 'select 7 as from_agent');
        await page.getByTestId('diff-accept').click();
        await scriptEditor(page, 'from_agent').waitFor();

        // The agent ran the workbook, the page fetches the result for its query result cache
        const key = 'ab'.repeat(32);
        connected.agentRan(script.workbookId, [{ script: script.path.split('/').pop(), key, rows: 1, error: null, cached: false }]);
        await waitUntil(() => connected.resultRequests.includes(key));

        // The agent may use every connection, the user unticks one
        await waitUntil(() => connected.connectionLists.length > 0);
        const every = connected.connectionLists[connected.connectionLists.length - 1];
        assert.ok(every.length > 0);
        const picker = page.getByTestId('composer-agent-connections');
        await picker.getByText(`${every.length} / ${every.length} connections`).waitFor();
        await picker.click();
        await page.locator(`[data-connection="${every[0].connectionId}"]`).click();
        await waitUntil(() => {
            const last = connected.connectionLists[connected.connectionLists.length - 1];
            return last.length === every.length - 1 && !last.some(connection => connection.connectionId === every[0].connectionId);
        });
        await picker.getByText(`${every.length - 1} / ${every.length} connections`).waitFor();
    } finally {
        await connected.close();
    }
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
    await page.getByTestId('composer-send').waitFor();
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

/// The link of a workbook opens a second workbook with its script
async function testAppSharedWorkbook(page, navigate) {
    await openWorkbookWithQuery(page, navigate);
    await page.getByTestId('share-url').click();
    const field = page.locator('input[disabled]').first();
    await page.waitForFunction(element => element.value.length > 0, await field.elementHandle());
    const link = new URL(await field.inputValue());
    await navigate(`/${link.search}`);
    await page.getByTestId('workbook-row-menu').nth(1).waitFor();
    await scriptEditor(page, 'select 42 as answer').waitFor();
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
    await page.getByTestId('composer-send').waitFor();
    await page.locator('.cm-content').first().click();
    await page.keyboard.insertText(scrollTestScript(0));
    await page.getByTestId('composer-send').click();
    const rows = page.getByTestId('script-feed-item');
    await rows.first().waitFor();
    // The add buttons create scripts that did not run. A created script comes into view, the rows at the start unmount.
    const scriptCount = 30;
    for (let i = 1; i < scriptCount; ++i) {
        const last = rows.last();
        const lastKey = await last.getAttribute('data-script-key');
        await last.hover();
        await last.getByTestId('script-insert-below').click();
        await page.waitForFunction(key => {
            const items = document.querySelectorAll('[data-testid="script-feed-item"]');
            return items[items.length - 1].dataset.scriptKey !== key;
        }, lastKey);
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
    const errors = bars.length === 2 ? [] : [`Expected 2 bars, found ${bars.length}`];
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
/// Firefox knows neither app regions nor reading-flow.
async function testAppDragRegions(page, navigate) {
    if (page.context().browser().browserType().name() !== 'chromium') return;
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
    if (!probe.steps.some(step => step.detail.includes('n=5000000'))) throw new Error(`Hyper returned ${JSON.stringify(probe.steps)}`);
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
    { name: 'app_agent_session', options: DESKTOP, test: testAppAgentSession },
    { name: 'app_catalog', options: DESKTOP, test: testAppCatalogFollowsStatements },
    { name: 'app_shared_workbook', options: DESKTOP, test: testAppSharedWorkbook },
    { name: 'app_feed_scroll_position', options: DESKTOP, test: testAppFeedScrollPosition },
    { name: 'app_drag_regions', options: DESKTOP, test: testAppDragRegions },
    { name: 'app_narrow', options: NARROW, test: testAppNarrow },
    { name: 'shell', options: DESKTOP, test: testShell },
    { name: 'demos', options: DESKTOP, test: testDemos },
    { name: 'embed', options: NARROW, test: testEmbed },
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
        page.on('console', message => {
            if (message.type() !== 'error') return;
            // A page in AI waits on the server of a session that `dashql connect` starts later on another port of
            // this machine, its attempts fail until then. Chrome names the request in the location of the message,
            // Firefox in its text.
            const text = message.text();
            const source = /http:\/\/127\.0\.0\.1:\d+\/v1\/stream\S*/.exec(text)?.[0] ?? message.location().url;
            const waiting = /^Failed to load resource|CORS request did not succeed/.test(text)
                && source.startsWith('http://127.0.0.1:') && new URL(source).origin !== origin;
            if (!waiting) errors.push(text);
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
