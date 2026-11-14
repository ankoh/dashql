import type { HyperDBSettingValue } from 'hyperdb-wasm';

import type { OutputFormat } from '../format.js';
import type { SqlStatement } from '../statements.js';

/// What the command asks the engine process to run
export interface EngineRequest {
    readonly type: 'run';
    /// The absolute path of the database, locked by the command
    readonly database: string | null;
    readonly workDirectory: string;
    readonly settings: Record<string, HyperDBSettingValue>;
    readonly statements: SqlStatement[];
    readonly format: OutputFormat;
    readonly maxRows: number;
}

/// What the engine process sends back: the text for stdout and stderr, then its exit code
export type EngineMessage =
    | { readonly type: 'stdout'; readonly text: string }
    | { readonly type: 'stderr'; readonly text: string }
    | { readonly type: 'done'; readonly code: number };
