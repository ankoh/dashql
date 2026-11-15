import type * as glue from './wasm/dashql_core.js';
import { DashQL, Ptr } from './api.js';
import { DashQLConnection } from './connection.js';
import type { DashQLStorageWriter } from './storage_writer.js';
import { connectionArgs, DashQLWorkbook, type WorkbookConnection } from './workbook.js';

export type { RestoreHost } from './wasm/dashql_core.js';

const APP_RESTORE_TYPE = Symbol('APP_RESTORE_TYPE');

/// A counter of the progress of a step of a restore
export interface RestoreProgressCounter {
    started: number;
    succeeded: number;
    skipped: number;
    failed: number;
    total: number | null;
}

/// The progress of a restore
export interface RestoreProgress {
    restoreConnections: RestoreProgressCounter;
    restoreCatalogs: RestoreProgressCounter;
    restoreWorkbookScripts: RestoreProgressCounter;
}

/// A restored connection
export interface RestoredConnection {
    connectionId: string;
    /// The connector, the number of `ConnectorType`
    connectorType: number;
    /// The Rust connection
    connection: DashQLConnection;
}

/// A restored workbook
export interface RestoredWorkbook {
    workbookId: string;
    name: string | null;
    /// The metadata of the workbook file, without the ephemeral marker of a promoted workbook
    metadata: unknown;
    /// The connections of the scripts and the pending connection
    connectionIds: string[];
    /// The Rust workbook
    workbook: DashQLWorkbook;
}

/// A workbook that failed its validation or couldn't be restored
export interface RestoredInvalidWorkbook {
    workbookId: string;
    title: string;
    connectorType: number | null;
    /// The code of the validation error, e.g. `unsupported_format_version`
    error: string;
}

/// What a restore restored
export interface DashQLRestoredState {
    connections: RestoredConnection[];
    workbooks: RestoredWorkbook[];
    invalidWorkbooks: RestoredInvalidWorkbook[];
    progress: RestoreProgress;
}

interface Summary {
    connections: { connectionId: string; connectorType: number }[];
    workbooks: { workbookId: string; name: string | null; metadata: unknown; connectionIds: string[] }[];
    invalidWorkbooks: RestoredInvalidWorkbook[];
    progress: RestoreProgress;
}

/// Take the connections and workbooks out of a restored state of the module
function readState(api: DashQL, state: glue.RestoredState): DashQLRestoredState {
    try {
        const summary = JSON.parse(state.summary()) as Summary;
        return {
            connections: summary.connections.map((info, index) => {
                const native = state.takeConnection(index);
                if (native == null) throw new Error(`the restore holds no connection ${info.connectionId}`);
                return { ...info, connection: DashQLConnection.adopt(api, native) };
            }),
            workbooks: summary.workbooks.map((info, index) => {
                const native = state.takeWorkbook(index);
                if (native == null) throw new Error(`the restore holds no workbook ${info.workbookId}`);
                return { ...info, workbook: DashQLWorkbook.adopt(api, native) };
            }),
            invalidWorkbooks: summary.invalidWorkbooks,
            progress: summary.progress,
        };
    } finally {
        state.free();
    }
}

/// The restore of the stored state in the Rust runtime: the connections of the app manifest with their catalogs and
/// the workbooks of the workbook tree. It reads through its host and writes through a storage writer, and runs once.
export class DashQLAppRestore {
    public readonly ptr: Ptr<typeof APP_RESTORE_TYPE, glue.AppRestore>;

    public constructor(ptr: Ptr<typeof APP_RESTORE_TYPE, glue.AppRestore>) {
        this.ptr = ptr;
    }

    /// A restore on a host that writes through a storage writer of the module, the instances of a module share it
    public static create(api: DashQL, host: glue.RestoreHost, writer: DashQLStorageWriter, offsetUnit: number): DashQLAppRestore {
        return new DashQLAppRestore(new Ptr(APP_RESTORE_TYPE, api, new api.bindings.AppRestore(host, writer.ptr.assertNotNull(), offsetUnit)));
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    /// A connection that the app holds already: its stored params and the connection of its scripts
    public addLiveConnection(params: unknown, connection: WorkbookConnection): void {
        const [connectionId, ...rest] = connectionArgs(this.ptr.api, connection);
        this.ptr.assertNotNull().addLiveConnection(connectionId, JSON.stringify(params), ...rest);
    }

    /// Restore the connections of the app manifest and the workbooks of the workbook tree
    public async restore(): Promise<DashQLRestoredState> {
        try {
            const state = await this.ptr.assertNotNull().restore() as glue.RestoredState;
            return readState(this.ptr.api, state);
        } finally {
            this.destroy();
        }
    }

    /// Restore a single stored workbook against the live connections, rejects if it can't be restored
    public async restoreWorkbook(workbookId: string): Promise<DashQLRestoredState> {
        try {
            const state = await this.ptr.assertNotNull().restoreWorkbook(workbookId) as glue.RestoredState;
            return readState(this.ptr.api, state);
        } finally {
            this.destroy();
        }
    }
}
