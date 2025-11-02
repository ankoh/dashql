import * as buffers from './buffers.js';
import * as flatbuffers from 'flatbuffers';

import { VariantKind } from './variant.js';

interface DashQLModuleExports {
    dashql_version: () => number;
    dashql_malloc: (length: number) => number;
    dashql_free: (ptr: number) => void;
    dashql_delete_result: (ptr: number) => void;

    dashql_script_new: (catalog: number, id: number) => number;
    dashql_script_insert_text_at: (ptr: number, offset: number, text: number, textLength: number) => void;
    dashql_script_insert_char_at: (ptr: number, offset: number, unicode: number) => void;
    dashql_script_erase_text_range: (ptr: number, offset: number, length: number) => void;
    dashql_script_replace_text: (ptr: number, text: number, textLength: number) => void;
    dashql_script_to_string: (ptr: number) => number;
    dashql_script_scan: (ptr: number) => number;
    dashql_script_parse: (ptr: number) => number;
    dashql_script_analyze: (ptr: number, parse_if_outdated: boolean) => number;
    dashql_script_move_cursor: (ptr: number, offset: number) => number;
    dashql_script_complete_at_cursor: (ptr: number, limit: number, registry: number) => number;
    dashql_script_select_completion_candidate_at_cursor: (ptr: number, completion: number, candidateId: number) => number;
    dashql_script_select_completion_catalog_object_at_cursor: (ptr: number, completion: number, candidateId: number, catalogObjectIdx: number) => number;
    dashql_script_get_catalog_entry_id: (ptr: number) => number;
    dashql_script_get_scanned: (ptr: number) => number;
    dashql_script_get_parsed: (ptr: number) => number;
    dashql_script_get_analyzed: (ptr: number) => number;
    dashql_script_get_statistics: (ptr: number) => number;

    dashql_catalog_new: () => number;
    dashql_catalog_clear: (catalog_ptr: number) => void;
    dashql_catalog_contains_entry_id: (catalog_ptr: number, external_id: number) => boolean;
    dashql_catalog_describe_entries: (catalog_ptr: number) => number;
    dashql_catalog_describe_entries_of: (catalog_ptr: number, external_id: number) => number;
    dashql_catalog_flatten: (catalog_ptr: number) => number;
    dashql_catalog_load_script: (catalog_ptr: number, script_ptr: number, rank: number) => number;
    dashql_catalog_update_script: (catalog_ptr: number, script_ptr: number) => number;
    dashql_catalog_drop_script: (catalog_ptr: number, script_ptr: number) => void;
    dashql_catalog_add_descriptor_pool: (catalog_ptr: number, external_id: number, rank: number) => number;
    dashql_catalog_drop_descriptor_pool: (catalog_ptr: number, external_id: number) => void;
    dashql_catalog_add_schema_descriptor: (
        catalog_ptr: number,
        external_id: number,
        data_ptr: number,
        data_size: number,
    ) => number;
    dashql_catalog_add_schema_descriptors: (
        catalog_ptr: number,
        external_id: number,
        data_ptr: number,
        data_size: number,
    ) => number;
    dashql_catalog_get_statistics: (ptr: number) => number;

    dashql_script_registry_new: () => number;
    dashql_script_registry_clear: (registry_ptr: number) => void;
    dashql_script_registry_add_script: (registry_ptr: number, script_ptr: number) => number;
    dashql_script_registry_drop_script: (registry_ptr: number, script_ptr: number) => void;
    dashql_script_registry_find_column: (registry_ptr: number, external_id: number, table_id: number, column_id: number, referenced_catalog_version: number) => number;

    dashql_plan_view_model_new: () => number;
    dashql_plan_view_model_load_hyper_plan: (viewmodel_ptr: number, text: number, text_length: number, hsep: number, vsep: number) => number;
}

type InstantiateWasmCallback = (stubs: WebAssembly.Imports) => PromiseLike<WebAssembly.WebAssemblyInstantiatedSource>;

interface FlatBufferObject<T, O> {
    __init(i: number, bb: flatbuffers.ByteBuffer): T;
    unpack(): O;
}

const ANALYZED_SCRIPT_TYPE = Symbol('ANALYZED_SCRIPT_TYPE');
const CATALOG_ENTRIES_TYPE = Symbol('CATALOG_ENTRIES_TYPE');
const CATALOG_STATISTICS_TYPE = Symbol('CATALOG_STATISTICS_TYPE');
const CATALOG_TYPE = Symbol('CATALOG_TYPE');
const COMPLETION_TYPE = Symbol('COMPLETION_TYPE');
const CURSOR_TYPE = Symbol('CURSOR_TYPE');
const FLAT_CATALOG_TYPE = Symbol('FLAT_CATALOG_TYPE');
const FLAT_PLAN_VIEW_MODEL_TYPE = Symbol('FLAT_PLAN_VIEW_MODEL_TYPE');
const PARSED_SCRIPT_TYPE = Symbol('PARSED_SCRIPT_TYPE');
const PLAN_VIEW_MODEL_TYPE = Symbol('PLAN_VIEW_MODEL_TYPE');
const SCANNED_SCRIPT_TYPE = Symbol('SCANNED_SCRIPT_TYPE');
const SCRIPT_REGISTRY_COLUMN_INFO_TYPE = Symbol('SCRIPT_REGISTRY_COLUMN_INFO_TYPE');
const SCRIPT_REGISTRY_TYPE = Symbol('SCRIPT_REGISTRY_TYPE');
const SCRIPT_STATISTICS_TYPE = Symbol('SCRIPT_STATISTICS_TYPE');
const SCRIPT_TYPE = Symbol('SCRIPT_TYPE');
const TEMPORARY = Symbol('TEMPORARY');

export type DashQLRegisteredMemory =
    | VariantKind<typeof ANALYZED_SCRIPT_TYPE, FlatBufferPtr<buffers.analyzer.AnalyzedScript>>
    | VariantKind<typeof CATALOG_ENTRIES_TYPE, FlatBufferPtr<buffers.catalog.CatalogEntries>>
    | VariantKind<typeof CATALOG_STATISTICS_TYPE, FlatBufferPtr<buffers.catalog.CatalogStatistics>>
    | VariantKind<typeof CATALOG_TYPE, Ptr<typeof CATALOG_TYPE>>
    | VariantKind<typeof COMPLETION_TYPE, FlatBufferPtr<buffers.completion.Completion>>
    | VariantKind<typeof CURSOR_TYPE, FlatBufferPtr<buffers.cursor.ScriptCursor>>
    | VariantKind<typeof FLAT_CATALOG_TYPE, FlatBufferPtr<buffers.catalog.FlatCatalog>>
    | VariantKind<typeof FLAT_PLAN_VIEW_MODEL_TYPE, FlatBufferPtr<buffers.view.PlanViewModel>>
    | VariantKind<typeof PARSED_SCRIPT_TYPE, FlatBufferPtr<buffers.parser.ParsedScript>>
    | VariantKind<typeof PLAN_VIEW_MODEL_TYPE, Ptr<typeof PLAN_VIEW_MODEL_TYPE>>
    | VariantKind<typeof SCANNED_SCRIPT_TYPE, FlatBufferPtr<buffers.parser.ScannedScript>>
    | VariantKind<typeof SCRIPT_REGISTRY_COLUMN_INFO_TYPE, FlatBufferPtr<buffers.registry.ScriptRegistryColumnInfo>>
    | VariantKind<typeof SCRIPT_REGISTRY_TYPE, Ptr<typeof SCRIPT_REGISTRY_TYPE>>
    | VariantKind<typeof SCRIPT_STATISTICS_TYPE, FlatBufferPtr<buffers.statistics.ScriptStatistics>>
    | VariantKind<typeof SCRIPT_TYPE, Ptr<typeof SCRIPT_TYPE>>
    | VariantKind<typeof TEMPORARY, FlatBufferPtr<any>>
    ;

export interface DashQLRegisteredMemoryEntry {
    value: DashQLRegisteredMemory;
    epoch: number;
};

export interface DashQLMemoryLiveness {
    alive: DashQLRegisteredMemoryEntry[];
    dead: DashQLRegisteredMemoryEntry[];
}

const WASI_ERRNO_SUCCESS = 0;
const WASI_ERRNO_BADF = 8;
const WASI_ERRNO_NOSYS = 52;
const WASI_ERRNO_INVAL = 28;
const WASI_FILETYPE_CHARACTER_DEVICE = 2;
const WASI_RIGHTS_FD_SYNC = 1 << 4;
const WASI_RIGHTS_FD_WRITE = 1 << 6;
const WASI_RIGHTS_FD_FILESTAT_GET = 1 << 21;
const WASI_FDFLAGS_APPEND = 1 << 0;

export class DashQL {
    encoder: TextEncoder;
    decoder: TextDecoder;
    instance: WebAssembly.Instance;
    instanceExports: DashQLModuleExports;
    memory: WebAssembly.Memory;
    nextScriptId: number;
    registeredMemory: Map<number, DashQLRegisteredMemoryEntry>;
    nextLivenessEpoch: number;

    public constructor(instance: WebAssembly.Instance) {
        this.encoder = new TextEncoder();
        this.decoder = new TextDecoder();
        this.instance = instance;
        this.memory = instance.exports['memory'] as unknown as WebAssembly.Memory;
        this.nextScriptId = 1;
        this.registeredMemory = new Map();
        this.nextLivenessEpoch = 0;
        this.instanceExports = {
            dashql_version: instance.exports['dashql_version'] as () => number,
            dashql_malloc: instance.exports['dashql_malloc'] as (length: number) => number,
            dashql_free: instance.exports['dashql_free'] as (ptr: number) => void,
            dashql_delete_result: instance.exports['dashql_delete_result'] as (ptr: number) => void,

            dashql_script_new: instance.exports['dashql_script_new'] as (catalog: number, id: number) => number,
            dashql_catalog_clear: instance.exports['dashql_catalog_clear'] as (ptr: number) => void,
            dashql_script_insert_text_at: instance.exports['dashql_script_insert_text_at'] as (
                ptr: number,
                offset: number,
                textPtr: number,
                textLength: number,
            ) => void,
            dashql_script_insert_char_at: instance.exports['dashql_script_insert_char_at'] as (
                ptr: number,
                offset: number,
                character: number,
            ) => void,
            dashql_script_erase_text_range: instance.exports['dashql_script_erase_text_range'] as (
                ptr: number,
                offset: number,
                length: number,
            ) => void,
            dashql_script_replace_text: instance.exports['dashql_script_replace_text'] as (
                ptr: number,
                text: number,
                textLength: number,
            ) => void,
            dashql_script_to_string: instance.exports['dashql_script_to_string'] as (ptr: number) => number,
            dashql_script_scan: instance.exports['dashql_script_scan'] as (ptr: number) => number,
            dashql_script_parse: instance.exports['dashql_script_parse'] as (ptr: number) => number,
            dashql_script_analyze: instance.exports['dashql_script_analyze'] as (ptr: number, parse_if_outdated: boolean) => number,
            dashql_script_get_statistics: instance.exports['dashql_script_get_statistics'] as (ptr: number) => number,
            dashql_script_get_catalog_entry_id: instance.exports['dashql_script_get_catalog_entry_id'] as (ptr: number) => number,
            dashql_script_get_scanned: instance.exports['dashql_script_get_scanned'] as (ptr: number) => number,
            dashql_script_get_parsed: instance.exports['dashql_script_get_parsed'] as (ptr: number) => number,
            dashql_script_get_analyzed: instance.exports['dashql_script_get_analyzed'] as (ptr: number) => number,
            dashql_script_move_cursor: instance.exports['dashql_script_move_cursor'] as (
                ptr: number,
                offset: number,
            ) => number,
            dashql_script_complete_at_cursor: instance.exports['dashql_script_complete_at_cursor'] as (
                ptr: number,
                limit: number,
            ) => number,
            dashql_script_select_completion_candidate_at_cursor: instance.exports['dashql_script_select_completion_candidate_at_cursor'] as (
                ptr: number,
                completion: number,
                candidateId: number
            ) => number,
            dashql_script_select_completion_catalog_object_at_cursor: instance.exports['dashql_script_select_completion_catalog_object_at_cursor'] as (
                ptr: number,
                completion: number,
                candidateId: number,
                catalogObjectIdx: number,
            ) => number,

            dashql_catalog_new: instance.exports['dashql_catalog_new'] as () => number,
            dashql_catalog_contains_entry_id: instance.exports['dashql_catalog_contains_entry_id'] as (
                catalog_ptr: number,
                entry_id: number,
            ) => boolean,
            dashql_catalog_describe_entries: instance.exports['dashql_catalog_describe_entries'] as (
                catalog_ptr: number,
            ) => number,
            dashql_catalog_describe_entries_of: instance.exports['dashql_catalog_describe_entries_of'] as (
                catalog_ptr: number,
                entry_id: number,
            ) => number,
            dashql_catalog_flatten: instance.exports['dashql_catalog_flatten'] as (
                catalog_ptr: number,
            ) => number,
            dashql_catalog_load_script: instance.exports['dashql_catalog_load_script'] as (
                catalog_ptr: number,
                index: number,
                script_ptr: number,
            ) => number,
            dashql_catalog_update_script: instance.exports['dashql_catalog_update_script'] as (
                catalog_ptr: number,
                script_ptr: number,
            ) => number,
            dashql_catalog_drop_script: instance.exports['dashql_catalog_drop_script'] as (
                catalog_ptr: number,
                script_ptr: number,
            ) => void,
            dashql_catalog_add_descriptor_pool: instance.exports['dashql_catalog_add_descriptor_pool'] as (
                catalog_ptr: number,
                rank: number,
                external_id: number,
            ) => number,
            dashql_catalog_drop_descriptor_pool: instance.exports['dashql_catalog_drop_descriptor_pool'] as (
                catalog_ptr: number,
                external_id: number,
            ) => void,
            dashql_catalog_add_schema_descriptor: instance.exports['dashql_catalog_add_schema_descriptor'] as (
                catalog_ptr: number,
                external_id: number,
                data_ptr: number,
                data_size: number,
            ) => number,
            dashql_catalog_add_schema_descriptors: instance.exports['dashql_catalog_add_schema_descriptors'] as (
                catalog_ptr: number,
                external_id: number,
                data_ptr: number,
                data_size: number,
            ) => number,
            dashql_catalog_get_statistics: instance.exports['dashql_catalog_get_statistics'] as (catalog_ptr: number) => number,

            dashql_script_registry_new: instance.exports['dashql_script_registry_new'] as () => number,
            dashql_script_registry_clear: instance.exports['dashql_script_registry_clear'] as (registry_ptr: number) => void,
            dashql_script_registry_add_script: instance.exports['dashql_script_registry_add_script'] as (registry_ptr: number, script_ptr: number) => number,
            dashql_script_registry_drop_script: instance.exports['dashql_script_registry_drop_script'] as (registry_ptr: number, script_ptr: number) => void,
            dashql_script_registry_find_column: instance.exports['dashql_script_registry_find_column'] as (registry_ptr: number, external_id: number, table_id: number, column_id: number, referenced_catalog_version: number) => number,

            dashql_plan_view_model_new: instance.exports['dashql_plan_view_model_new'] as () => number,
            dashql_plan_view_model_load_hyper_plan: instance.exports['dashql_plan_view_model_load_hyper_plan'] as (viewmodel_ptr: number, text: number, text_length: number, hsep: number, vsep: number) => number,
        };
    }

    public static async create(instantiate: InstantiateWasmCallback): Promise<DashQL> {
        const instanceRef: { instance: DashQL | null } = { instance: null };
        const importStubs = {
            wasi_snapshot_preview1: {
                proc_exit: (code: number) => {
                    console.error(`proc_exit(${code})`);
                    return WASI_ERRNO_NOSYS;
                },
                environ_sizes_get: () => {
                    console.error(`environ_sizes_get()`);
                    return WASI_ERRNO_NOSYS;
                },
                environ_get: (environ: number, buf: number) => {
                    console.error(`environ_get(${environ}, ${buf})`);
                    return WASI_ERRNO_NOSYS;
                },
                fd_prestat_get: (fd: number) => {
                    console.error(`fd_prestat_get(${fd})`);
                    return WASI_ERRNO_NOSYS;
                },
                fd_prestat_dir_name: (fd: number, path: number, pathLen: number) => {
                    console.error(`fd_prestat_dir_name(${fd}, ${path}, ${pathLen})`);
                    return WASI_ERRNO_NOSYS;
                },
                fd_fdstat_get: (fd: number, fdstat: number) => {
                    if (fd > 2) return WASI_ERRNO_NOSYS;
                    const instance = instanceRef.instance!;
                    const view = new DataView(instance.memory.buffer)
                    view.setUint8(fdstat, WASI_FILETYPE_CHARACTER_DEVICE);
                    view.setUint16(fdstat + 2, WASI_FDFLAGS_APPEND, true);
                    view.setUint16(
                        fdstat + 8,
                        WASI_RIGHTS_FD_SYNC | WASI_RIGHTS_FD_WRITE | WASI_RIGHTS_FD_FILESTAT_GET,
                        true,
                    );
                    view.setUint16(fdstat + 16, 0, true);
                    return WASI_ERRNO_SUCCESS;
                },
                fd_seek: (fd: number, offset: number, whence: number) => {
                    console.error(`fd_seek(${fd}, ${offset}, ${whence})`);
                    return WASI_ERRNO_NOSYS;
                },
                fd_write: (_fd: number, iov: number, iovcnt: number, pOutResult: number) => {
                    const instance = instanceRef.instance!;
                    const HEAPU32 = new Uint32Array(instance.memory.buffer);
                    let stringBuffer = '';
                    let stringLength = 0;
                    for (let i = 0; i < iovcnt; i++) {
                        const ptr = HEAPU32[(iov + (i * 8)) >> 2];
                        const len = HEAPU32[(iov + (i * 8 + 4)) >> 2];
                        if (len < 0) return -1;
                        stringBuffer += instance.readString(ptr, len);
                        stringLength += len;
                    }
                    HEAPU32[pOutResult >> 2] = stringLength;
                    console.log(stringBuffer);
                    return WASI_ERRNO_SUCCESS;
                },
                fd_read: (fd: number, iovs: number) => {
                    console.error(`fd_read(${fd}, ${iovs})`);
                    return WASI_ERRNO_NOSYS;
                },
                fd_close: (fd: number) => {
                    console.error(`fd_close(${fd})`);
                    return WASI_ERRNO_NOSYS;
                },
                clock_time_get: (_id: number, _precision: number, ptr: number) => {
                    const instance = instanceRef.instance!;
                    const buffer = new BigUint64Array(instance.memory.buffer);
                    const nowMs = performance.now();
                    const nowNs = BigInt(Math.floor(nowMs * 1000 * 1000));
                    buffer[ptr / 8] = nowNs;
                    return WASI_ERRNO_SUCCESS;
                },
            },
            env: {
                log: (text: number, textLength: number) => {
                    const instance = instanceRef.instance!;
                    const textBuffer = new Uint8Array(instance.memory.buffer.slice(text, text + textLength));
                    console.log(instance.decoder.decode(textBuffer));
                },
            },
        };
        const streaming = await instantiate(importStubs);
        const instance = streaming.instance;
        const startFn = instance.exports['_start'] as () => number;
        startFn();
        instanceRef.instance = new DashQL(instance);
        return instanceRef.instance;
    }

    public copyString(text: string): [number, number] {
        // Empty strings are passed as null pointer
        if (text.length == 0) {
            return [0, 0];
        }
        // To convert a JavaScript string s, the output space needed for full conversion is never less
        // than s.length bytes and never greater than s.length * 3 bytes.
        const bufferSize = text.length * 3 + 1;
        const textBegin = this.instanceExports.dashql_malloc(bufferSize);
        // Allocation failed?
        if (textBegin == 0) {
            throw new Error(`failed to allocate a string of size ${text.length}`);
        }
        // Encode as UTF-8
        const textBuffer = new Uint8Array(this.memory.buffer).subarray(textBegin, textBegin + bufferSize);
        const textEncoded = this.encoder.encodeInto(text, textBuffer);
        if (textEncoded.written == undefined || textEncoded.written == 0) {
            this.instanceExports.dashql_free(textBegin);
            throw new Error(`failed to encode a string of size ${text.length}`);
        }
        // Write zero-terminator to be safe
        textBuffer[textEncoded.written] = 0;
        return [textBegin, textEncoded.written];
    }

    public copyBuffer(src: Uint8Array): [number, number] {
        if (src.length == 0) {
            return [0, 0];
        }
        const ptr = this.instanceExports.dashql_malloc(src.length);
        if (ptr == 0) {
            throw new Error(`failed to allocate a buffer of size ${src.length}`);
        }
        const dst = new Uint8Array(this.memory.buffer).subarray(ptr, ptr + src.length);
        dst.set(src);
        return [ptr, src.length];
    }

    public registerMemory(ptr: DashQLRegisteredMemory) {
        let key = ptr.value.resultPtr;
        if (this.registeredMemory.has(key)) {
            console.error("[WASM MEMORY] Detected double registration");
        } else {
            this.registeredMemory.set(key!, { value: ptr, epoch: 0 });
        }
    }
    public unregisterMemory(resultPtr: number) {
        if (!this.registeredMemory.has(resultPtr)) {
            console.error("[WASM MEMORY] Detected double deletion");
        } else {
            this.registeredMemory.delete(resultPtr);
        }
    }
    public acquireLivenessEpoch(): number {
        return this.nextLivenessEpoch++;
    }
    public checkMemoryLiveness(epoch: number) {
        const check: DashQLMemoryLiveness = {
            alive: [],
            dead: [],
        };
        for (const [_k, v] of this.registeredMemory) {
            if (v.epoch == epoch) {
                check.alive.push(v);
            } else {
                check.dead.push(v);
            }
        }
        return check;
    }

    /// Destroy all registered memory.
    /// This is unsafe because it will just release all memory while javascript might still reference into the heap.
    public resetUnsafe() {
        for (const [_k, v] of this.registeredMemory) {
            const inner = v.value;
            inner.value.destroy();
        }
        this.registeredMemory = new Map();
    }

    public createScript(
        catalog: DashQLCatalog,
        catalogEntryId: number | null = null,
        databaseName: string | null = null,
        schemaName: string | null = null,
    ): DashQLScript {
        if (catalogEntryId == null) {
            catalogEntryId = this.nextScriptId++;
        } else if (catalogEntryId == 0xffffffff) {
            throw new Error('context id 0xFFFFFFFF is reserved');
        }
        let databaseNamePtr = 0,
            databaseNameLength = 0,
            schemaNamePtr = 0,
            schemaNameLength = 0;
        if (databaseName != null) {
            [databaseNamePtr, databaseNameLength] = this.copyString(databaseName);
        }
        if (schemaName != null) {
            try {
                [schemaNamePtr, schemaNameLength] = this.copyString(schemaName);
            } catch (e: any) {
                this.instanceExports.dashql_free(databaseNamePtr);
                throw e;
            }
        }
        const catalogPtr = catalog?.ptr.assertNotNull() ?? 0;
        const result = this.instanceExports.dashql_script_new(catalogPtr, catalogEntryId);
        const scriptPtr = this.readPtrResult(SCRIPT_TYPE, result);
        const script = new DashQLScript(scriptPtr);
        this.registerMemory({ type: SCRIPT_TYPE, value: script.ptr });
        return script;
    }

    public createCatalog(): DashQLCatalog {
        const result = this.instanceExports.dashql_catalog_new();
        const ptr = this.readPtrResult(CATALOG_TYPE, result);
        const catalog = new DashQLCatalog(ptr);
        this.registerMemory({ type: CATALOG_TYPE, value: catalog.ptr });
        return catalog;
    }

    public createScriptRegistry(): DashQLScriptRegistry {
        const result = this.instanceExports.dashql_script_registry_new();
        const ptr = this.readPtrResult(SCRIPT_REGISTRY_TYPE, result);
        const registry = new DashQLScriptRegistry(ptr);
        this.registerMemory({ type: SCRIPT_REGISTRY_TYPE, value: registry.ptr });
        return registry;
    }

    public createPlanViewModel(layoutConfig: DashQLPlanViewModelLayoutConfig): DashQLPlanViewModel {
        const result = this.instanceExports.dashql_plan_view_model_new();
        const ptr = this.readPtrResult(PLAN_VIEW_MODEL_TYPE, result);
        const viewModel = new DashQLPlanViewModel(ptr, layoutConfig);
        this.registerMemory({ type: PLAN_VIEW_MODEL_TYPE, value: viewModel.ptr });
        return viewModel;
    }

    public getVersionText(): string {
        const versionPtr = this.instanceExports.dashql_version();
        const heapU8 = new Uint8Array(this.memory.buffer);
        const heapU32 = new Uint32Array(this.memory.buffer);
        const dataPtr = heapU32[versionPtr / 4];
        const dataLength = heapU32[versionPtr / 4 + 1];
        const dataArray = heapU8.subarray(dataPtr, dataPtr + dataLength);
        return this.decoder.decode(dataArray);
    }

    public readString(dataPtr: number, dataLength: number): string {
        const heapU8 = new Uint8Array(this.memory.buffer);
        const dataArray = heapU8.subarray(dataPtr, dataPtr + dataLength);
        return this.decoder.decode(dataArray);
    }

    public readPtrResult<T extends symbol>(ptrType: T, resultPtr: number) {
        const heapU8 = new Uint8Array(this.memory.buffer);
        const resultPtrU32 = resultPtr / 4;
        const heapU32 = new Uint32Array(this.memory.buffer);
        const statusCode = heapU32[resultPtrU32];
        if (statusCode == buffers.status.StatusCode.OK) {
            const ownerPtr = heapU32[resultPtrU32 + 3];
            return new Ptr(ptrType, this, resultPtr, ownerPtr);
        } else {
            const dataLength = heapU32[resultPtrU32 + 1];
            const dataPtr = heapU32[resultPtrU32 + 2];
            const dataArray = heapU8.subarray(dataPtr, dataPtr + dataLength);
            const error = this.decoder.decode(dataArray);
            this.instanceExports.dashql_delete_result(resultPtr);
            throw new Error(error);
        }
    }

    public readFlatBufferResult<T extends FlatBufferObject<T, O> = any, O = any>(sym: symbol, resultPtr: number, factory: () => T) {
        const heapU8 = new Uint8Array(this.memory.buffer);
        const resultPtrU32 = resultPtr / 4;
        const heapU32 = new Uint32Array(this.memory.buffer);
        const statusCode = heapU32[resultPtrU32];
        const dataLength = heapU32[resultPtrU32 + 1];
        const dataPtr = heapU32[resultPtrU32 + 2];
        if (statusCode == buffers.status.StatusCode.OK) {
            return new FlatBufferPtr<T>(sym, this, resultPtr, dataPtr, dataLength, factory);
        } else {
            const dataArray = heapU8.subarray(dataPtr, dataPtr + dataLength);
            const error = this.decoder.decode(dataArray);
            this.instanceExports.dashql_delete_result(resultPtr);
            throw new Error(error);
        }
    }

    public readStatusResult(resultPtr: number) {
        const heapU8 = new Uint8Array(this.memory.buffer);
        const resultPtrU32 = resultPtr / 4;
        const heapU32 = new Uint32Array(this.memory.buffer);
        const statusCode = heapU32[resultPtrU32];
        const dataLength = heapU32[resultPtrU32 + 1];
        const dataPtr = heapU32[resultPtrU32 + 2];
        if (statusCode == buffers.status.StatusCode.OK) {
            this.instanceExports.dashql_delete_result(resultPtr);
        } else {
            const dataArray = heapU8.subarray(dataPtr, dataPtr + dataLength);
            const error = this.decoder.decode(dataArray);
            this.instanceExports.dashql_delete_result(resultPtr);
            throw new Error(error);
        }
    }

    public readStringResult(resultPtr: number) {
        const heapU8 = new Uint8Array(this.memory.buffer);
        const resultPtrU32 = resultPtr / 4;
        const heapU32 = new Uint32Array(this.memory.buffer);
        const statusCode = heapU32[resultPtrU32];
        const dataLength = heapU32[resultPtrU32 + 1];
        const dataPtr = heapU32[resultPtrU32 + 2];
        if (statusCode == buffers.status.StatusCode.OK) {
            const ptr = new FlatBufferPtr<any>(TEMPORARY, this, resultPtr, dataPtr, dataLength, () => null);
            const text = ptr.api.decoder.decode(ptr.data);
            ptr.destroy(false);
            return text;
        } else {
            const dataArray = heapU8.subarray(dataPtr, dataPtr + dataLength);
            const error = this.decoder.decode(dataArray);
            this.instanceExports.dashql_delete_result(resultPtr);
            throw new Error(error);
        }
    }
}

export const NULL_POINTER_EXCEPTION = new Error('tried to access a null pointer');

export class Ptr<T extends symbol> {
    /// The object type
    public readonly type: symbol;
    /// The DashQL api
    public readonly api: DashQL;
    /// The pointer
    public readonly ptr: number;
    /// The result pointer
    resultPtr: number | null;

    public constructor(type: T, api: DashQL, resultPtr: number, ownerPtr: number) {
        this.type = type;
        this.api = api;
        this.ptr = ownerPtr;
        this.resultPtr = resultPtr;
    }
    /// Delete the object
    public destroy() {
        if (this.resultPtr != null) {
            this.api.unregisterMemory(this.resultPtr);
            this.api.instanceExports.dashql_delete_result(this.resultPtr);
            this.resultPtr = null;
        }
    }
    /// Make sure the pointer is not null
    public assertNotNull(): number {
        if (this.resultPtr == null) {
            throw NULL_POINTER_EXCEPTION;
        }
        return this.ptr;
    }
    /// Is null?
    public isNull(): boolean {
        return this.resultPtr != null;
    }
    /// Get the object pointer
    public get(): number | null {
        return this.ptr;
    }
    /// Mark a pointer alive in epoch
    public markAliveInEpoch(epoch: number) {
        const mem = this.api.registeredMemory.get(this.resultPtr);
        mem.epoch = epoch;
    }
}

export class FlatBufferPtr<T extends FlatBufferObject<T, O>, O = any> {
    /// The object type
    public readonly type: symbol;
    /// The DashQL api
    public readonly api: DashQL;
    /// The result pointer
    resultPtr: number | null;
    /// The data pointer
    dataPtr: number | null;
    /// The data length
    dataLength: number;
    /// The factory
    factory: () => T;

    public constructor(type: symbol, api: DashQL, resultPtr: number, dataPtr: number, dataLength: number, factory: () => T) {
        this.type = type;
        this.api = api;
        this.resultPtr = resultPtr;
        this.dataPtr = dataPtr;
        this.dataLength = dataLength;
        this.factory = factory;
    }
    /// Delete the buffer
    public destroy(registered: boolean = true) {
        if (this.resultPtr) {
            if (registered) {
                this.api.unregisterMemory(this.resultPtr);
            }
            this.api.instanceExports.dashql_delete_result(this.resultPtr);
            this.resultPtr = null;
        }
    }
    /// Get the data
    public get data(): Uint8Array {
        const begin = this.dataPtr ?? 0;
        return new Uint8Array(this.api.memory.buffer).subarray(begin, begin + this.dataLength);
    }
    /// Copy the data into a buffer
    public copy(): Uint8Array {
        const copy = new Uint8Array(new ArrayBuffer(this.data.byteLength));
        copy.set(this.data);
        return copy;
    }
    /// Equals a different flatbuffer ptr?
    public equals(other: FlatBufferPtr<T>): boolean {
        return this.resultPtr == other.resultPtr;
    }
    // Get the flatbuffer object
    // C.f. getRootAsAnalyzedScript
    public read(obj: T | null = null): T {
        obj = obj ?? this.factory();
        const bb = new flatbuffers.ByteBuffer(this.data);
        return obj.__init(bb.readInt32(bb.position()) + bb.position(), bb);
    }
    // Get the flatbuffer object, unpack it and destroy the memory
    public unpackAndDestroy(obj: T | null = null): O {
        obj = obj ?? this.factory();
        const bb = new flatbuffers.ByteBuffer(this.data);
        obj.__init(bb.readInt32(bb.position()) + bb.position(), bb);
        const out = obj.unpack();
        this.destroy();
        return out;
    }
    /// Mark a pointer alive in epoch
    public markAliveInEpoch(epoch: number) {
        const mem = this.api.registeredMemory.get(this.resultPtr);
        mem.epoch = epoch;
    }
}

export class ScannerError extends Error {
    public scanned: FlatBufferPtr<buffers.parser.ScannedScript>;
    constructor(scanned: FlatBufferPtr<buffers.parser.ScannedScript>, firstError: buffers.parser.Error) {
        super(firstError.message());
        this.scanned = scanned;
    }
}
export class ParserError extends Error {
    public parsed: FlatBufferPtr<buffers.parser.ParsedScript>;
    constructor(parsed: FlatBufferPtr<buffers.parser.ParsedScript>, firstError: buffers.parser.Error) {
        super(firstError.message());
        this.parsed = parsed;
    }
}


export class DashQLScript {
    public readonly ptr: Ptr<typeof SCRIPT_TYPE>;
    public readonly catalog_entry_id: number;

    public constructor(ptr: Ptr<typeof SCRIPT_TYPE>) {
        this.ptr = ptr;
        this.catalog_entry_id = this.ptr.api.instanceExports.dashql_script_get_catalog_entry_id(ptr.assertNotNull());
    }
    /// Delete a graph
    public destroy() {
        this.ptr.destroy();
    }
    /// Insert text at an offset
    public insertTextAt(offset: number, text: string) {
        const scriptPtr = this.ptr.assertNotNull();
        // Short-circuit inserting texts of length 1
        if (text.length == 1) {
            this.ptr.api.instanceExports.dashql_script_insert_char_at(scriptPtr, offset, text.charCodeAt(0));
            return;
        }
        const [textBegin, textLength] = this.ptr.api.copyString(text);
        this.ptr.api.instanceExports.dashql_script_insert_text_at(scriptPtr, offset, textBegin, textLength);
    }
    /// Earse a range of characters
    public eraseTextRange(offset: number, length: number) {
        const scriptPtr = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_script_erase_text_range(scriptPtr, offset, length);
    }
    /// Replace the text text
    public replaceText(text: string) {
        const scriptPtr = this.ptr.assertNotNull();
        const [textBegin, textLength] = this.ptr.api.copyString(text);
        this.ptr.api.instanceExports.dashql_script_replace_text(scriptPtr, textBegin, textLength);
    }
    /// Convert a rope to a string
    public toString(): string {
        const scriptPtr = this.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_script_to_string(scriptPtr);
        return this.ptr.api.readStringResult(result);
    }
    /// Scan the script
    public scan() {
        const scriptPtr = this.ptr.assertNotNull();
        const resultPtr = this.ptr.api.instanceExports.dashql_script_scan(scriptPtr);
        this.ptr.api.readStatusResult(resultPtr);
    }
    /// Parse the script
    public parse() {
        const scriptPtr = this.ptr.assertNotNull();
        const resultPtr = this.ptr.api.instanceExports.dashql_script_parse(scriptPtr);
        this.ptr.api.readStatusResult(resultPtr);
    }
    /// Analyze the script
    public analyze(parseIfOutdated: boolean = true) {
        const scriptPtr = this.ptr.assertNotNull();
        const resultPtr = this.ptr.api.instanceExports.dashql_script_analyze(scriptPtr, parseIfOutdated);
        this.ptr.api.readStatusResult(resultPtr);
    }
    /// Get the scanned script
    public getScanned(): FlatBufferPtr<buffers.parser.ScannedScript> {
        const scriptPtr = this.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_script_get_scanned(scriptPtr);
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.parser.ScannedScript, buffers.parser.ScannedScriptT>(SCANNED_SCRIPT_TYPE, result, () => new buffers.parser.ScannedScript());
        this.ptr.api.registerMemory({ type: SCANNED_SCRIPT_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Get the parsed script
    public getParsed(): FlatBufferPtr<buffers.parser.ParsedScript> {
        const scriptPtr = this.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_script_get_parsed(scriptPtr);
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.parser.ParsedScript, buffers.parser.ParsedScriptT>(PARSED_SCRIPT_TYPE, result, () => new buffers.parser.ParsedScript());
        this.ptr.api.registerMemory({ type: PARSED_SCRIPT_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Get the analyzed script
    public getAnalyzed(): FlatBufferPtr<buffers.analyzer.AnalyzedScript> {
        const scriptPtr = this.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_script_get_analyzed(scriptPtr);
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.analyzer.AnalyzedScript, buffers.analyzer.AnalyzedScriptT>(ANALYZED_SCRIPT_TYPE, result, () => new buffers.analyzer.AnalyzedScript());
        this.ptr.api.registerMemory({ type: ANALYZED_SCRIPT_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Move the cursor
    public moveCursor(textOffset: number): FlatBufferPtr<buffers.cursor.ScriptCursor> {
        const scriptPtr = this.ptr.assertNotNull();
        const resultPtr = this.ptr.api.instanceExports.dashql_script_move_cursor(scriptPtr, textOffset);
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.cursor.ScriptCursor, buffers.cursor.ScriptCursorT>(CURSOR_TYPE, resultPtr, () => new buffers.cursor.ScriptCursor());
        this.ptr.api.registerMemory({ type: CURSOR_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Complete at the cursor
    public completeAtCursor(limit: number, registry: DashQLScriptRegistry | null = null): FlatBufferPtr<buffers.completion.Completion> {
        const scriptPtr = this.ptr.assertNotNull();
        const resultPtr = this.ptr.api.instanceExports.dashql_script_complete_at_cursor(scriptPtr, limit, registry == null ? 0 : registry.ptr.get());
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.completion.Completion, buffers.completion.CompletionT>(COMPLETION_TYPE, resultPtr, () => new buffers.completion.Completion());
        this.ptr.api.registerMemory({ type: COMPLETION_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Try to complete at cursor
    public tryCompleteAtCursor(limit: number, registry: DashQLScriptRegistry | null = null): FlatBufferPtr<buffers.completion.Completion> | null {
        try {
            return this.completeAtCursor(limit, registry);
        } catch (e: unknown) {
            return null;
        }
    }
    /// Complete at the cursor after selecting a candidate of a previous completion
    public selectCompletionCandidateAtCursor(ptr: FlatBufferPtr<buffers.completion.Completion>, candidateId: number): FlatBufferPtr<buffers.completion.Completion> {
        const scriptPtr = this.ptr.assertNotNull();
        const resultPtr = this.ptr.api.instanceExports.dashql_script_select_completion_candidate_at_cursor(scriptPtr, ptr.dataPtr, candidateId);
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.completion.Completion, buffers.completion.CompletionT>(COMPLETION_TYPE, resultPtr, () => new buffers.completion.Completion());
        this.ptr.api.registerMemory({ type: COMPLETION_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Complete at the cursor after selecting a candidate of a previous completion
    public trySelectCompletionCandidateAtCursor(ptr: FlatBufferPtr<buffers.completion.Completion>, candidateId: number): FlatBufferPtr<buffers.completion.Completion> | null {
        try {
            return this.selectCompletionCandidateAtCursor(ptr, candidateId);
        } catch (e: unknown) {
            return null;
        }
    }
    /// Complete at the cursor after selecting a qualified candidate of a previous completion
    public selectCompletionCatalogObjectAtCursor(ptr: FlatBufferPtr<buffers.completion.Completion>, candidateId: number, catalogObjectIdx: number): FlatBufferPtr<buffers.completion.Completion> {
        const scriptPtr = this.ptr.assertNotNull();
        const resultPtr = this.ptr.api.instanceExports.dashql_script_select_completion_catalog_object_at_cursor(scriptPtr, ptr.dataPtr, candidateId, catalogObjectIdx);
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.completion.Completion, buffers.completion.CompletionT>(COMPLETION_TYPE, resultPtr, () => new buffers.completion.Completion());
        this.ptr.api.registerMemory({ type: COMPLETION_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Complete at the cursor after selecting a candidate of a previous completion
    public trySelectCompletionCatalogObjectAtCursor(ptr: FlatBufferPtr<buffers.completion.Completion>, candidateId: number, catalogObjectIdx: number): FlatBufferPtr<buffers.completion.Completion> | null {
        try {
            return this.selectCompletionCatalogObjectAtCursor(ptr, candidateId, catalogObjectIdx);
        } catch (e: unknown) {
            return null;
        }
    }
    /// Get the script statistics.
    /// Timings are useless in some browsers today.
    /// For example, Firefox rounds to millisecond precision, so all our step timings will be 0 for most foundations.
    /// One way out might be COEP but we cannot easily set that with GitHub pages.
    /// https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/High_precision_timing#reduced_precision
    public getStatistics(): FlatBufferPtr<buffers.statistics.ScriptStatistics> {
        const scriptPtr = this.ptr.assertNotNull();
        const resultPtr = this.ptr.api.instanceExports.dashql_script_get_statistics(scriptPtr);
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.statistics.ScriptStatistics, buffers.statistics.ScriptStatisticsT>(SCRIPT_STATISTICS_TYPE, resultPtr, () => new buffers.statistics.ScriptStatistics());
        this.ptr.api.registerMemory({ type: SCRIPT_STATISTICS_TYPE, value: resultBuffer });
        return resultBuffer;
    }
}

export class DashQLCatalogSnapshotReader {
    public catalogReader: buffers.catalog.FlatCatalog;
    nameDictionary: (string | null)[];

    /// Construct a snapshot reader with a name dictionary
    constructor(catalog: buffers.catalog.FlatCatalog, nameDictionary: (string | null)[]) {
        this.catalogReader = catalog;
        this.nameDictionary = nameDictionary;
    }
    /// Read a name
    public readName(nameId: number): string {
        let name = this.nameDictionary[nameId];
        if (name == null) {
            name = this.catalogReader.nameDictionary(nameId);
            this.nameDictionary[nameId] = name;
        }
        return name;
    }
}

export class DashQLCatalogSnapshot {
    public ptr: FlatBufferPtr<buffers.catalog.FlatCatalog>;
    nameDictionary: (string | null)[];

    constructor(snapshot: FlatBufferPtr<buffers.catalog.FlatCatalog>) {
        this.ptr = snapshot;
        this.nameDictionary = [];
    }
    /// Delete a snapshot
    public destroy() {
        this.ptr.destroy();
    }
    /// Read a snapshot
    public read(): DashQLCatalogSnapshotReader {
        const reader = this.ptr.read();
        return new DashQLCatalogSnapshotReader(reader, this.nameDictionary);
    }
}

export class DashQLCatalog {
    public readonly ptr: Ptr<typeof CATALOG_TYPE> | null;
    public snapshot: DashQLCatalogSnapshot | null;

    public constructor(ptr: Ptr<typeof CATALOG_TYPE>) {
        this.ptr = ptr;
    }
    /// Delete the snapshot if there is one
    protected deleteSnapshot() {
        if (this.snapshot != null) {
            this.snapshot.destroy();
            this.snapshot = null;
        }
    }
    /// Delete the graph
    public destroy() {
        this.ptr.destroy();
    }
    /// Reset a catalog
    public clear(): void {
        this.deleteSnapshot();
        const catalogPtr = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_catalog_clear(catalogPtr);
    }
    /// Contains an entry id?
    public containsEntryId(entryId: number): boolean {
        const catalogPtr = this.ptr.assertNotNull();
        return this.ptr.api.instanceExports.dashql_catalog_contains_entry_id(catalogPtr, entryId);
    }
    /// Describe catalog entries
    public describeEntries(): FlatBufferPtr<buffers.catalog.CatalogEntries> {
        const catalogPtr = this.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_catalog_describe_entries(catalogPtr);
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.catalog.CatalogEntries>(CATALOG_ENTRIES_TYPE, result, () => new buffers.catalog.CatalogEntries());
        this.ptr.api.registerMemory({ type: CATALOG_ENTRIES_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Describe catalog entries
    public describeEntriesOf(id: number): FlatBufferPtr<buffers.catalog.CatalogEntries> {
        const catalogPtr = this.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_catalog_describe_entries_of(catalogPtr, id);
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.catalog.CatalogEntries>(CATALOG_ENTRIES_TYPE, result, () => new buffers.catalog.CatalogEntries());
        this.ptr.api.registerMemory({ type: CATALOG_ENTRIES_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Export a catalog snapshot
    public createSnapshot(): DashQLCatalogSnapshot {
        if (this.snapshot != null) {
            return this.snapshot;
        }
        const catalogPtr = this.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_catalog_flatten(catalogPtr);
        const snapshot = this.ptr.api.readFlatBufferResult<buffers.catalog.FlatCatalog>(FLAT_CATALOG_TYPE, result, () => new buffers.catalog.FlatCatalog());
        this.snapshot = new DashQLCatalogSnapshot(snapshot);
        this.ptr.api.registerMemory({ type: FLAT_CATALOG_TYPE, value: snapshot });
        return this.snapshot;
    }
    /// Add a script in the registry
    public loadScript(script: DashQLScript, rank: number) {
        this.deleteSnapshot();
        const catalogPtr = this.ptr.assertNotNull();
        const scriptPtr = script.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_catalog_load_script(catalogPtr, scriptPtr, rank);
        this.ptr.api.readStatusResult(result);
    }
    /// Update a script from the registry
    public dropScript(script: DashQLScript) {
        this.deleteSnapshot();
        const catalogPtr = this.ptr.assertNotNull();
        const scriptPtr = script.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_catalog_drop_script(catalogPtr, scriptPtr);
    }
    /// Add an external schema
    public addDescriptorPool(id: number, rank: number) {
        this.deleteSnapshot();
        const catalogPtr = this.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_catalog_add_descriptor_pool(catalogPtr, id, rank);
        this.ptr.api.readStatusResult(result);
    }
    /// Drop an external schema
    public dropDescriptorPool(id: number) {
        this.deleteSnapshot();
        const catalogPtr = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_catalog_drop_descriptor_pool(catalogPtr, id);
    }
    /// Add a schema descriptor to a descriptor pool
    public addSchemaDescriptor(id: number, buffer: Uint8Array) {
        this.deleteSnapshot();
        const catalogPtr = this.ptr.assertNotNull();
        const [bufferPtr, bufferLength] = this.ptr.api.copyBuffer(buffer);
        const result = this.ptr.api.instanceExports.dashql_catalog_add_schema_descriptor(
            catalogPtr,
            id,
            bufferPtr, // pass ownership over buffer
            bufferLength,
        );
        this.ptr.api.readStatusResult(result);
    }
    /// Add a schema descriptor to a descriptor pool
    public addSchemaDescriptorT(id: number, descriptor: buffers.catalog.SchemaDescriptorT) {
        this.deleteSnapshot();
        const builder = new flatbuffers.Builder();
        const descriptorOffset = descriptor.pack(builder);
        builder.finish(descriptorOffset);
        const buffer = builder.asUint8Array();
        this.addSchemaDescriptor(id, buffer);
    }
    /// Add schema descriptors to a descriptor pool
    public addSchemaDescriptors(id: number, buffer: Uint8Array) {
        this.deleteSnapshot();
        const catalogPtr = this.ptr.assertNotNull();
        const [bufferPtr, bufferLength] = this.ptr.api.copyBuffer(buffer);
        const result = this.ptr.api.instanceExports.dashql_catalog_add_schema_descriptors(
            catalogPtr,
            id,
            bufferPtr, // pass ownership over buffer
            bufferLength,
        );
        this.ptr.api.readStatusResult(result);
    }
    /// Add a schema descriptors to a descriptor pool
    public addSchemaDescriptorsT(id: number, descriptor: buffers.catalog.SchemaDescriptorsT) {
        this.deleteSnapshot();
        const builder = new flatbuffers.Builder();
        const descriptorOffset = descriptor.pack(builder);
        builder.finish(descriptorOffset);
        const buffer = builder.asUint8Array();
        this.addSchemaDescriptors(id, buffer);
    }
    /// Get the catalog statistics.
    public getStatistics(): FlatBufferPtr<buffers.catalog.CatalogStatistics, buffers.catalog.CatalogStatisticsT> {
        const catalogPtr = this.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_catalog_get_statistics(catalogPtr);
        const resultPtr = this.ptr.api.readFlatBufferResult<buffers.catalog.CatalogStatistics>(SCRIPT_STATISTICS_TYPE, result, () => new buffers.catalog.CatalogStatistics());
        this.ptr.api.registerMemory({ type: CATALOG_STATISTICS_TYPE, value: resultPtr });
        return resultPtr;
    }
}

export interface DashQLQueryGraphLayoutConfig {
    boardWidth: number;
    boardHeight: number;
    cellWidth: number;
    cellHeight: number;
    tableWidth: number;
    tableHeight: number;
}

export namespace ExternalObjectID {
    export type Value = bigint;

    /// Create the external id
    export function create(context: number, value: number): bigint {
        if (context == 0xffffffff) {
            throw new Error('context id 0xFFFFFFFF is reserved');
        }
        return (BigInt(context) << 32n) | BigInt(value);
    }
    /// Get the context id
    export function getOrigin(value: Value): number {
        return Number(value >> 32n);
    }
    /// Mask index
    export function getObject(value: Value): number {
        return Number(value & 0xffffffffn);
    }
    /// Is a null id?
    export function isNull(value: Value): boolean {
        return ExternalObjectID.getObject(value) == 0xffffffff;
    }
}

export namespace ContextObjectChildID {
    export type Value = bigint;

    /// Create the external id
    export function create(parent: bigint, child: number): bigint {
        return (parent << 32n) | BigInt(child);
    }
    /// Get the context id
    export function getParent(value: Value): bigint {
        return value >> 32n;
    }
    /// Mask index
    export function getChild(value: Value): number {
        return Number(value & 0xffffffffn);
    }
}

export class DashQLScriptRegistry {
    public readonly ptr: Ptr<typeof CATALOG_TYPE> | null;

    public constructor(ptr: Ptr<typeof CATALOG_TYPE>) {
        this.ptr = ptr;
    }
    /// Delete the graph
    public destroy() {
        this.ptr.destroy();
    }
    /// Reset a script registry
    public clear(): void {
        const scriptRegistry = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_script_registry_clear(scriptRegistry);
    }
    /// Add a script in the registry
    public addScript(script: DashQLScript) {
        const registryPtr = this.ptr.assertNotNull();
        const scriptPtr = script.ptr.assertNotNull();
        const result = this.ptr.api.instanceExports.dashql_script_registry_add_script(registryPtr, scriptPtr);
        this.ptr.api.readStatusResult(result);
    }
    /// Update a script from the registry
    public dropScript(script: DashQLScript) {
        const registryPtr = this.ptr.assertNotNull();
        const scriptPtr = script.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_script_registry_drop_script(registryPtr, scriptPtr);
    }
    /// Find information about a column
    public findColumnInfo(table_id: bigint, table_column_id: number, referenced_catalog_version: number | null = null): FlatBufferPtr<buffers.registry.ScriptRegistryColumnInfo, buffers.registry.ScriptRegistryColumnInfoT> {
        const registryPtr = this.ptr.assertNotNull();

        // Lookup a column in the script registry
        const catalogVersion = referenced_catalog_version == null ? -1 : referenced_catalog_version;
        const result = this.ptr.api.instanceExports.dashql_script_registry_find_column(
            registryPtr,
            ExternalObjectID.getOrigin(table_id),
            ExternalObjectID.getObject(table_id),
            table_column_id,
            catalogVersion
        );
        // Unpack the result
        const resultPtr = this.ptr.api.readFlatBufferResult<buffers.registry.ScriptRegistryColumnInfo>(SCRIPT_REGISTRY_TYPE, result, () => new buffers.registry.ScriptRegistryColumnInfo());
        this.ptr.api.registerMemory({ type: SCRIPT_REGISTRY_COLUMN_INFO_TYPE, value: resultPtr });
        return resultPtr;
    }
}

export interface DashQLPlanViewModelLayoutConfig {
    hsep: number;
    vsep: number;
}

export class DashQLPlanViewModel {
    public readonly ptr: Ptr<typeof CATALOG_TYPE> | null;
    public readonly layout: DashQLPlanViewModelLayoutConfig;

    public constructor(ptr: Ptr<typeof CATALOG_TYPE>, layout: DashQLPlanViewModelLayoutConfig) {
        this.ptr = ptr;
        this.layout = layout;
    }
    /// Delete the plan view model
    public destroy() {
        this.ptr.destroy();
    }
    /// Load a Hyper plan
    public loadHyperPlan(plan: string): FlatBufferPtr<buffers.view.PlanViewModel, buffers.view.PlanViewModelT> {
        const viewModelPtr = this.ptr.assertNotNull();
        const [textBegin, textLength] = this.ptr.api.copyString(plan);
        const result = this.ptr.api.instanceExports.dashql_plan_view_model_load_hyper_plan(viewModelPtr, textBegin, textLength, this.layout.hsep, this.layout.vsep);
        const resultPtr = this.ptr.api.readFlatBufferResult<buffers.view.PlanViewModel>(FLAT_PLAN_VIEW_MODEL_TYPE, result, () => new buffers.view.PlanViewModel());
        this.ptr.api.registerMemory({ type: FLAT_PLAN_VIEW_MODEL_TYPE, value: resultPtr });
        return resultPtr;
    }
}
