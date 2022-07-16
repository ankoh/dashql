import * as React from 'react';
import * as dashql from '@dashql/dashql-core/dist/wasm';
import * as duckdb from '@duckdb/duckdb-wasm';

import { Resolvable, ResolvableStatus } from '../model';
import { Backend } from './backend';
import {
    BackendInstantiationProgress as BackendProgress,
    BACKEND_CONTEXT,
    BACKEND_RESOLVER_CONTEXT,
    InstantiationError,
    InstantiationStatus,
} from './backend_provider';

import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm';
import { instantiateParserStreaming, Parser } from './wasm_parser_api';
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
const DUCKDB_LOGGER = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);

interface Props {
    children: JSX.Element;
}

type ProgressUpdater = (fn: (progress: BackendProgress) => BackendProgress) => void;

let PARSER_INSTANCE: Parser | null = null;
async function initParser(progress: ProgressUpdater): Promise<[Parser | null, InstantiationError | null]> {
    try {
        if (PARSER_INSTANCE == null) {
            progress(p => ({ ...p, parser: [InstantiationStatus.INSTANTIATING, null] }));
            PARSER_INSTANCE = await instantiateParserStreaming(fetch(PARSER_MODULE_URL.href));
        }
        progress(p => ({ ...p, parser: [InstantiationStatus.READY, null] }));
        return [PARSER_INSTANCE, null];
    } catch (e: any) {
        progress(p => ({ ...p, parser: [InstantiationStatus.FAILED, e] }));
        throw e;
        //console.error(e);
        //return [null, e];
    }
}

let DUCKDB_INSTANCE: duckdb.AsyncDuckDB | null = null;
async function initDuckDB(progress: ProgressUpdater): Promise<[duckdb.AsyncDuckDB | null, InstantiationError | null]> {
    try {
        if (PARSER_INSTANCE == null) {
            progress(p => ({ ...p, db: [InstantiationStatus.PREPARING, null] }));
            const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
            const worker = new Worker(bundle.mainWorker!);
            progress(p => ({ ...p, db: [InstantiationStatus.INSTANTIATING, null] }));
            const instance = new duckdb.AsyncDuckDB(DUCKDB_LOGGER, worker);
            await instance.instantiate(bundle.mainModule);
            DUCKDB_INSTANCE = instance;
        }
        progress(p => ({ ...p, db: [InstantiationStatus.READY, null] }));
        return [DUCKDB_INSTANCE, null];
    } catch (e: any) {
        progress(p => ({ ...p, db: [InstantiationStatus.FAILED, e] }));
        console.error(e);
        return [null, e];
    }
}

let DASHQL_INITIALIZED = false;
async function initCore(progress: ProgressUpdater): Promise<InstantiationError | null> {
    try {
        if (!DASHQL_INITIALIZED) {
            const [parserRes, dbRes] = await Promise.all([initParser(progress), initDuckDB(progress)]);
            const [parser, parserError] = parserRes;
            const [db, dbError] = dbRes;
            const anyError = parserError ?? dbError;
            if (anyError != null) {
                return anyError;
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
        return null;
    } catch (e: any) {
        progress(p => ({ ...p, core: [InstantiationStatus.FAILED, e] }));
        throw e;
        // console.error(e);
        // return e;
    }
}

export const WasmBackendProvider: React.FC<Props> = (props: Props) => {
    const resolverInFlight = React.useRef<Promise<Backend | null> | null>(null);
    const [backend, setBackend] = React.useState<Resolvable<Backend, BackendProgress>>(
        new Resolvable<Backend, BackendProgress>(ResolvableStatus.NONE, {
            db: [null, null],
            core: [null, null],
            parser: [null, null],
        }),
    );
    const backendResolver = React.useCallback(async () => {
        if (resolverInFlight.current) return await resolverInFlight.current;
        resolverInFlight.current = (async () => {
            const updater = (fn: (progress: BackendProgress) => BackendProgress) => {
                setBackend(r => r.updateProgressWith(fn));
            };
            const coreError = await initCore(updater);
            if (coreError == null) {
                const b = createWasmBackend();
                setBackend(r => r.completeWith(b));
                return b;
            } else {
                setBackend(r => r.failWith(coreError));
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
