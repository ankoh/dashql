import * as arrow from 'apache-arrow';

import { DashQLShell, DashQLShellError, DashQLShellPromptAction, DashQLShellPromptInput, DashQLShellStatus, SHELL_PREVIEW_ROW_LIMIT, type DashQLShellCommand, type DashQLShellEnvironment } from './api.js';
import * as dashql from '@akohn/dashql';
import { vectorFromArray } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { createEmbeddedDatabaseShellEnvironment } from '../page/embedded_database_shell_environment.js';
import { setupWebHyperDB } from '../../host/hyperdb/hyperdb_provider_web.js';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { HyperDB, HyperDBConnection } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { VT100, VT100Command, vt100Sequence } from './vt100.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// Load a script into the catalog of a shell
function loadCatalogScript(shell: DashQLShell, text: string): void {
    const script = shell.core.createScript(shell.catalog);
    script.replaceText(text);
    script.analyze();
    shell.catalog.loadScript(script, dashql.buffers.catalog.CatalogLayer.CONNECTION);
    script.destroy();
}

describe('DashQL shell Wasm', () => {
    let shell: DashQLShell;
    let executeQuery: (query: string, signal?: AbortSignal, onResult?: (queryId: number, rowCount: number) => void) => Promise<void>;

    beforeEach(async () => {
        executeQuery = async () => {
            throw new Error('test database is not configured');
        };
        shell = await DashQLShell.create({
            environment: {
                executeQuery: (query, signal, _onProgress, onResult) => executeQuery(query, signal, onResult),
            },
            terminalColumns: 80,
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
    });

    afterEach(() => shell.destroy());

    it('rejects operations after destruction', () => {
        shell.destroy();
        expect(() => shell.resize(40)).toThrowError(DashQLShellError);
    });

    it('switches keyword completion case without changing catalog names or prompt state', () => {
        loadCatalogScript(shell, 'create table orders(id int);');
        shell.setPrompt('sel');
        expect(shell.completePrompt(50).some(candidate => candidate.completionText === 'select')).toBe(true);
        shell.setKeywordCase(dashql.buffers.formatting.KeywordCase.UPPER);
        expect(shell.completePrompt(50).some(candidate => candidate.completionText === 'SELECT')).toBe(true);
        expect(shell.movePromptLeft().text).toBe('sel');
        shell.setPrompt('select * from ord');
        expect(shell.completePrompt(50).some(candidate => candidate.completionText === 'orders')).toBe(true);
        shell.setKeywordCase(dashql.buffers.formatting.KeywordCase.LOWER);
        shell.setPrompt('sel');
        expect(shell.completePrompt(50).some(candidate => candidate.completionText === 'select')).toBe(true);
    });

    it('completes from the relations and functions of its catalog', () => {
        loadCatalogScript(
            shell,
            'CREATE TABLE sales.orders (order_id BIGINT, amount DOUBLE);',
        );
        loadCatalogScript(
            shell,
            'CREATE FUNCTION sales.discount(DOUBLE) RETURNS DOUBLE;',
        );

        expect(shell.setPrompt('select * from sales.ord')).toMatchObject({
            text: 'select * from sales.ord',
            cursorByteOffset: 'select * from sales.ord'.length,
        });
        const relations = shell.completePrompt(20);
        expect(relations.some(candidate => candidate.displayText.toLowerCase().includes('orders'))).toBe(true);

        expect(() => shell.setPrompt('select sales.discount(1.0);')).not.toThrow();
    });

    it('auto-qualifies non-default database tables on the first Tab when enabled', async () => {
        shell.destroy();
        shell = await DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            terminalColumns: 100,
            autoQualifyNonDefaultDatabaseTables: true,
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        loadCatalogScript(
            shell,
            'CREATE TABLE "Salesforce".public."Account" (id BIGINT);',
        );
        shell.openTerminal('db> ');
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'select * from Acc');
        const candidates = shell.completePrompt(50);
        const candidateIndex = candidates.findIndex(candidate => candidate.completionText === '"Account"');
        expect(candidateIndex).toBeGreaterThanOrEqual(0);
        let selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);
        if (candidateIndex === 0) {
            selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_PREVIOUS);
        } else {
            for (let i = 1; i < candidateIndex; ++i) {
                selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);
            }
        }
        expect(selected.data).toContain('"Salesforce".public.');

        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(shell.movePromptRight().text).toBe('select * from "Salesforce".public."Account"');
    });

    it('keeps automatic table qualification disabled by default', () => {
        loadCatalogScript(
            shell,
            'CREATE TABLE "Salesforce".public."Account" (id BIGINT);',
        );
        shell.openTerminal('db> ');
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'select * from Acc');
        const candidates = shell.completePrompt(50);
        const candidateIndex = candidates.findIndex(candidate => candidate.completionText === '"Account"');
        expect(candidateIndex).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < candidateIndex; ++i) shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);

        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(shell.movePromptRight().text).toBe('select * from "Account"');
    });

    it('reports messages from worker error events', async () => {
        executeQuery = async () => {
            throw {
                message: 'Uncaught RangeError: Maximum call stack size exceeded',
                toString: () => '[object ErrorEvent]',
            };
        };

        await expect(shell.executeQuery('SELECT * FROM large_file')).resolves.toBe(
            'Uncaught RangeError: Maximum call stack size exceeded\r\n',
        );
    });

    it('submits the prompt through the asynchronous effect interface', async () => {
        executeQuery = async query => {
            expect(query).toBe('SELECT 42');
            throw new Error('backend unavailable');
        };
        shell.setPrompt('SELECT 42;');
        await expect(shell.submitPrompt()).resolves.toBe('backend unavailable\r\n');
    });

    it('forwards query progress through the asynchronous effect interface', async () => {
        const progress = vi.fn();
        shell.destroy();
        shell = await DashQLShell.create({
            environment: {
                executeQuery: async (_query, _signal, onProgress) => {
                    onProgress?.('Executing query');
                    throw new Error('expected');
                },
            },
            terminalColumns: 80,
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        shell.setPrompt('SELECT 42;');

        await expect(shell.submitPrompt(undefined, progress)).resolves.toBe('expected\r\n');
        expect(progress).toHaveBeenCalledWith('Executing query');
    });

    it('forwards successful query result handles through the asynchronous effect interface', async () => {
        const result = vi.fn();
        shell.destroy();
        shell = await DashQLShell.create({
            environment: {
                executeQuery: async (_query, _signal, _onProgress, onResult) => {
                    onResult?.(42, 1);
                },
            },
            terminalColumns: 80,
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        shell.setPrompt('SELECT 42;');

        await expect(shell.submitPrompt(undefined, undefined, result)).resolves.toBe('Query completed (1 row)\r\n');
        expect(result).toHaveBeenCalledWith(42, 1, false);
    });

    it('strips only the trailing shell terminator before execution', async () => {
        executeQuery = async query => {
            expect(query).toBe("SELECT ';' AS value");
            throw new Error('expected');
        };
        const prompt = "SELECT ';' AS value;  \n";
        shell.setPrompt(prompt);
        await expect(shell.submitPrompt()).resolves.toBe('expected\r\n');
        expect(new TextDecoder().decode(shell.exportHistory()).endsWith(prompt)).toBe(true);
    });

    it('renders terminal highlighting in Wasm', () => {
        expect(shell.openTerminal('db> ').data).toContain(VT100.BOLD + 'db> ' + VT100.RESET_ATTRIBUTES);
        const output = shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, "SELECT '界' FROM t").data;
        expect(output).toContain(VT100.BOLD_FOREGROUND_PINK + 'SELECT' + VT100.RESET_ATTRIBUTES);
        expect(output).toContain(VT100.FOREGROUND_CORAL + "'界'" + VT100.RESET_ATTRIBUTES);
        expect(output).toContain(VT100.FOREGROUND_SILVER + 't' + VT100.RESET_ATTRIBUTES);
    });

    it('renders the terminal prompt in its color in Wasm', () => {
        shell.setTerminalPromptColor(0x6eff46);
        expect(shell.openTerminal('db> ').data).toContain('\x1b[1;38;2;110;255;70mdb> ' + VT100.RESET_ATTRIBUTES);
        shell.setTerminalPromptColor(null);
        expect(shell.openTerminal('db> ').data).toContain(VT100.BOLD + 'db> ' + VT100.RESET_ATTRIBUTES);
    });

    it('passes query effects to the environment', async () => {
        executeQuery = async query => {
            expect(query).toBe('CREATE TABLE foo(a INT)');
        };
        await expect(shell.executeQuery('CREATE TABLE foo(a INT)')).resolves.toBe('No results\r\n');
    });

    it('redraws a wrapped prompt from its current physical row', () => {
        shell.resize(16);
        shell.openTerminal('hyper> ');
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'SELECT 123');

        const output = shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, '4').data;
        const cursorUp = vt100Sequence(1, VT100Command.CURSOR_UP);
        const cursorDown = vt100Sequence(1, VT100Command.CURSOR_DOWN);
        const clearedRows = cursorUp + VT100.CARRIAGE_RETURN + VT100.ERASE_ENTIRE_LINE +
            cursorDown + VT100.CARRIAGE_RETURN + VT100.ERASE_ENTIRE_LINE + cursorUp + VT100.CARRIAGE_RETURN;
        expect(output.startsWith(clearedRows), JSON.stringify(output)).toBe(true);
        expect(output.match(/SELECT/g)).toHaveLength(1);
    });

    it('does not scroll while clearing a long wrapped prompt', () => {
        const columns = 80;
        shell.resize(columns);
        shell.openTerminal('hyper> ');
        // A prompt of more than two rows
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, `select '${'o'.repeat(2 * columns)}'`);

        const output = shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'f').data;
        const firstPrompt = output.indexOf('hyper> ');
        expect(firstPrompt).toBeGreaterThanOrEqual(0);
        expect(output.substring(0, firstPrompt)).not.toContain('\r\n');
        expect(output.match(/hyper> /g)).toHaveLength(1);
    });

    it('allocates a new row before extending a long prompt', () => {
        const columns = 80;
        const extension = ' as select';
        shell.resize(columns);
        shell.openTerminal('hyper> ');
        // A prompt of two rows that the extension makes one character longer than them
        const filler = 'o'.repeat(2 * columns + 1 - 'hyper> '.length - "select ''".length - extension.length);
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, `select '${filler}'`);

        const output = shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, extension).data;
        const firstPrompt = output.indexOf('hyper> ');
        expect(firstPrompt).toBeGreaterThanOrEqual(0);
        expect(output.substring(0, firstPrompt)).toContain('\r\n');
        // The cursor goes up to the first row of the prompt (CSI n A)
        expect(output.substring(0, firstPrompt)).toMatch(/\x1b\[\d+A/);
        expect(output.match(/hyper> /g)).toHaveLength(1);
    });

    it('renders an inline completion hint at the right margin with auto-wrap disabled', () => {
        const columns = 173;
        shell.resize(columns);
        shell.openTerminal('hyper> ');

        // The prompt ends one column before the right margin, the hint goes beyond it
        const filler = 'o'.repeat(columns - 1 - 'hyper> '.length - "select '' a".length);
        const hinted = shell.consumeTerminalInput(
            DashQLShellPromptInput.TEXT,
            `select '${filler}' a`,
        ).data;
        expect(hinted.match(/hyper> /g)).toHaveLength(1);
        expect(hinted).toContain(
            VT100.SAVE_CURSOR + VT100.FOREGROUND_BRIGHT_BLACK + ' into' +
            VT100.RESET_ATTRIBUTES + VT100.RESTORE_CURSOR,
        );

        const completed = shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 's').data;
        expect(completed.match(/hyper> /g)).toHaveLength(1);
    });

    it('consumes semantic terminal controls', () => {
        shell.openTerminal('db> ');
        const exited = shell.consumeTerminalInput(DashQLShellPromptInput.ESCAPE);
        expect(exited.action).toBe(DashQLShellPromptAction.EXIT);
        expect(exited.data).toBe(VT100.ENABLE_AUTO_WRAP);
    });

    it('executes built-in dot commands without SQL terminators', async () => {
        shell.openTerminal('db> ');

        const hinted = shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, '.hel');
        expect(hinted.data).toContain(VT100.FOREGROUND_BRIGHT_BLACK + 'p');
        expect(shell.completePrompt()).toContainEqual(expect.objectContaining({
            displayText: '.help',
            completionText: '.help',
            targetOffset: 0,
            targetLength: 4,
        }));
        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(shell.movePromptRight().text).toBe('.help');
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.ENTER).action).toBe(DashQLShellPromptAction.SUBMIT);
        const help = await shell.submitPrompt();
        expect(help).toContain('.clear');
        expect(help).toContain('Clear the terminal screen');
        expect(help).toContain('.help');
        expect(help).toContain('List available dot commands');
        expect(help.endsWith(VT100.NEW_LINE)).toBe(true);

        expect(shell.finishTerminalQuery(help).data).toContain(VT100.NEW_LINE + VT100.NEW_LINE);
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, '.clear');
        shell.consumeTerminalInput(DashQLShellPromptInput.ENTER);
        const cleared = shell.finishTerminalQuery(await shell.submitPrompt()).data;
        expect(cleared).toContain(VT100.CLEAR_SCREEN);
        expect(cleared).not.toContain(VT100.CLEAR_SCREEN + VT100.NEW_LINE);
    });

    it('registers JavaScript dot commands when creating the shell', async () => {
        shell.destroy();
        const execute = vi.fn((args: readonly string[]) => `logged in as ${args[0]}`);
        shell = await DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            commands: [['login', 'Log in to the service', execute]],
            terminalColumns: 80,
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        shell.setPrompt('.login alice');

        await expect(shell.submitPrompt()).resolves.toBe('logged in as alice\r\n');
        expect(execute).toHaveBeenCalledWith(['alice'], expect.objectContaining({ signal: expect.any(AbortSignal) }));

        shell.setPrompt('.help');
        await expect(shell.submitPrompt()).resolves.toContain('.login');
    });

    it('forwards command progress through the asynchronous effect interface', async () => {
        shell.destroy();
        const progress = vi.fn();
        const execute = vi.fn((_args: readonly string[], context: { onProgress?: (message: string) => void }) => {
            context.onProgress?.('Waiting for authorization');
            return 'connected';
        });
        shell = await DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            commands: [['login', 'Log in to the service', execute]],
            terminalColumns: 80,
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        shell.setPrompt('.login');

        await expect(shell.submitPrompt(undefined, progress)).resolves.toBe('connected\r\n');
        expect(progress).toHaveBeenCalledWith('Waiting for authorization');
    });

    it('normalizes trailing newlines in JavaScript dot command output', async () => {
        shell.destroy();
        shell = await DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            commands: [
                ['none', 'Return no output', () => undefined],
                ['bare', 'Return output without a newline', () => 'bare'],
                ['line-feed', 'Return output with a line feed', () => 'line feed\n'],
                ['crlf', 'Return output with CRLF', () => 'crlf\r\n'],
                ['fs', 'Return file output', () => '/mnt/external/data.csv'],
            ],
            terminalColumns: 80,
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });

        for (const [command, expected] of [
            ['.none', ''],
            ['.bare', 'bare\r\n'],
            ['.line-feed', 'line feed\r\n'],
            ['.crlf', 'crlf\r\n'],
            ['.fs', '/mnt/external/data.csv\r\n'],
        ]) {
            shell.setPrompt(command);
            await expect(shell.submitPrompt()).resolves.toBe(expected);
        }
    });

    it('configures and reports query timing', async () => {
        shell.setPrompt('.timer');
        await expect(shell.submitPrompt()).resolves.toBe('Timer: off\r\n');

        shell.setPrompt('.timer on');
        const timerOutput = await shell.submitPrompt();
        expect(timerOutput).toBe('Timer: on\r\n');
        const renderedTimer = shell.finishTerminalQuery(timerOutput).data;
        expect(renderedTimer).toContain(`Timer: on${VT100.NEW_LINE}${VT100.NEW_LINE}`);

        shell.setPrompt('SELECT 42;');
        const timedOutput = await shell.submitPrompt();
        expect(timedOutput).toBe('test database is not configured\r\n');

        shell.setPrompt('.timer off');
        await expect(shell.submitPrompt()).resolves.toBe('Timer: off\r\n');
        shell.setPrompt('SELECT 42;');
        await expect(shell.submitPrompt()).resolves.toBe('test database is not configured\r\n');

        shell.setPrompt('.timer invalid');
        await expect(shell.submitPrompt()).resolves.toBe('usage: .timer [on|off]\r\n');
    });

    it('reports labeled environment timings and total elapsed time', async () => {
        shell.destroy();
        shell = await DashQLShell.create({
            environment: {
                executeQuery: async (_query, _signal, _onProgress, onResult, onTiming) => {
                    onTiming?.('Results', 1234);
                    onTiming?.('Postprocess', 12);
                    onTiming?.('Postprocess', 3);
                    onResult?.(1, 1);
                },
            },
            terminalColumns: 80,
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        shell.setPrompt('.timer on');
        await shell.submitPrompt();
        shell.setPrompt('SELECT 42;');

        await expect(shell.submitPrompt()).resolves.toMatch(
            /^Query completed \(1 row\)\r\nResults: 1\.234 s \| Postprocess: 15 ms\r\n$/,
        );
    });

    it('reports unknown dot commands without executing SQL', async () => {
        shell.setPrompt('.missing');
        await expect(shell.submitPrompt()).resolves.toBe('unknown command: .missing\r\n');
    });

    it('rejects duplicate and invalid dot command registrations', async () => {
        await expect(DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            commands: [['help', 'Replace help', () => undefined]],
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        })).rejects.toThrow('duplicate shell command: .help');
        await expect(DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            commands: [['bad command', 'Invalid', () => undefined]],
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        })).rejects.toThrow('invalid shell command name: bad command');
        await expect(DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            commands: [['.login', 'Invalid', () => undefined]],
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        })).rejects.toThrow('invalid shell command name: .login');
    });

    it('enables auto-wrap for output and disables it for the next prompt', () => {
        const opened = shell.openTerminal('db> ').data;
        expect(opened.startsWith(VT100.DISABLE_AUTO_WRAP)).toBe(true);

        const finished = shell.finishTerminalQuery('a query result').data;
        expect(finished.indexOf(VT100.ENABLE_AUTO_WRAP)).toBeLessThan(finished.indexOf('a query result'));
        expect(finished.indexOf('a query result')).toBeLessThan(finished.indexOf(VT100.DISABLE_AUTO_WRAP));

        const status = shell.renderTerminalStatus('working').data;
        expect(status.indexOf(VT100.ENABLE_AUTO_WRAP)).toBeLessThan(status.indexOf('working'));
        expect(status.indexOf('working')).toBeLessThan(status.indexOf(VT100.DISABLE_AUTO_WRAP));
    });

    it('renders and clears query progress in the shell core', () => {
        shell.resize(20);
        shell.openTerminal('db> ');

        const first = shell.renderTerminalQueryProgress('  Executing\nquery\tbatch  ').data;
        expect(first).toContain(' Executing query...');
        expect(first).not.toContain('\nquery');
        expect(first).toContain(VT100.DISABLE_AUTO_WRAP);

        // The next frame of the spinner, the glyph before the text
        const next = shell.renderTerminalQueryProgress('', true).data;
        expect(next).toContain(' Executing query...');
        const spinner = (data: string) => data.charAt(data.indexOf(' Executing query...') - 1);
        expect(spinner(next)).not.toBe(spinner(first));

        const cleared = shell.clearTerminalQueryProgress().data;
        expect(cleared).toBe(VT100.CARRIAGE_RETURN + VT100.ERASE_ENTIRE_LINE + VT100.ENABLE_AUTO_WRAP);
        expect(shell.clearTerminalQueryProgress().data).toBe('');
    });

    it('starts query progress after the last multiline prompt row', () => {
        shell.setPrompt('SELECT 42\n;');
        shell.consumePromptInput(DashQLShellPromptInput.UP);
        shell.openTerminal('db> ');

        const submitted = shell.consumeTerminalInput(DashQLShellPromptInput.ENTER);
        expect(submitted.action).toBe(DashQLShellPromptAction.SUBMIT);
        expect(submitted.data).toContain(
            vt100Sequence(1, VT100Command.CURSOR_DOWN) + VT100.ENABLE_AUTO_WRAP + VT100.NEW_LINE,
        );

        expect(shell.renderTerminalQueryProgress('Executing query').data).toContain(' Executing query');
    });

    it('navigates, accepts, and dismisses terminal completion overlays', () => {
        shell.openTerminal('db> ');
        const opened = shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'sel');

        const candidates = shell.completePrompt(50);
        expect(candidates.length).toBeGreaterThan(1);
        const selectIndex = candidates.findIndex(candidate => candidate.completionText === 'select');
        expect(selectIndex).toBeGreaterThanOrEqual(0);

        expect(opened.action).toBe(DashQLShellPromptAction.NONE);
        expect(opened.data).not.toContain('╭');
        const list = shell.terminalCompletionList()!;
        expect(list.selection).toBe(0);
        expect(list.anchorColumn).toBe('db> '.length);
        let selected = opened;
        for (let i = 0; i < selectIndex; ++i) selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);
        expect(selected.data).toContain(VT100.FOREGROUND_BRIGHT_BLACK + 'ect');
        expect(shell.terminalCompletionList()!.selection).toBe(selectIndex);
        expect(shell.terminalCompletionList()!.revision).toBe(list.revision);
        const accepted = shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(accepted.action).toBe(DashQLShellPromptAction.NONE);
        expect(accepted.data).toContain(VT100.BOLD_FOREGROUND_PINK + 'select' + VT100.RESET_ATTRIBUTES);
        expect(shell.terminalCompletionList()).toBeNull();
        expect(shell.movePromptRight().text).toBe('select');

        shell.consumeTerminalInput(DashQLShellPromptInput.CANCEL);
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'sel');
        expect(shell.terminalCompletionList()).not.toBeNull();
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.ESCAPE).action).toBe(DashQLShellPromptAction.NONE);
        expect(shell.terminalCompletionList()).toBeNull();
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.ESCAPE).action).toBe(DashQLShellPromptAction.EXIT);
    });

    it('shows only an inline hint before the completion prefix', () => {
        shell.openTerminal('db> ');
        const hinted = shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, ' ');

        expect(hinted.data).toContain(VT100.FOREGROUND_BRIGHT_BLACK);
        expect(shell.terminalCompletionList()).toBeNull();
        expect(shell.terminalCompletionBuffer()).toBeNull();

        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 's');
        expect(shell.terminalCompletionList()).not.toBeNull();
        expect(shell.terminalCompletionBuffer()).not.toBeNull();

        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(shell.movePromptRight().text.length).toBeGreaterThan(2);
    });

    it('does not cycle completion candidates with Left and Right', () => {
        shell.openTerminal('db> ');
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'sel');
        const candidates = shell.completePrompt(50);
        expect(candidates.length).toBeGreaterThan(1);

        shell.consumeTerminalInput(DashQLShellPromptInput.RIGHT);
        shell.consumeTerminalInput(DashQLShellPromptInput.LEFT);
        shell.consumeTerminalInput(DashQLShellPromptInput.RIGHT);
        shell.consumeTerminalInput(DashQLShellPromptInput.END);
        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(shell.terminalCompletionList()).not.toBeNull();
        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(shell.movePromptRight().text).toBe(candidates[0].completionText);
    });

    it('accepts a selected dot command completion with Enter before submitting it', () => {
        shell.openTerminal('db> ');
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, '.');
        const candidates = shell.completePrompt(50);
        const helpIndex = candidates.findIndex(candidate => candidate.completionText === '.help');
        expect(helpIndex).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < helpIndex; ++i) shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);

        expect(shell.consumeTerminalInput(DashQLShellPromptInput.ENTER).action).toBe(DashQLShellPromptAction.NONE);
        expect(shell.movePromptRight().text).toBe('.help');
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.ENTER).action).toBe(DashQLShellPromptAction.SUBMIT);
    });

    it('accepts keyword completion and its inline continuation in steps', () => {
        shell.openTerminal('db> ');
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'SELECT * FROM supplier gro');
        const candidates = shell.completePrompt(50);
        const groupIndex = candidates.findIndex(candidate => candidate.completionText === 'group');
        expect(groupIndex).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < groupIndex; ++i) shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);

        const firstStep = shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(firstStep.data).toContain(VT100.BOLD_FOREGROUND_PINK + 'SELECT' + VT100.RESET_ATTRIBUTES);
        expect(firstStep.data).toContain(VT100.FOREGROUND_SILVER + 'supplier' + VT100.RESET_ATTRIBUTES);
        expect(firstStep.data).toContain(VT100.BOLD_FOREGROUND_PINK + 'group' + VT100.RESET_ATTRIBUTES);
        expect(firstStep.data).toContain(VT100.FOREGROUND_BRIGHT_BLACK + ' by');
        expect(shell.movePromptRight().text).toBe('SELECT * FROM supplier group');

        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(shell.movePromptRight().text).toBe('SELECT * FROM supplier group by');
    });

    it('anchors completion below an earlier cursor line', () => {
        shell.openTerminal('db> ');
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'sel\nFROM supplier');
        for (let i = 0; i < '\nFROM supplier'.length; ++i) shell.movePromptLeft();
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'x');
        const output = shell.consumeTerminalInput(DashQLShellPromptInput.BACKSPACE);
        // No rows are inserted for the list (CSI n L), it opens below the cursor line
        expect(output.data).not.toMatch(/\x1b\[\d+L/);
        expect(shell.terminalCompletionList()!.anchorColumn).toBe('db> '.length);
    });

    it('hands out the candidates of the completion list with what is known about them', () => {
        loadCatalogScript(shell, 'create table orders(order_id bigint, amount double);');
        shell.openTerminal('db> ');
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'select * from orders o where o.');

        const completion = shell.terminalCompletionBuffer()!.read();
        const names = shell.completePrompt(50).map(candidate => candidate.displayText);
        expect(completion.candidatesLength()).toBe(names.length);
        const listed = Array.from({ length: names.length }, (_, i) => completion.candidates(i)!.displayText());
        expect(listed).toEqual(names);

        const orderId = completion.candidates(listed.indexOf('order_id'))!;
        expect(orderId.catalogObjects(0)!.info()!.detail()!.toLowerCase()).toContain('bigint');
    });

    it('shows qualification inline before accepting the candidate', () => {
        shell.openTerminal('db> ');
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT,
            'CREATE TABLE orders(customer_id BIGINT); CREATE TABLE customers(customer_id BIGINT); ' +
            'SELECT customer_id FROM orders o JOIN customers c ON o.customer_id = c.customer_id WHERE customer_id',
        );
        const candidates = shell.completePrompt(50);
        const candidateIndex = candidates.findIndex(candidate => candidate.completionText === 'customer_id');
        expect(candidateIndex).toBeGreaterThanOrEqual(0);
        let selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);
        if (candidateIndex === 0) {
            selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_PREVIOUS);
        } else {
            for (let i = 1; i < candidateIndex; ++i) selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);
        }
        expect(selected.data).toContain(VT100.CSI);
        expect(selected.data).toContain('@');
        expect(selected.data).toContain(VT100.FOREGROUND_BRIGHT_BLACK);
    });

    it('cycles inline qualification hints with Left and Right', () => {
        shell.openTerminal('db> ');
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT,
            'CREATE TABLE orders(customer_id BIGINT); CREATE TABLE customers(customer_id BIGINT); ' +
            'SELECT customer_id FROM orders o JOIN customers c ON o.customer_id = c.customer_id WHERE customer_id',
        );
        const candidates = shell.completePrompt(50);
        const candidateIndex = candidates.findIndex(candidate => candidate.completionText === 'customer_id');
        expect(candidateIndex).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < candidateIndex; ++i) shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);

        expect(shell.consumeTerminalInput(DashQLShellPromptInput.RIGHT).data).toContain('c.');
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.LEFT).data).toContain('o.');
        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(shell.movePromptRight().text).toContain('o.customer_id');
    });

    it('drives multiline input and history through the shell core', async () => {
        let prompt = shell.consumePromptInput(DashQLShellPromptInput.TEXT, 'SELECT 42');
        expect(prompt.text).toBe('SELECT 42');
        prompt = shell.consumePromptInput(DashQLShellPromptInput.ENTER);
        expect(prompt).toMatchObject({ text: 'SELECT 42\n', action: DashQLShellPromptAction.NONE });
        shell.consumePromptInput(DashQLShellPromptInput.TEXT, ';');
        prompt = shell.consumePromptInput(DashQLShellPromptInput.ENTER);
        expect(prompt.action).toBe(DashQLShellPromptAction.SUBMIT);

        executeQuery = async () => { throw new Error('expected'); };
        await shell.submitPrompt();
        shell.consumePromptInput(DashQLShellPromptInput.CANCEL);
        expect(shell.consumePromptInput(DashQLShellPromptInput.HISTORY_PREVIOUS).text).toBe('SELECT 42\n;');

        const history = shell.exportHistory();
        shell.destroy();
        shell = await DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            terminalColumns: 80,
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        shell.importHistory(history);
        expect(shell.consumePromptInput(DashQLShellPromptInput.HISTORY_PREVIOUS).text).toBe('SELECT 42\n;');
    });

    it('navigates between lines with Up and Down', () => {
        shell.consumePromptInput(DashQLShellPromptInput.TEXT, 'SELECT ab\nFROM table');

        expect(shell.consumePromptInput(DashQLShellPromptInput.UP).cursorByteOffset).toBe('SELECT ab'.length);
        expect(shell.consumePromptInput(DashQLShellPromptInput.DOWN).cursorByteOffset).toBe('SELECT ab\nFROM tabl'.length);
    });

    it('continues through history after loading a multiline query with Up', async () => {
        shell.setPrompt('SELECT 1;');
        await shell.submitPrompt();
        shell.setPrompt('SELECT 2\n;');
        await shell.submitPrompt();
        shell.setPrompt('');

        expect(shell.consumePromptInput(DashQLShellPromptInput.UP).text).toBe('SELECT 2\n;');
        expect(shell.consumePromptInput(DashQLShellPromptInput.UP).text).toBe('SELECT 1;');
        expect(shell.consumePromptInput(DashQLShellPromptInput.DOWN).text).toBe('SELECT 2\n;');
        expect(shell.consumePromptInput(DashQLShellPromptInput.DOWN).text).toBe('');
    });

    it('continues terminal history navigation after recalled queries open completion', async () => {
        shell.setPrompt('SELECT 1;');
        await shell.submitPrompt();
        shell.setPrompt('SELECT 2;');
        await shell.submitPrompt();
        shell.setPrompt('');
        shell.openTerminal('db> ');

        shell.consumeTerminalInput(DashQLShellPromptInput.UP);
        shell.consumeTerminalInput(DashQLShellPromptInput.UP);
        expect(shell.movePromptRight().text).toBe('SELECT 1;');

        shell.consumeTerminalInput(DashQLShellPromptInput.DOWN);
        expect(shell.movePromptRight().text).toBe('SELECT 2;');
        shell.consumeTerminalInput(DashQLShellPromptInput.DOWN);
        expect(shell.movePromptRight().text).toBe('');
    });

    it('navigates to the prompt start and end', () => {
        const query = 'SELECT 👩‍💻';
        shell.consumePromptInput(DashQLShellPromptInput.TEXT, query);

        expect(shell.consumePromptInput(DashQLShellPromptInput.START).cursorByteOffset).toBe(0);
        expect(shell.consumePromptInput(DashQLShellPromptInput.END).cursorByteOffset)
            .toBe(new TextEncoder().encode(query).byteLength);
    });

    it('runs the asynchronous query workflow through the shell core', async () => {
        let database: HyperDB | null = null;
        let connection: HyperDBConnection | null = null;
        try {
            database = await setupWebHyperDB('shell_api_test', new TestLogger());
            connection = await database.connect();
            // An executor that runs the statements on the connection of the test
            const session = connection;
            let queryId = 0;
            const environment = createEmbeddedDatabaseShellEnvironment((_connectionId, args) => [++queryId, session.query(args.query)], 'shell');
            executeQuery = (query, signal, onResult) => environment.executeQuery(query, signal, undefined, onResult);

            await expect(shell.executeQuery('CREATE TABLE foo(a INT)')).resolves.toBe('No results\r\n');
            await expect(shell.executeQuery(
                "SELECT * FROM (VALUES (1, 'alpha'), (20, '界'), (300, NULL)) AS t(value, name)",
            )).resolves.toBe('Query completed (3 rows)\r\n');
        } finally {
            if (connection) await connection.close();
            await database?.terminate();
        }
    }, 60_000);

    it('cancels a suspended shell effect', async () => {
        const abort = new AbortController();
        executeQuery = () => new Promise<void>(() => {});
        const query = shell.executeQuery('SELECT 42', abort.signal);
        abort.abort();
        await expect(query).resolves.toBe('Cancelled');
    });

    it('rejects a late completion after destruction', async () => {
        const pending: { resolve?: () => void } = {};
        executeQuery = () => new Promise<void>(resolve => {
            pending.resolve = resolve;
        });
        const query = shell.executeQuery('SELECT 42');
        let rejection: unknown;
        query.catch(error => { rejection = error; });
        await Promise.resolve();
        shell.destroy();
        pending.resolve?.();
        await expect(query).rejects.toMatchObject({ status: DashQLShellStatus.STALE_EFFECT });
        expect(rejection).toMatchObject({ status: DashQLShellStatus.STALE_EFFECT });
    });
});

describe('DashQL shell catalog', () => {
    const environment = { executeQuery: async () => {} };

    it('leaves a catalog of its caller to the caller', async () => {
        const core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        const catalog = core.createCatalog();
        const shell = await DashQLShell.create({ core, catalog, environment });
        expect(shell.catalog).toBe(catalog);
        shell.destroy();
        const script = core.createScript(catalog);
        script.replaceText('create table t (a integer)');
        script.analyze();
        catalog.loadScript(script, dashql.buffers.catalog.CatalogLayer.CONNECTION);
        script.destroy();
        catalog.destroy();
    });

    it('destroys a catalog of its own', async () => {
        const core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        const shell = await DashQLShell.create({ core, environment });
        const { catalog } = shell;
        shell.destroy();
        expect(() => core.createScript(catalog)).toThrow();
    });

    it('completes what the catalog holds when the prompt is completed', async () => {
        const core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        const catalog = core.createCatalog();
        const shell = await DashQLShell.create({ core, catalog, environment });
        shell.setPrompt('select * from ord');
        expect(shell.completePrompt().map(candidate => candidate.completionText)).not.toContain('orders');
        const script = core.createScript(catalog);
        script.replaceText('create table orders (id integer)');
        script.analyze();
        catalog.loadScript(script, dashql.buffers.catalog.CatalogLayer.CONNECTION);
        expect(shell.completePrompt().map(candidate => candidate.completionText)).toContain('orders');
        shell.destroy();
        script.destroy();
        catalog.destroy();
    });
});

describe('DashQL shell output', () => {
    /// The first rows of a result as the runtime reads them from its data frame
    const previewRows = arrow.tableToIPC(new arrow.Table({
        name: vectorFromArray(['alpha', '界'], new arrow.Utf8()),
        value: vectorFromArray([1, 20], new arrow.Int32()),
    }), 'stream');

    async function createShell(environment: DashQLShellEnvironment, commands: readonly DashQLShellCommand[] = []): Promise<DashQLShell> {
        const core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        return await DashQLShell.create({ core, environment, commands, terminalColumns: 80 });
    }

    /// An environment whose queries report a result of `rowCount` rows as query 7
    function environmentWithResult(
        rowCount: number,
        previewResult?: DashQLShellEnvironment['previewResult'],
        releaseResult?: DashQLShellEnvironment['releaseResult'],
    ): DashQLShellEnvironment {
        return {
            executeQuery: async (_query, _signal, _onProgress, onResult) => { onResult?.(7, rowCount); },
            previewResult,
            releaseResult,
        };
    }

    it('shows results in the overlay by default', async () => {
        const preview = vi.fn(async () => previewRows);
        const shell = await createShell(environmentWithResult(2, preview));
        const onResult = vi.fn();
        await expect(shell.executeQuery('SELECT 1', undefined, undefined, onResult)).resolves.toBe('Query completed (2 rows)\r\n');
        expect(onResult).toHaveBeenCalledWith(7, 2, false);
        expect(preview).not.toHaveBeenCalled();
        shell.destroy();
    });

    it('shows the first rows of a result as a table in the terminal on request', async () => {
        const preview = vi.fn(async () => previewRows);
        const shell = await createShell(environmentWithResult(2, preview));
        shell.setPrompt('.output table');
        await expect(shell.submitPrompt()).resolves.toBe(`Query output: table (the first ${SHELL_PREVIEW_ROW_LIMIT} rows in the terminal)\r\n`);
        const onResult = vi.fn();
        const output = await shell.executeQuery('SELECT 1', undefined, undefined, onResult);
        expect(preview).toHaveBeenCalledWith(7, SHELL_PREVIEW_ROW_LIMIT);
        expect(onResult).toHaveBeenCalledWith(7, 2, true);
        expect(output).toBe(
            '╭───────┬───────╮\n' +
            '│ name  │ value │\n' +
            '╞═══════╪═══════╡\n' +
            '│ alpha │     1 │\n' +
            '│ 界    │    20 │\n' +
            '╰───────┴───────╯' + VT100.NEW_LINE +
            'Query completed (2 rows)',
        );
        shell.setPrompt('.output overlay');
        await expect(shell.submitPrompt()).resolves.toBe('Query output: overlay\r\n');
        await expect(shell.executeQuery('SELECT 1')).resolves.toBe('Query completed (2 rows)\r\n');
        expect(preview).toHaveBeenCalledTimes(1);
        shell.destroy();
    });

    it('says how many rows of a long result the table shows', async () => {
        const last: DashQLShellCommand = ['last', 'Show the last query result again', () => undefined];
        const shell = await createShell(environmentWithResult(250, async () => previewRows), [last]);
        shell.setPrompt('.output table');
        await shell.submitPrompt();
        const output = await shell.executeQuery('SELECT 1');
        expect(output.endsWith(VT100.NEW_LINE + `Query completed (250 rows, the first ${SHELL_PREVIEW_ROW_LIMIT} shown, .last shows all)`)).toBe(true);
        shell.destroy();
    });

    it('opens the overlay if the terminal cannot show the rows', async () => {
        const shell = await createShell(environmentWithResult(2, async () => { throw new Error('no data frame'); }));
        shell.setPrompt('.output table');
        await shell.submitPrompt();
        const onResult = vi.fn();
        await expect(shell.executeQuery('SELECT 1', undefined, undefined, onResult))
            .resolves.toBe('Query completed (2 rows), no table in the terminal: no data frame\r\n');
        expect(onResult).toHaveBeenCalledWith(7, 2, false);
        shell.destroy();
    });

    it('releases the result of a statement that was cancelled while the terminal read its rows', async () => {
        let finishReading = (_rows: Uint8Array) => { };
        const preview = vi.fn(() => new Promise<Uint8Array>(resolve => { finishReading = resolve; }));
        const release = vi.fn();
        const shell = await createShell(environmentWithResult(2, preview, release));
        shell.setPrompt('.output table');
        await shell.submitPrompt();
        const abort = new AbortController();
        const onResult = vi.fn();
        shell.setPrompt('SELECT 1;');
        const run = shell.submitPrompt(abort.signal, undefined, onResult);
        await vi.waitFor(() => expect(preview).toHaveBeenCalled());
        abort.abort();
        await expect(run).resolves.toBe('Cancelled');
        finishReading(previewRows);
        await vi.waitFor(() => expect(release).toHaveBeenCalledWith(7));
        expect(onResult).not.toHaveBeenCalled();
        shell.destroy();
    });

    it('releases a result that the environment reported for a cancelled statement', async () => {
        const release = vi.fn();
        const abort = new AbortController();
        const shell = await createShell({
            executeQuery: async (_query, signal, _onProgress, onResult) => {
                onResult?.(7, 2);
                abort.abort();
                signal?.throwIfAborted();
            },
            releaseResult: release,
        });
        const onResult = vi.fn();
        shell.setPrompt('SELECT 1;');
        await expect(shell.submitPrompt(abort.signal, undefined, onResult)).resolves.toBe('Cancelled');
        await vi.waitFor(() => expect(release).toHaveBeenCalledWith(7));
        expect(onResult).not.toHaveBeenCalled();

        // A result that the shell passes on stays
        const passedOn = await createShell(environmentWithResult(2, undefined, release));
        passedOn.setPrompt('SELECT 1;');
        await passedOn.submitPrompt(undefined, undefined, onResult);
        expect(onResult).toHaveBeenCalledWith(7, 2, false);
        expect(release).toHaveBeenCalledTimes(1);
        passedOn.destroy();
        shell.destroy();
    });

    it('offers the output only to an environment with previews', async () => {
        const without = await createShell(environmentWithResult(2));
        without.setPrompt('.help');
        expect(await without.submitPrompt()).not.toContain('.output');
        without.destroy();

        const shell = await createShell(environmentWithResult(2, async () => previewRows));
        shell.setPrompt('.help');
        expect(await shell.submitPrompt()).toContain('.output');
        shell.setPrompt('.output wide');
        await expect(shell.submitPrompt()).resolves.toBe('usage: .output [overlay|table]\r\n');
        shell.destroy();
    });
});
