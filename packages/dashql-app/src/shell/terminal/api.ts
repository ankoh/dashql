import { DashQL, DashQLCatalog, type Shell, type ShellOperation } from '@akohn/dashql';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';

export enum DashQLShellStatus {
    OK = 0,
    INVALID_ARGUMENT = 1,
    INTERNAL_ERROR = 2,
    PENDING = 3,
    STALE_EFFECT = 4,
    BUSY = 5,
}

export enum DashQLShellEffectType {
    EXECUTE_QUERY = 1,
    EXECUTE_COMMAND = 2,
}

enum DashQLShellEffectCompletionStatus {
    SUCCESS = 0,
    ERROR = 1,
    CANCELLED = 2,
}

export interface DashQLShellEnvironment {
    /// Execute a query, the environment keeps the result. A result with columns is reported through `onResult`.
    executeQuery(
        query: string,
        signal?: AbortSignal,
        onProgress?: (message: string) => void,
        onResult?: (queryId: number, rowCount: number) => void,
        onTiming?: (elapsedMs: number) => void,
    ): Promise<void>;
    /// The first rows of a result that `executeQuery` reported, at most `limit`, as an Arrow IPC stream. A shell whose
    /// environment has none shows every result in the overlay.
    previewResult?(queryId: number, limit: number): Promise<Uint8Array>;
    /// Release a result that `executeQuery` reported and the shell did not pass on, e.g. of a statement that was
    /// cancelled before the shell showed its result
    releaseResult?(queryId: number): void;
}

/// Where a shell shows the results of its queries: in the result overlay of the page, or as a table in its output
export type DashQLShellOutput = 'overlay' | 'table';

/// Reports a result with columns, `inFeed` if the shell shows it as a table and the overlay stays closed
export type DashQLShellResultCallback = (queryId: number, rowCount: number, inFeed: boolean) => void;

export interface DashQLShellCommandContext {
    readonly signal?: AbortSignal;
    readonly onProgress?: (message: string) => void;
}

export type DashQLShellCommandFunction = (
    args: readonly string[],
    context: DashQLShellCommandContext,
) => string | void | Promise<string | void>;

export type DashQLShellCommand = readonly [
    name: string,
    description: string,
    execute: DashQLShellCommandFunction,
];

interface DashQLShellOperation {
    status: DashQLShellStatus;
    /// The error message of an operation that failed
    message: string;
    /// The records of the output of a finished operation
    records: DashQLShellRecord[];
    effect: DashQLShellEffect | null;
}

interface DashQLShellEffect {
    id: bigint;
    type: DashQLShellEffectType;
    payload: string;
}

interface DashQLShellEffectResult {
    status: DashQLShellEffectCompletionStatus;
    data: Uint8Array;
}

interface DashQLShellSettings {
    timer: boolean;
    output: DashQLShellOutput;
}

export interface DashQLShellOptions {
    /// The core the shell runs on
    core: DashQL;
    /// The catalog of the shell, it stays with the caller. Without one the shell has a catalog of its own.
    catalog?: DashQLCatalog;
    environment: DashQLShellEnvironment;
    commands?: readonly DashQLShellCommand[];
    /// The width of the tables of results in characters
    columns?: number;
}

/// The kind of a record of the output of the shell
export enum DashQLShellRecordKind {
    /// The output of a command
    TEXT = 0,
    /// A status line, e.g. `Query completed (3 rows)`
    STATUS = 1,
    /// A table of the first rows of a result, drawn with box characters
    TABLE = 2,
    /// The error of a query or a command
    ERROR = 3,
    /// The records before it go, e.g. after `.clear`
    CLEAR = 4,
}

/// A record of the output of the shell
export interface DashQLShellRecord {
    kind: DashQLShellRecordKind;
    /// The text without a trailing line break, lines end with `\n`
    text: string;
}

/// What a prompt is
export interface DashQLShellPromptInfo {
    /// Is the prompt a dot command? It gets no SQL assistance.
    isCommand: boolean;
    /// Does Enter submit the prompt?
    isComplete: boolean;
}

/// The completion of the name of a dot command
export interface DashQLShellCommandCompletion {
    /// The prompt with the completed name
    text: string;
    /// The matching commands with their dots, if more than one matches
    candidates: string[];
}

/// The status line of a statement without columns
const NO_RESULTS_MESSAGE = 'No results';
/// The rows of a result that the shell shows as a table at most
export const SHELL_PREVIEW_ROW_LIMIT = 100;

/// What the data of a query effect holds, its first byte
enum DashQLShellQueryResultTag {
    /// A status line
    STATUS = 0,
    /// The length of a status line as u32 LE, the status line, then the first rows of the result as Arrow IPC
    PREVIEW = 1,
}

/// The status line of a result
export function formatQueryCompletion(rowCount: number): string {
    return `Query completed (${rowCount} ${rowCount === 1 ? 'row' : 'rows'})`;
}

/// The status line below the table of the first rows of a result, `hint` says how to see all of them
export function formatPreviewCompletion(rowCount: number, limit: number, hint: string | null): string {
    if (rowCount <= limit) return formatQueryCompletion(rowCount);
    return `Query completed (${rowCount} rows, the first ${limit} shown${hint == null ? '' : `, ${hint}`})`;
}

export class DashQLShellError extends Error {
    constructor(
        public readonly status: DashQLShellStatus,
        message: string,
    ) {
        super(message);
        this.name = 'DashQLShellError';
    }
}

export class DashQLShell {
    private readonly textEncoder = new TextEncoder();
    private shell: Shell | null;
    private readonly lifecycleAbort = new AbortController();
    private activeExecution: AbortController | null = null;
    private readonly commands: Map<string, DashQLShellCommand>;
    private readonly settings: DashQLShellSettings;

    private constructor(
        public readonly core: DashQL,
        public readonly catalog: DashQLCatalog,
        private readonly ownsCatalog: boolean,
        private readonly environment: DashQLShellEnvironment,
        columns: number,
        commands: Map<string, DashQLShellCommand>,
        settings: DashQLShellSettings,
    ) {
        this.commands = commands;
        this.settings = settings;
        this.shell = new core.bindings.Shell(catalog.ptr.assertNotNull(), columns);
        const status = this.shell.setCommands(Array.from(commands.keys()).join('\n')) as DashQLShellStatus;
        if (status !== DashQLShellStatus.OK) {
            this.shell.free();
            this.shell = null;
            throw new DashQLShellError(status, 'failed to configure shell commands');
        }
    }

    static async create(options: DashQLShellOptions): Promise<DashQLShell> {
        const settings: DashQLShellSettings = { timer: false, output: 'overlay' };
        const commands = createShellCommands(options.commands ?? [], settings, options.environment.previewResult != null);
        const core = options.core;
        const catalog = options.catalog ?? core.createCatalog();
        return new DashQLShell(
            core,
            catalog,
            options.catalog == null,
            options.environment,
            options.columns ?? 100,
            commands,
            settings,
        );
    }

    /// The width of the tables of results in characters
    resize(columns: number): void {
        this.alive().resize(columns);
    }

    /// What a prompt is: a dot command, and whether Enter submits it
    promptInfo(text: string): DashQLShellPromptInfo {
        const info = this.alive().promptInfo(text);
        try {
            return { isCommand: info.isCommand, isComplete: info.isComplete };
        } finally {
            info.free();
        }
    }

    /// Complete the name of the dot command of a prompt
    completeCommand(text: string): DashQLShellCommandCompletion {
        const completion = this.alive().completeCommand(text);
        try {
            return { text: completion.text, candidates: completion.candidates };
        } finally {
            completion.free();
        }
    }

    /// The previous entry of the history for the prompt, null at the oldest entry
    historyPrevious(text: string): string | null {
        return this.alive().historyPrevious(text) ?? null;
    }

    /// The next entry of the history for the prompt, the draft after the newest one, null if the prompt shows no entry
    historyNext(text: string): string | null {
        return this.alive().historyNext(text) ?? null;
    }

    exportHistory(): Uint8Array {
        return this.alive().exportHistory();
    }

    importHistory(data: Uint8Array): void {
        const status = this.alive().importHistory(data) as DashQLShellStatus;
        if (status !== DashQLShellStatus.OK) {
            throw new DashQLShellError(status, 'failed to import shell history');
        }
    }

    /// Run a prompt as a dot command or a query, the history remembers it. Resolves with the records of its output.
    async submit(
        prompt: string,
        signal?: AbortSignal,
        onProgress?: (message: string) => void,
        onResult?: DashQLShellResultCallback,
    ): Promise<DashQLShellRecord[]> {
        return await this.executeOperation(() => this.readOperation(this.alive().submit(prompt)), signal, onProgress, onResult);
    }

    private async executeOperation(
        start: () => DashQLShellOperation,
        signal?: AbortSignal,
        onProgress?: (message: string) => void,
        onResult?: DashQLShellResultCallback,
    ): Promise<DashQLShellRecord[]> {
        // A destroyed shell runs nothing
        this.alive();
        if (this.activeExecution != null) {
            throw new DashQLShellError(DashQLShellStatus.BUSY, 'the shell already has an active operation');
        }
        const executionAbort = new AbortController();
        this.activeExecution = executionAbort;
        const abortExecution = () => executionAbort.abort();
        this.lifecycleAbort.signal.addEventListener('abort', abortExecution, { once: true });
        signal?.addEventListener('abort', abortExecution, { once: true });

        try {
            let operation = start();
            let queryStartedAt: number | null = null;
            // The milliseconds until the results of the queries arrived
            const resultTimings: number[] = [];
            while (operation.status === DashQLShellStatus.PENDING) {
                const effect = this.requireEffect(operation);
                if (effect.type === DashQLShellEffectType.EXECUTE_QUERY && this.settings.timer) {
                    queryStartedAt = performance.now();
                }
                const completion = await this.runEffect(
                    effect,
                    executionAbort.signal,
                    onProgress,
                    onResult,
                    queryStartedAt == null
                        ? undefined
                        : elapsedMs => { resultTimings.push(elapsedMs); },
                );
                if (this.shell == null) {
                    throw new DashQLShellError(DashQLShellStatus.STALE_EFFECT, 'DashQL shell was destroyed');
                }
                operation = completion.status === DashQLShellEffectCompletionStatus.CANCELLED
                    ? this.cancelEffect(effect.id)
                    : this.completeEffect(effect.id, completion.status, completion.data);
            }
            const records = this.requireComplete(operation);
            if (resultTimings.length === 0) return records;
            const resultsMs = resultTimings.reduce((sum, elapsedMs) => sum + elapsedMs, 0);
            return [...records, { kind: DashQLShellRecordKind.STATUS, text: `Results: ${formatElapsed(resultsMs)}` }];
        } finally {
            this.lifecycleAbort.signal.removeEventListener('abort', abortExecution);
            signal?.removeEventListener('abort', abortExecution);
            if (this.activeExecution === executionAbort) {
                this.activeExecution = null;
            }
        }
    }

    private readOperation(operation: ShellOperation): DashQLShellOperation {
        try {
            const status = operation.status as DashQLShellStatus;
            const effectId = operation.effectId;
            const effectType = operation.effectType;
            const kinds = operation.recordKinds;
            const texts = operation.recordTexts;
            return {
                status,
                message: operation.message,
                records: Array.from(kinds, (kind, i) => ({ kind: kind as DashQLShellRecordKind, text: texts[i] ?? '' })),
                effect: status === DashQLShellStatus.PENDING && effectId != null && effectType != null
                    ? { id: effectId, type: effectType as DashQLShellEffectType, payload: operation.effectPayload ?? '' }
                    : null,
            };
        } finally {
            operation.free();
        }
    }

    private async runEffect(
        effect: DashQLShellEffect,
        signal?: AbortSignal,
        onProgress?: (message: string) => void,
        onResult?: DashQLShellResultCallback,
        onTiming?: (elapsedMs: number) => void,
    ): Promise<DashQLShellEffectResult> {
        if (
            effect.type !== DashQLShellEffectType.EXECUTE_QUERY &&
            effect.type !== DashQLShellEffectType.EXECUTE_COMMAND
        ) {
            return {
                status: DashQLShellEffectCompletionStatus.ERROR,
                data: this.textEncoder.encode(`unsupported shell effect ${effect.type}`),
            };
        }

        return await new Promise<DashQLShellEffectResult>((resolve) => {
            let settled = false;
            const finish = (completion: DashQLShellEffectResult) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener('abort', onAbort);
                resolve(completion);
            };
            const onAbort = () => finish({
                status: DashQLShellEffectCompletionStatus.CANCELLED,
                data: new Uint8Array(),
            });
            if (signal?.aborted) {
                onAbort();
                return;
            }
            signal?.addEventListener('abort', onAbort, { once: true });

            const effectInput = effect.payload;
            Promise.resolve()
                .then(async () => {
                    if (effect.type === DashQLShellEffectType.EXECUTE_QUERY) {
                        let result = null as { queryId: number; rowCount: number } | null;
                        let passedOn = false;
                        try {
                            await this.environment.executeQuery(
                                effectInput,
                                signal,
                                onProgress,
                                (queryId, rowCount) => { result = { queryId, rowCount }; },
                                onTiming,
                            );
                            return await this.encodeQueryResult(result, signal, (queryId, rowCount, inFeed) => {
                                passedOn = onResult != null;
                                onResult?.(queryId, rowCount, inFeed);
                            });
                        } finally {
                            // A cancelled statement passes on no result, its result would stay with the environment
                            if (result != null && !passedOn) this.environment.releaseResult?.(result.queryId);
                        }
                    }
                    const command = await this.executeCommand(effectInput, signal, onProgress);
                    const output = this.textEncoder.encode(command.output);
                    const encoded = new Uint8Array(output.byteLength + 1);
                    encoded[0] = command.clear ? 1 : 0;
                    encoded.set(output, 1);
                    return encoded;
                })
                .then(
                    data => finish({
                        status: DashQLShellEffectCompletionStatus.SUCCESS,
                        data,
                    }),
                    error => {
                        finish({
                            status: DashQLShellEffectCompletionStatus.ERROR,
                            data: this.textEncoder.encode(stringifyError(error)),
                        });
                    },
                );
        });
    }

    /// The data of a query effect: a status line, or with the output `table` the first rows of the result and a
    /// status line. A result whose rows can't be read shows in the overlay, its status line says why. The result of a
    /// cancelled statement is not passed on.
    private async encodeQueryResult(
        result: { queryId: number; rowCount: number } | null,
        signal?: AbortSignal,
        onResult?: DashQLShellResultCallback,
    ): Promise<Uint8Array> {
        if (result == null) return this.encodeQueryStatus(NO_RESULTS_MESSAGE);
        const { queryId, rowCount } = result;
        let status = formatQueryCompletion(rowCount);
        if (this.settings.output === 'table' && this.environment.previewResult != null) {
            try {
                const rows = await this.environment.previewResult(queryId, SHELL_PREVIEW_ROW_LIMIT);
                signal?.throwIfAborted();
                onResult?.(queryId, rowCount, true);
                const hint = this.commands.has('last') ? '.last shows all' : null;
                return this.encodeQueryPreview(formatPreviewCompletion(rowCount, SHELL_PREVIEW_ROW_LIMIT, hint), rows);
            } catch (error) {
                signal?.throwIfAborted();
                status = `${status}, no table in the shell: ${stringifyError(error)}`;
            }
        }
        onResult?.(queryId, rowCount, false);
        return this.encodeQueryStatus(status);
    }

    private encodeQueryStatus(status: string): Uint8Array {
        const text = this.textEncoder.encode(status);
        const encoded = new Uint8Array(text.byteLength + 1);
        encoded[0] = DashQLShellQueryResultTag.STATUS;
        encoded.set(text, 1);
        return encoded;
    }

    private encodeQueryPreview(status: string, rows: Uint8Array): Uint8Array {
        const text = this.textEncoder.encode(status);
        const encoded = new Uint8Array(5 + text.byteLength + rows.byteLength);
        encoded[0] = DashQLShellQueryResultTag.PREVIEW;
        new DataView(encoded.buffer).setUint32(1, text.byteLength, true);
        encoded.set(text, 5);
        encoded.set(rows, 5 + text.byteLength);
        return encoded;
    }

    private async executeCommand(
        input: string,
        signal?: AbortSignal,
        onProgress?: (message: string) => void,
    ): Promise<{ output: string; clear: boolean }> {
        const [name, ...args] = input.trim().substring(1).split(/\s+/);
        const command = this.commands.get(name.toLowerCase());
        if (command == null) throw new Error(`unknown command: .${name}`);
        return {
            output: await command[2](args, { signal, onProgress }) ?? '',
            clear: name.toLowerCase() === 'clear',
        };
    }

    private completeEffect(
        effectId: bigint,
        status: DashQLShellEffectCompletionStatus,
        data: Uint8Array,
    ): DashQLShellOperation {
        return this.readOperation(this.alive().completeEffect(effectId, status, data));
    }

    private cancelEffect(effectId: bigint): DashQLShellOperation {
        return this.readOperation(this.alive().cancelEffect(effectId));
    }

    private requireComplete(operation: DashQLShellOperation): DashQLShellRecord[] {
        if (operation.status !== DashQLShellStatus.OK) {
            throw new DashQLShellError(operation.status, operation.message);
        }
        return operation.records;
    }

    private requireEffect(operation: DashQLShellOperation): DashQLShellEffect {
        if (operation.status !== DashQLShellStatus.PENDING) {
            throw new DashQLShellError(operation.status, operation.message);
        }
        if (operation.effect == null) {
            throw new DashQLShellError(DashQLShellStatus.INTERNAL_ERROR, 'invalid shell effect envelope');
        }
        return operation.effect;
    }

    destroy(): void {
        if (this.shell != null) {
            this.lifecycleAbort.abort();
            this.shell.free();
            this.shell = null;
            if (this.ownsCatalog) this.catalog.destroy();
        }
    }

    private alive(): Shell {
        if (this.shell == null) {
            throw new DashQLShellError(DashQLShellStatus.INVALID_ARGUMENT, 'DashQL shell has been destroyed');
        }
        return this.shell;
    }
}

function createShellCommands(
    extensions: readonly DashQLShellCommand[],
    settings: DashQLShellSettings,
    previewsResults: boolean,
): Map<string, DashQLShellCommand> {
    const commands = new Map<string, DashQLShellCommand>();
    const register = (command: DashQLShellCommand) => {
        const name = command[0].toLowerCase();
        if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`invalid shell command name: ${command[0]}`);
        if (commands.has(name)) throw new Error(`duplicate shell command: .${name}`);
        commands.set(name, [name, command[1], command[2]]);
    };
    register(['clear', 'Clear the output of the shell', () => undefined]);
    register([
        'timer',
        'Set query timer: on or off',
        args => {
            if (args.length > 1 || (args.length === 1 && !['on', 'off'].includes(args[0]))) {
                throw new Error('usage: .timer [on|off]');
            }
            if (args.length === 1) settings.timer = args[0] === 'on';
            return `Timer: ${settings.timer ? 'on' : 'off'}`;
        },
    ]);
    if (previewsResults) {
        register([
            'output',
            'Show query results in the overlay or as a table in the shell',
            args => {
                if (args.length > 1 || (args.length === 1 && !['overlay', 'table'].includes(args[0]))) {
                    throw new Error('usage: .output [overlay|table]');
                }
                if (args.length === 1) settings.output = args[0] as DashQLShellOutput;
                return settings.output === 'table'
                    ? `Query output: table (the first ${SHELL_PREVIEW_ROW_LIMIT} rows in the shell)`
                    : 'Query output: overlay';
            },
        ]);
    }
    register([
        'help',
        'List available dot commands',
        () => {
            const width = Math.max(...Array.from(commands.keys(), name => name.length)) + 3;
            return Array.from(commands.values(), command => `.${command[0]}`.padEnd(width) + command[1]).join('\n');
        },
    ]);
    for (const command of extensions) register(command);
    return commands;
}

function formatElapsed(elapsedMs: number): string {
    if (elapsedMs < 1000) return `${Math.round(elapsedMs)} ms`;
    if (elapsedMs < 60_000) return `${(elapsedMs / 1000).toFixed(3)} s`;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const milliseconds = Math.floor(elapsedMs) % 1000;
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    const suffix = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
    return hours === 0 ? suffix : `${String(hours).padStart(2, '0')}:${suffix}`;
}
