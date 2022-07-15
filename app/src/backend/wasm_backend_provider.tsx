import * as React from 'react';
import * as dashql from '@dashql/dashql-core/dist/wasm';
import * as duckdb from '@duckdb/duckdb-wasm';

import { Resolvable } from '../model';
import { Backend } from './backend';
import {
    BackendInstantiationProgress as BackendInitProgress,
    BACKEND_CONTEXT,
    BACKEND_RESOLVER_CONTEXT,
    InstantiationStatus,
} from './backend_provider';
import { init as initWASI, WASI } from '@wasmer/wasi';

import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm';
import { Parser } from './wasm_parser_api';
import { createWasmBackend } from './wasm_backend';

const PARSER_MODULE_URL = new URL('../../../libs/dashql-parser/build/wasm/Release/dashql_parser.wasm', import.meta.url);
const DASHQL_MODULE_URL = new URL('../../../libs/dashql-core/dist/wasm/dashql_core_bg.wasm', import.meta.url);
const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
    mvp: {
        mainModule: duckdb_wasm,
        mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js', import.meta.url).toString(),
    },
    eh: {
        mainModule: duckdb_wasm_eh,
        mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js', import.meta.url).toString(),
    },
};
const dbLogger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);

interface Props {
    children: JSX.Element;
}

type ProgressUpdater = (fn: (progress: BackendInitProgress) => BackendInitProgress) => void;

let PARSER_INSTANCE: Parser | null = null;
async function initParser(progress: ProgressUpdater): Promise<Parser | null> {
    try {
        if (PARSER_INSTANCE == null) {
            progress(p => ({ ...p, parser: [InstantiationStatus.PREPARING, null] }));
            await initWASI();
            const wasi = new WASI({
                env: {},
                args: [],
            });
            progress(p => ({ ...p, parser: [InstantiationStatus.COMPILING, null] }));
            const mod = await WebAssembly.compileStreaming(fetch(PARSER_MODULE_URL.href));
            progress(p => ({ ...p, parser: [InstantiationStatus.INSTANTIATING, null] }));
            const inst = await wasi.instantiate(mod, {});
            wasi.start();
            PARSER_INSTANCE = new Parser(inst);
        }
        progress(p => ({ ...p, parser: [InstantiationStatus.READY, null] }));
        return PARSER_INSTANCE;
    } catch (e: any) {
        progress(p => ({ ...p, parser: [InstantiationStatus.FAILED, e] }));
        return null;
    }
}

let DUCKDB_INSTANCE: duckdb.AsyncDuckDB | null = null;
async function initDuckDB(progress: ProgressUpdater): Promise<duckdb.AsyncDuckDB | null> {
    try {
        if (PARSER_INSTANCE == null) {
            progress(p => ({ ...p, db: [InstantiationStatus.PREPARING, null] }));
            const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
            const worker = new Worker(bundle.mainWorker!);
            progress(p => ({ ...p, db: [InstantiationStatus.INSTANTIATING, null] }));
            DUCKDB_INSTANCE = new duckdb.AsyncDuckDB(dbLogger, worker);
        }
        progress(p => ({ ...p, db: [InstantiationStatus.READY, null] }));
        return DUCKDB_INSTANCE;
    } catch (e: any) {
        progress(p => ({ ...p, db: [InstantiationStatus.FAILED, e] }));
        return null;
    }
}

let DASHQL_INITIALIZED = false;
async function initCore(progress: ProgressUpdater): Promise<boolean> {
    try {
        if (!DASHQL_INITIALIZED) {
            const [parser, db] = await Promise.all([initParser(progress), initDuckDB(progress)]);
            if (parser == null || db == null) {
                return false;
            }
            progress(p => ({ ...p, core: [InstantiationStatus.INSTANTIATING, null] }));
            await dashql.init(DASHQL_MODULE_URL);
            dashql.linkParser(parser);
            dashql.linkDuckDB(db);
            progress(p => ({ ...p, core: [InstantiationStatus.CONFIGURING, null] }));
            await dashql.workflowConfigureDefault();
            DASHQL_INITIALIZED = true;
        }
        progress(p => ({ ...p, core: [InstantiationStatus.READY, null] }));
        return true;
    } catch (e: any) {
        progress(p => ({ ...p, core: [InstantiationStatus.FAILED, e] }));
        return false;
    }
}

export const WasmBackendProvider: React.FC<Props> = (props: Props) => {
    const resolverInFlight = React.useRef<Promise<Backend | null> | null>(null);
    const [backend, setBackend] = React.useState<Resolvable<Backend, BackendInitProgress>>(new Resolvable<Backend>());
    const backendResolver = React.useCallback(async () => {
        resolverInFlight.current = (async () => {
            const updater = (fn: (progress: BackendInitProgress) => BackendInitProgress) => {
                setBackend(r => r.updateProgressWith(fn));
            };
            if (await initCore(updater)) {
                const b = createWasmBackend();
                setBackend(r => r.completeWith(b));
                return b;
            } else {
                setBackend(r => r.failWith('instantiation failed'));
                return null;
            }
        })();
        return await resolverInFlight.current;
    }, []);

    return (
        <BACKEND_RESOLVER_CONTEXT.Provider value={backendResolver}>
            <BACKEND_CONTEXT.Provider value={backend}>{props.children}</BACKEND_CONTEXT.Provider>;
        </BACKEND_RESOLVER_CONTEXT.Provider>
    );
};
