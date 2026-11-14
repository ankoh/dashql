import type { HyperDBSettingValue } from 'hyperdb-wasm';

import type { OutputFormat } from '../format.js';
import type { SqlStatement } from '../statements.js';

/// What a session asks its engine process. The process opens the engine once and runs one request at a time.
export type EngineRequest =
    | {
          readonly type: 'open';
          /// The absolute path of the database, locked by the session
          readonly database: string | null;
          readonly workDirectory: string;
          readonly settings: Record<string, HyperDBSettingValue>;
      }
    | {
          readonly type: 'run';
          readonly id: number;
          readonly statements: SqlStatement[];
          readonly format: OutputFormat;
          readonly maxRows: number;
      }
    | { readonly type: 'cancel'; readonly id: number }
    | { readonly type: 'close' };

/// The statement that failed
export interface FailedStatement {
    /// Counted from 1
    readonly statement: number;
    /// The line of the statement in the SQL text
    readonly line: number;
    readonly sqlState: string | null;
}

/// What the engine process sends back
export type EngineMessage =
    | { readonly type: 'opened' }
    /// usage: the error is the caller's (a setting, the runtime), the command exits with 2
    | { readonly type: 'open-failed'; readonly message: string; readonly usage: boolean }
    | { readonly type: 'stdout'; readonly id: number; readonly text: string }
    | { readonly type: 'stderr'; readonly id: number; readonly text: string }
    | { readonly type: 'done'; readonly id: number; readonly failed: FailedStatement | null; readonly cancelled: boolean }
    | { readonly type: 'closed' };
