import type * as glue from './wasm/dashql_core.js';
import { DashQL, Ptr } from './api.js';
import type { DashQLStorageWriter } from './storage_writer.js';
import { connectionArgs, DashQLWorkbook, type WorkbookConnection } from './workbook.js';

export type { RestoreHost } from './wasm/dashql_core.js';
/// The views of a restore, declared by the module (`packages/dashql-core-wasm/src/restore/view.rs`)
export type {
    RestoredConnectionView,
    RestoredInvalidWorkbook,
    RestoredStateView,
    RestoredWorkbookView,
    RestoreProgress,
    RestoreProgressCounter,
    RestoreScriptFile,
} from './wasm/dashql_core.js';

const APP_RESTORE_TYPE = Symbol('APP_RESTORE_TYPE');

/// A restored connection, the runtime adopted it under its id
export type RestoredConnection = glue.RestoredConnectionView;

/// A restored workbook with the Rust workbook
export interface RestoredWorkbook extends glue.RestoredWorkbookView {
    workbook: DashQLWorkbook;
}

/// What a restore restored
export interface DashQLRestoredState extends glue.RestoredStateView {
    connections: RestoredConnection[];
    workbooks: RestoredWorkbook[];
}

/// Take the connections and workbooks out of a restored state of the module, the runtime adopts the connections
function readState(api: DashQL, state: glue.RestoredState, runtime: glue.Runtime): DashQLRestoredState {
    try {
        const view = state.view();
        return {
            ...view,
            connections: view.connections.map((info, index) => {
                if (runtime.adoptRestoredConnection(state, index) == null) throw new Error(`the restore holds no connection ${info.connectionId}`);
                return info;
            }),
            workbooks: view.workbooks.map((info, index) => {
                const native = state.takeWorkbook(index);
                if (native == null) throw new Error(`the restore holds no workbook ${info.workbookId}`);
                return { ...info, workbook: DashQLWorkbook.adopt(api, native) };
            }),
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
    public addLiveConnection(params: glue.JsonValue, connection: WorkbookConnection): void {
        const [connectionId, ...rest] = connectionArgs(this.ptr.api, connection);
        this.ptr.assertNotNull().addLiveConnection(connectionId, params, ...rest);
    }

    /// Restore the connections of the app manifest into a runtime and the workbooks of the workbook tree
    public async restore(runtime: glue.Runtime): Promise<DashQLRestoredState> {
        try {
            const state = await this.ptr.assertNotNull().restore() as glue.RestoredState;
            return readState(this.ptr.api, state, runtime);
        } finally {
            this.destroy();
        }
    }

    /// Restore a single stored workbook against the live connections, its new connections go into the runtime.
    /// Rejects if it can't be restored.
    public async restoreWorkbook(workbookId: string, runtime: glue.Runtime): Promise<DashQLRestoredState> {
        try {
            const state = await this.ptr.assertNotNull().restoreWorkbook(workbookId) as glue.RestoredState;
            return readState(this.ptr.api, state, runtime);
        } finally {
            this.destroy();
        }
    }
}
