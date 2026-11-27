import * as arrow from 'apache-arrow';

import {
    DashQLShell,
    DashQLShellError,
    DashQLShellRecordKind as Kind,
    DashQLShellStatus,
    SHELL_PREVIEW_ROW_LIMIT,
    type DashQLShellCommand,
    type DashQLShellEnvironment,
    type DashQLShellRecord,
    type DashQLShellResultCallback,
} from './api.js';
import * as dashql from '@akohn/dashql';
import { vectorFromArray } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { createEmbeddedDatabaseShellEnvironment } from '../page/embedded_database_shell_environment.js';
import { setupWebHyperDB } from '../../host/hyperdb/hyperdb_provider_web.js';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { HyperDB, HyperDBConnection } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// A record of the output of a shell
function record(kind: Kind, text: string): DashQLShellRecord {
    return { kind, text };
}

/// Run a prompt of a shell
function run(shell: DashQLShell, prompt: string, signal?: AbortSignal, onResult?: DashQLShellResultCallback): Promise<DashQLShellRecord[]> {
    return shell.submit(prompt, signal, undefined, onResult);
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
            columns: 80,
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
    });

    afterEach(() => shell.destroy());

    it('rejects operations after destruction', () => {
        shell.destroy();
        expect(() => shell.resize(40)).toThrowError(DashQLShellError);
        expect(() => shell.promptInfo('select 1;')).toThrowError(DashQLShellError);
    });

    it('tells complete statements and dot commands apart', () => {
        expect(shell.promptInfo('SELECT 42')).toEqual({ isCommand: false, isComplete: false });
        expect(shell.promptInfo('SELECT 42\n;')).toEqual({ isCommand: false, isComplete: true });
        expect(shell.promptInfo('SELECT 1; SELECT 2;')).toEqual({ isCommand: false, isComplete: false });
        expect(shell.promptInfo('.help')).toEqual({ isCommand: true, isComplete: true });
        expect(shell.promptInfo('')).toEqual({ isCommand: false, isComplete: false });
    });

    it('completes the names of dot commands', () => {
        expect(shell.completeCommand('.hel')).toEqual({ text: '.help ', candidates: [] });
        expect(shell.completeCommand('.t')).toEqual({ text: '.timer ', candidates: [] });
        expect(shell.completeCommand('.')).toEqual({ text: '.', candidates: ['.clear', '.timer', '.help'] });
        expect(shell.completeCommand('select')).toEqual({ text: 'select', candidates: [] });
    });

    it('reports messages from worker error events', async () => {
        executeQuery = async () => {
            throw {
                message: 'Uncaught RangeError: Maximum call stack size exceeded',
                toString: () => '[object ErrorEvent]',
            };
        };
        await expect(run(shell, 'SELECT * FROM large_file')).resolves.toEqual([
            record(Kind.ERROR, 'Uncaught RangeError: Maximum call stack size exceeded'),
        ]);
    });

    it('submits the prompt through the asynchronous effect interface', async () => {
        executeQuery = async query => {
            expect(query).toBe('SELECT 42');
            throw new Error('backend unavailable');
        };
        await expect(run(shell, 'SELECT 42;')).resolves.toEqual([record(Kind.ERROR, 'backend unavailable')]);
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
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        await expect(shell.submit('SELECT 42;', undefined, progress)).resolves.toEqual([record(Kind.ERROR, 'expected')]);
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
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        await expect(run(shell, 'SELECT 42;', undefined, result)).resolves.toEqual([record(Kind.STATUS, 'Query completed (1 row)')]);
        expect(result).toHaveBeenCalledWith(42, 1, false);
    });

    it('strips only the trailing shell terminator before execution', async () => {
        executeQuery = async query => {
            expect(query).toBe("SELECT ';' AS value");
            throw new Error('expected');
        };
        const prompt = "SELECT ';' AS value;  \n";
        await expect(run(shell, prompt)).resolves.toEqual([record(Kind.ERROR, 'expected')]);
        expect(new TextDecoder().decode(shell.exportHistory()).endsWith(prompt)).toBe(true);
    });

    it('passes query effects to the environment', async () => {
        executeQuery = async query => {
            expect(query).toBe('CREATE TABLE foo(a INT)');
        };
        await expect(run(shell, 'CREATE TABLE foo(a INT)')).resolves.toEqual([record(Kind.STATUS, 'No results')]);
    });

    it('executes built-in dot commands without SQL terminators', async () => {
        const [help, ...rest] = await run(shell, '.help');
        expect(rest).toEqual([]);
        expect(help.kind).toBe(Kind.TEXT);
        expect(help.text).toContain('.clear');
        expect(help.text).toContain('Clear the output of the shell');
        expect(help.text).toContain('.help');
        expect(help.text).toContain('List available dot commands');
        expect(help.text.endsWith('\n')).toBe(false);

        await expect(run(shell, '.clear')).resolves.toEqual([record(Kind.CLEAR, '')]);
    });

    it('registers JavaScript dot commands when creating the shell', async () => {
        shell.destroy();
        const execute = vi.fn((args: readonly string[]) => `logged in as ${args[0]}`);
        shell = await DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            commands: [['login', 'Log in to the service', execute]],
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        await expect(run(shell, '.login alice')).resolves.toEqual([record(Kind.TEXT, 'logged in as alice')]);
        expect(execute).toHaveBeenCalledWith(['alice'], expect.objectContaining({ signal: expect.any(AbortSignal) }));
        const [help] = await run(shell, '.help');
        expect(help.text).toContain('.login');
        expect(shell.completeCommand('.lo').text).toBe('.login ');
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
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        await expect(shell.submit('.login', undefined, progress)).resolves.toEqual([record(Kind.TEXT, 'connected')]);
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
                ['crlf', 'Return output with CRLF', () => 'crlf\r\nnext\r\n'],
                ['fs', 'Return file output', () => '/mnt/external/data.csv'],
            ],
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });

        for (const [command, expected] of [
            ['.none', []],
            ['.bare', [record(Kind.TEXT, 'bare')]],
            ['.line-feed', [record(Kind.TEXT, 'line feed')]],
            ['.crlf', [record(Kind.TEXT, 'crlf\nnext')]],
            ['.fs', [record(Kind.TEXT, '/mnt/external/data.csv')]],
        ] as const) {
            await expect(run(shell, command)).resolves.toEqual(expected);
        }
    });

    it('configures and reports query timing', async () => {
        await expect(run(shell, '.timer')).resolves.toEqual([record(Kind.TEXT, 'Timer: off')]);
        await expect(run(shell, '.timer on')).resolves.toEqual([record(Kind.TEXT, 'Timer: on')]);
        await expect(run(shell, 'SELECT 42;')).resolves.toEqual([record(Kind.ERROR, 'test database is not configured')]);
        await expect(run(shell, '.timer off')).resolves.toEqual([record(Kind.TEXT, 'Timer: off')]);
        await expect(run(shell, '.timer invalid')).resolves.toEqual([record(Kind.ERROR, 'usage: .timer [on|off]')]);
    });

    it('reports the time until the results arrived', async () => {
        shell.destroy();
        shell = await DashQLShell.create({
            environment: {
                executeQuery: async (_query, _signal, _onProgress, onResult, onTiming) => {
                    onTiming?.(1200);
                    onTiming?.(34);
                    onResult?.(1, 1);
                },
            },
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        await run(shell, '.timer on');
        await expect(run(shell, 'SELECT 42;')).resolves.toEqual([
            record(Kind.STATUS, 'Query completed (1 row)'),
            record(Kind.STATUS, 'Results: 1.234 s'),
        ]);
    });

    it('reports unknown dot commands without executing SQL', async () => {
        await expect(run(shell, '.missing')).resolves.toEqual([record(Kind.ERROR, 'unknown command: .missing')]);
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

    it('browses the history and keeps it across shells', async () => {
        executeQuery = async () => { throw new Error('expected'); };
        await run(shell, 'SELECT 1;');
        await run(shell, 'SELECT 42\n;');
        expect(shell.historyPrevious('draft')).toBe('SELECT 42\n;');
        expect(shell.historyPrevious('SELECT 42\n;')).toBe('SELECT 1;');
        expect(shell.historyPrevious('SELECT 1;')).toBeNull();
        expect(shell.historyNext('SELECT 1;')).toBe('SELECT 42\n;');
        expect(shell.historyNext('SELECT 42\n;')).toBe('draft');
        expect(shell.historyNext('draft')).toBeNull();

        const history = shell.exportHistory();
        shell.destroy();
        shell = await DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            core: await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
        });
        shell.importHistory(history);
        expect(shell.historyPrevious('')).toBe('SELECT 42\n;');
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

            await expect(run(shell, 'CREATE TABLE foo(a INT)')).resolves.toEqual([record(Kind.STATUS, 'No results')]);
            await expect(run(
                shell,
                "SELECT * FROM (VALUES (1, 'alpha'), (20, '界'), (300, NULL)) AS t(value, name)",
            )).resolves.toEqual([record(Kind.STATUS, 'Query completed (3 rows)')]);
        } finally {
            if (connection) await connection.close();
            await database?.terminate();
        }
    }, 60_000);

    it('cancels a suspended shell effect', async () => {
        const abort = new AbortController();
        executeQuery = () => new Promise<void>(() => {});
        const query = run(shell, 'SELECT 42', abort.signal);
        abort.abort();
        await expect(query).resolves.toEqual([record(Kind.STATUS, 'Cancelled')]);
    });

    it('rejects a late completion after destruction', async () => {
        const pending: { resolve?: () => void } = {};
        executeQuery = () => new Promise<void>(resolve => {
            pending.resolve = resolve;
        });
        const query = run(shell, 'SELECT 42');
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
});

describe('DashQL shell output', () => {
    /// The first rows of a result as the runtime reads them from its data frame
    const previewRows = arrow.tableToIPC(new arrow.Table({
        name: vectorFromArray(['alpha', '界'], new arrow.Utf8()),
        value: vectorFromArray([1, 20], new arrow.Int32()),
    }), 'stream');

    async function createShell(environment: DashQLShellEnvironment, commands: readonly DashQLShellCommand[] = []): Promise<DashQLShell> {
        const core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        return await DashQLShell.create({ core, environment, commands, columns: 80 });
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
        await expect(run(shell, 'SELECT 1', undefined, onResult)).resolves.toEqual([record(Kind.STATUS, 'Query completed (2 rows)')]);
        expect(onResult).toHaveBeenCalledWith(7, 2, false);
        expect(preview).not.toHaveBeenCalled();
        shell.destroy();
    });

    it('shows the first rows of a result as a table on request', async () => {
        const preview = vi.fn(async () => previewRows);
        const shell = await createShell(environmentWithResult(2, preview));
        await expect(run(shell, '.output table')).resolves.toEqual([
            record(Kind.TEXT, `Query output: table (the first ${SHELL_PREVIEW_ROW_LIMIT} rows in the shell)`),
        ]);
        const onResult = vi.fn();
        const output = await run(shell, 'SELECT 1', undefined, onResult);
        expect(preview).toHaveBeenCalledWith(7, SHELL_PREVIEW_ROW_LIMIT);
        expect(onResult).toHaveBeenCalledWith(7, 2, true);
        expect(output).toEqual([
            record(Kind.TABLE,
                '╭───────┬───────╮\n' +
                '│ name  │ value │\n' +
                '╞═══════╪═══════╡\n' +
                '│ alpha │     1 │\n' +
                '│ 界    │    20 │\n' +
                '╰───────┴───────╯'),
            record(Kind.STATUS, 'Query completed (2 rows)'),
        ]);
        await expect(run(shell, '.output overlay')).resolves.toEqual([record(Kind.TEXT, 'Query output: overlay')]);
        await expect(run(shell, 'SELECT 1')).resolves.toEqual([record(Kind.STATUS, 'Query completed (2 rows)')]);
        expect(preview).toHaveBeenCalledTimes(1);
        shell.destroy();
    });

    it('says how many rows of a long result the table shows', async () => {
        const last: DashQLShellCommand = ['last', 'Show the last query result again', () => undefined];
        const shell = await createShell(environmentWithResult(250, async () => previewRows), [last]);
        await run(shell, '.output table');
        const output = await run(shell, 'SELECT 1');
        expect(output.at(-1)).toEqual(record(Kind.STATUS, `Query completed (250 rows, the first ${SHELL_PREVIEW_ROW_LIMIT} shown, .last shows all)`));
        shell.destroy();
    });

    it('opens the overlay if the shell cannot show the rows', async () => {
        const shell = await createShell(environmentWithResult(2, async () => { throw new Error('no data frame'); }));
        await run(shell, '.output table');
        const onResult = vi.fn();
        await expect(run(shell, 'SELECT 1', undefined, onResult))
            .resolves.toEqual([record(Kind.STATUS, 'Query completed (2 rows), no table in the shell: no data frame')]);
        expect(onResult).toHaveBeenCalledWith(7, 2, false);
        shell.destroy();
    });

    it('releases the result of a statement that was cancelled while the shell read its rows', async () => {
        let finishReading = (_rows: Uint8Array) => { };
        const preview = vi.fn(() => new Promise<Uint8Array>(resolve => { finishReading = resolve; }));
        const release = vi.fn();
        const shell = await createShell(environmentWithResult(2, preview, release));
        await run(shell, '.output table');
        const abort = new AbortController();
        const onResult = vi.fn();
        const pending = run(shell, 'SELECT 1', abort.signal, onResult);
        await vi.waitFor(() => expect(preview).toHaveBeenCalled());
        abort.abort();
        await expect(pending).resolves.toEqual([record(Kind.STATUS, 'Cancelled')]);
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
        await expect(run(shell, 'SELECT 1', abort.signal, onResult)).resolves.toEqual([record(Kind.STATUS, 'Cancelled')]);
        await vi.waitFor(() => expect(release).toHaveBeenCalledWith(7));
        expect(onResult).not.toHaveBeenCalled();

        // A result that the shell passes on stays
        const passedOn = await createShell(environmentWithResult(2, undefined, release));
        await run(passedOn, 'SELECT 1', undefined, onResult);
        expect(onResult).toHaveBeenCalledWith(7, 2, false);
        expect(release).toHaveBeenCalledTimes(1);
        passedOn.destroy();
        shell.destroy();
    });

    it('offers the output only to an environment with previews', async () => {
        const without = await createShell(environmentWithResult(2));
        const [withoutHelp] = await run(without, '.help');
        expect(withoutHelp.text).not.toContain('.output');
        without.destroy();

        const shell = await createShell(environmentWithResult(2, async () => previewRows));
        const [help] = await run(shell, '.help');
        expect(help.text).toContain('.output');
        await expect(run(shell, '.output wide')).resolves.toEqual([record(Kind.ERROR, 'usage: .output [overlay|table]')]);
        shell.destroy();
    });
});
