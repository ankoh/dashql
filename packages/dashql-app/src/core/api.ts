import * as buffers from './buffers.js';
import * as flatbuffers from 'flatbuffers';

import { VariantKind } from './variant.js';

// Emscripten module interface (what the generated JS provides)
interface EmscriptenModule {
    // Memory views (Emscripten provides these automatically)
    HEAP8: Int8Array;
    HEAPU8: Uint8Array;
    HEAP16: Int16Array;
    HEAPU16: Uint16Array;
    HEAP32: Int32Array;
    HEAPU32: Uint32Array;
    HEAPF32: Float32Array;
    HEAPF64: Float64Array;

    memory: WebAssembly.Memory;

    // Stack manipulation functions (for stack allocation)
    stackSave: () => number;
    stackAlloc: (size: number) => number;
    stackRestore: (ptr: number) => void;

    // All C functions exported with underscore prefix
    _dashql_version: () => number;
    _dashql_malloc: (length: number) => number;
    _dashql_free: (ptr: number) => void;
    _dashql_delete_owner: (owner_ptr: number, owner_deleter: number) => void;
    _dashql_script_new: (result: number, catalog: number) => void;
    _dashql_script_insert_text_at: (ptr: number, offset: number, text: number, textLength: number) => void;
    _dashql_script_insert_char_at: (ptr: number, offset: number, unicode: number) => void;
    _dashql_script_erase_text_range: (ptr: number, offset: number, length: number) => void;
    _dashql_script_replace_text: (ptr: number, text: number, textLength: number) => void;
    _dashql_script_to_string: (result: number, ptr: number) => void;
    _dashql_script_scan: (ptr: number) => void;
    _dashql_script_parse: (ptr: number) => void;
    _dashql_script_analyze: (ptr: number, parse_if_outdated: boolean) => void;
    _dashql_script_move_cursor: (result: number, ptr: number, offset: number) => void;
    _dashql_script_complete_at_cursor: (result: number, ptr: number, limit: number, registry: number) => void;
    _dashql_script_select_completion_candidate_at_cursor: (result: number, ptr: number, completion: number, candidateId: number) => void;
    _dashql_script_select_completion_catalog_object_at_cursor: (result: number, ptr: number, completion: number, candidateId: number, catalogObjectIdx: number) => void;
    _dashql_script_get_catalog_entry_id: (ptr: number) => number;
    _dashql_script_get_scanned: (result: number, ptr: number) => void;
    _dashql_script_get_parsed: (result: number, ptr: number) => void;
    _dashql_script_get_analyzed: (result: number, ptr: number) => void;
    _dashql_script_get_statistics: (result: number, ptr: number) => void;
    _dashql_catalog_new: (result: number) => void;
    _dashql_catalog_clear: (catalog_ptr: number) => void;
    _dashql_catalog_contains_entry_id: (catalog_ptr: number, external_id: number) => boolean;
    _dashql_catalog_describe_entries: (result: number, catalog_ptr: number) => void;
    _dashql_catalog_describe_entries_of: (result: number, catalog_ptr: number, external_id: number) => void;
    _dashql_catalog_flatten: (result: number, catalog_ptr: number) => void;
    _dashql_catalog_load_script: (catalog_ptr: number, script_ptr: number, rank: number) => void;
    _dashql_catalog_update_script: (catalog_ptr: number, script_ptr: number) => number;
    _dashql_catalog_drop_script: (catalog_ptr: number, script_ptr: number) => void;
    _dashql_catalog_add_descriptor_pool: (result: number, catalog_ptr: number, rank: number) => void;
    _dashql_catalog_drop_descriptor_pool: (catalog_ptr: number, external_id: number) => void;
    _dashql_catalog_add_schema_descriptor: (catalog_ptr: number, external_id: number, data_ptr: number, data_size: number) => void;
    _dashql_catalog_add_schema_descriptors: (catalog_ptr: number, external_id: number, data_ptr: number, data_size: number) => void;
    _dashql_catalog_get_statistics: (result: number, ptr: number) => void;
    _dashql_script_registry_new: (result: number) => void;
    _dashql_script_registry_clear: (registry_ptr: number) => void;
    _dashql_script_registry_add_script: (registry_ptr: number, script_ptr: number) => void;
    _dashql_script_registry_drop_script: (registry_ptr: number, script_ptr: number) => void;
    _dashql_script_registry_find_column: (result: number, registry_ptr: number, external_id: number, table_id: number, column_id: number, referenced_catalog_version: number) => void;
    _dashql_plan_view_model_new: (result: number) => void;
    _dashql_plan_view_model_configure: (viewmodel_ptr: number, levelHeight: number, nodeHeight: number, nodeMarginHorizontal: number, nodePaddingLeft: number, nodePaddingRight: number, iconWidth: number, iconMarginRight: number, maxLabelChars: number, widthPerLabelChar: number, minNodeWidth: number) => void;
    _dashql_plan_view_model_load_hyper_plan: (viewmodel_ptr: number, text: number, text_length: number) => void;
    _dashql_plan_view_model_reset: (viewmodel_ptr: number) => void;
    _dashql_plan_view_model_reset_execution: (viewmodel_ptr: number) => void;
    _dashql_plan_view_model_pack: (result: number, viewmodel_ptr: number) => void;
}

// Our cleaned-up API interface (without underscores)
interface DashQLModuleExports {
    dashql_version: () => number;
    dashql_malloc: (length: number) => number;
    dashql_free: (ptr: number) => void;
    dashql_delete_owner: (owner_ptr: number, owner_deleter: number) => void;

    dashql_script_new: (result: number, catalog: number) => void;
    dashql_script_insert_text_at: (ptr: number, offset: number, text: number, textLength: number) => void;
    dashql_script_insert_char_at: (ptr: number, offset: number, unicode: number) => void;
    dashql_script_erase_text_range: (ptr: number, offset: number, length: number) => void;
    dashql_script_replace_text: (ptr: number, text: number, textLength: number) => void;
    dashql_script_to_string: (result: number, ptr: number) => void;
    dashql_script_scan: (ptr: number) => void;
    dashql_script_parse: (ptr: number) => void;
    dashql_script_analyze: (ptr: number, parse_if_outdated: boolean) => void;
    dashql_script_move_cursor: (result: number, ptr: number, offset: number) => void;
    dashql_script_complete_at_cursor: (result: number, ptr: number, limit: number, registry: number) => void;
    dashql_script_select_completion_candidate_at_cursor: (result: number, ptr: number, completion: number, candidateId: number) => void;
    dashql_script_select_completion_catalog_object_at_cursor: (result: number, ptr: number, completion: number, candidateId: number, catalogObjectIdx: number) => void;
    dashql_script_get_catalog_entry_id: (ptr: number) => number;
    dashql_script_get_scanned: (result: number, ptr: number) => void;
    dashql_script_get_parsed: (result: number, ptr: number) => void;
    dashql_script_get_analyzed: (result: number, ptr: number) => void;
    dashql_script_get_statistics: (result: number, ptr: number) => void;

    dashql_catalog_new: (result: number) => void;
    dashql_catalog_clear: (catalog_ptr: number) => void;
    dashql_catalog_contains_entry_id: (catalog_ptr: number, external_id: number) => boolean;
    dashql_catalog_describe_entries: (result: number, catalog_ptr: number) => void;
    dashql_catalog_describe_entries_of: (result: number, catalog_ptr: number, external_id: number) => void;
    dashql_catalog_flatten: (result: number, catalog_ptr: number) => void;
    dashql_catalog_load_script: (catalog_ptr: number, script_ptr: number, rank: number) => void;
    dashql_catalog_update_script: (catalog_ptr: number, script_ptr: number) => number;
    dashql_catalog_drop_script: (catalog_ptr: number, script_ptr: number) => void;
    dashql_catalog_add_descriptor_pool: (result: number, catalog_ptr: number, rank: number) => void;
    dashql_catalog_drop_descriptor_pool: (catalog_ptr: number, external_id: number) => void;
    dashql_catalog_add_schema_descriptor: (catalog_ptr: number, external_id: number, data_ptr: number, data_size: number) => void;
    dashql_catalog_add_schema_descriptors: (catalog_ptr: number, external_id: number, data_ptr: number, data_size: number) => void;
    dashql_catalog_get_statistics: (result: number, ptr: number) => void;

    dashql_script_registry_new: (result: number) => void;
    dashql_script_registry_clear: (registry_ptr: number) => void;
    dashql_script_registry_add_script: (registry_ptr: number, script_ptr: number) => void;
    dashql_script_registry_drop_script: (registry_ptr: number, script_ptr: number) => void;
    dashql_script_registry_find_column: (result: number, registry_ptr: number, external_id: number, table_id: number, column_id: number, referenced_catalog_version: number) => void;

    dashql_plan_view_model_new: (result: number) => void;
    dashql_plan_view_model_configure: (viewmodel_ptr: number, levelHeight: number, nodeHeight: number, nodeMarginHorizontal: number, nodePaddingLeft: number, nodePaddingRight: number, iconWidth: number, iconMarginRight: number, maxLabelChars: number, widthPerLabelChar: number, minNodeWidth: number) => void;
    dashql_plan_view_model_load_hyper_plan: (viewmodel_ptr: number, text: number, text_length: number) => void;
    dashql_plan_view_model_reset: (viewmodel_ptr: number) => void;
    dashql_plan_view_model_reset_execution: (viewmodel_ptr: number) => void;
    dashql_plan_view_model_pack: (result: number, viewmodel_ptr: number) => void;
}

type InstantiateWasmCallback = (
    imports: WebAssembly.Imports,
    successCallback: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
) => WebAssembly.Exports | Promise<WebAssembly.Exports>;

// Import the Emscripten-generated module factory
// eslint-disable-next-line import/no-unresolved
import createDashQLModule from '@ankoh/dashql-core-js';

// Declare the factory function type to match our interface
declare module '@ankoh/dashql-core-js' {
    export default function createDashQLModule(options?: {
        instantiateWasm?: InstantiateWasmCallback;
        wasmBinary?: Uint8Array;
        print?: (text: string) => void;
        printErr?: (text: string) => void;
    }): Promise<EmscriptenModule>;
}

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
const DESCRIPTOR_POOL_TYPE = Symbol('DESCRIPTOR_POOL_TYPE');
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
    | VariantKind<typeof DESCRIPTOR_POOL_TYPE, FlatBufferPtr<buffers.catalog.CatalogDescriptorPool>>
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

export class DashQL {
    encoder: TextEncoder;
    decoder: TextDecoder;
    module: EmscriptenModule;
    memory: WebAssembly.Memory;
    instanceExports: DashQLModuleExports;
    nextScriptId: number;
    registeredMemory: Map<number, DashQLRegisteredMemoryEntry>;
    nextLivenessEpoch: number;

    public constructor(module: EmscriptenModule) {
        this.encoder = new TextEncoder();
        this.decoder = new TextDecoder();
        this.module = module;
        this.memory = module.memory;
        this.nextScriptId = 1;
        this.registeredMemory = new Map();
        this.nextLivenessEpoch = 0;

        // Wrap all Emscripten exports, removing the leading underscore
        this.instanceExports = {
            dashql_version: module._dashql_version,
            dashql_malloc: module._dashql_malloc,
            dashql_free: module._dashql_free,
            dashql_delete_owner: module._dashql_delete_owner,
            dashql_script_new: module._dashql_script_new,
            dashql_catalog_clear: module._dashql_catalog_clear,
            dashql_script_insert_text_at: module._dashql_script_insert_text_at,
            dashql_script_insert_char_at: module._dashql_script_insert_char_at,
            dashql_script_erase_text_range: module._dashql_script_erase_text_range,
            dashql_script_replace_text: module._dashql_script_replace_text,
            dashql_script_to_string: module._dashql_script_to_string,
            dashql_script_scan: module._dashql_script_scan,
            dashql_script_parse: module._dashql_script_parse,
            dashql_script_analyze: module._dashql_script_analyze,
            dashql_script_get_statistics: module._dashql_script_get_statistics,
            dashql_script_get_catalog_entry_id: module._dashql_script_get_catalog_entry_id,
            dashql_script_get_scanned: module._dashql_script_get_scanned,
            dashql_script_get_parsed: module._dashql_script_get_parsed,
            dashql_script_get_analyzed: module._dashql_script_get_analyzed,
            dashql_script_move_cursor: module._dashql_script_move_cursor,
            dashql_script_complete_at_cursor: module._dashql_script_complete_at_cursor,
            dashql_script_select_completion_candidate_at_cursor: module._dashql_script_select_completion_candidate_at_cursor,
            dashql_script_select_completion_catalog_object_at_cursor: module._dashql_script_select_completion_catalog_object_at_cursor,
            dashql_catalog_new: module._dashql_catalog_new,
            dashql_catalog_contains_entry_id: module._dashql_catalog_contains_entry_id,
            dashql_catalog_describe_entries: module._dashql_catalog_describe_entries,
            dashql_catalog_describe_entries_of: module._dashql_catalog_describe_entries_of,
            dashql_catalog_flatten: module._dashql_catalog_flatten,
            dashql_catalog_load_script: module._dashql_catalog_load_script,
            dashql_catalog_update_script: module._dashql_catalog_update_script,
            dashql_catalog_drop_script: module._dashql_catalog_drop_script,
            dashql_catalog_add_descriptor_pool: module._dashql_catalog_add_descriptor_pool,
            dashql_catalog_drop_descriptor_pool: module._dashql_catalog_drop_descriptor_pool,
            dashql_catalog_add_schema_descriptor: module._dashql_catalog_add_schema_descriptor,
            dashql_catalog_add_schema_descriptors: module._dashql_catalog_add_schema_descriptors,
            dashql_catalog_get_statistics: module._dashql_catalog_get_statistics,
            dashql_script_registry_new: module._dashql_script_registry_new,
            dashql_script_registry_clear: module._dashql_script_registry_clear,
            dashql_script_registry_add_script: module._dashql_script_registry_add_script,
            dashql_script_registry_drop_script: module._dashql_script_registry_drop_script,
            dashql_script_registry_find_column: module._dashql_script_registry_find_column,
            dashql_plan_view_model_new: module._dashql_plan_view_model_new,
            dashql_plan_view_model_configure: module._dashql_plan_view_model_configure,
            dashql_plan_view_model_load_hyper_plan: module._dashql_plan_view_model_load_hyper_plan,
            dashql_plan_view_model_reset: module._dashql_plan_view_model_reset,
            dashql_plan_view_model_reset_execution: module._dashql_plan_view_model_reset_execution,
            dashql_plan_view_model_pack: module._dashql_plan_view_model_pack,
        };
    }

    public static async create(options?: {
        instantiateWasm?: InstantiateWasmCallback;
        wasmBinary?: Uint8Array;
        print?: (text: string) => void;
        printErr?: (text: string) => void;
    }): Promise<DashQL> {
        // Call the Emscripten-generated factory function
        // All WASI stubs and initialization are handled automatically!
        const module = await createDashQLModule({
            // Optional hooks for console output
            print: options?.print || ((text: string) => console.log(text)),
            printErr: options?.printErr || ((text: string) => console.error(text)),

            // Optional: preloaded WASM binary for faster instantiation (used in tests)
            wasmBinary: options?.wasmBinary,

            // Optional: intercept WASM instantiation for progress tracking
            instantiateWasm: options?.instantiateWasm,
        });

        return new DashQL(module);
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
        // Encode as UTF-8 using Emscripten's heap view
        const textBuffer = this.module.HEAPU8.subarray(textBegin, textBegin + bufferSize);
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
        const dst = this.module.HEAPU8.subarray(ptr, ptr + src.length);
        dst.set(src);
        return [ptr, src.length];
    }

    // Stack-allocated FFIResult pattern
    // FFIResult layout on wasm32: data_length(4), data_ptr(4), owner_ptr(4), owner_deleter(4) = 16 bytes
    public callSRet(fn: (resultPtr: number) => void): { data_length: number; data_ptr: number; owner_ptr: number; owner_deleter: number } {
        const sp = this.module.stackSave();
        try {
            // Allocate 16 bytes for FFIResult on stack
            const resultPtr = this.module.stackAlloc(16);

            // Call the C function with the stack address
            fn(resultPtr);

            // Read the fields from the stack
            const resultPtrU32 = resultPtr / 4;
            const heapU32 = this.module.HEAPU32;
            return {
                data_length: heapU32[resultPtrU32 + 0],
                data_ptr: heapU32[resultPtrU32 + 1],
                owner_ptr: heapU32[resultPtrU32 + 2],
                owner_deleter: heapU32[resultPtrU32 + 3],
            };
        } finally {
            // Restore stack pointer
            this.module.stackRestore(sp);
        }
    }

    public registerMemory(ptr: DashQLRegisteredMemory) {
        let key = ptr.value.resultPtr;
        if (key == null) {
            return;
        }
        // If this address is already registered, it means WASM reused the address.
        // The old Ptr is now stale - mark it as destroyed to prevent double-free
        if (this.registeredMemory.has(key)) {
            const oldEntry = this.registeredMemory.get(key)!;
            oldEntry.value.value.resultPtr = null;
        }
        this.registeredMemory.set(key!, { value: ptr, epoch: 0 });
    }
    public unregisterMemory(resultPtr: number) {
        this.registeredMemory.delete(resultPtr);
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
        const entries = Array.from(this.registeredMemory.entries());
        for (const [_k, v] of entries) {
            const inner = v.value;
            try {
                inner.value.destroy();
            } catch (e) {
                // Ignore errors during cleanup - object may have already been freed
            }
        }
        this.registeredMemory = new Map();
    }

    public createScript(
        catalog: DashQLCatalog,
        databaseName: string | null = null,
        schemaName: string | null = null,
    ): DashQLScript {
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
        const catalogPtr = catalog?.ptr?.assertNotNull() ?? 0;
        const scriptPtr = this.readPtrResult(SCRIPT_TYPE, (resultPtr) =>
            this.instanceExports.dashql_script_new(resultPtr, catalogPtr)
        );
        const script = new DashQLScript(scriptPtr);
        this.registerMemory({ type: SCRIPT_TYPE, value: script.ptr });
        return script;
    }

    public createCatalog(): DashQLCatalog {
        const ptr = this.readPtrResult(CATALOG_TYPE, (resultPtr) =>
            this.instanceExports.dashql_catalog_new(resultPtr)
        );
        const catalog = new DashQLCatalog(ptr);
        this.registerMemory({ type: CATALOG_TYPE, value: catalog.ptr! });
        return catalog;
    }

    public createScriptRegistry(): DashQLScriptRegistry {
        const ptr = this.readPtrResult(SCRIPT_REGISTRY_TYPE, (resultPtr) =>
            this.instanceExports.dashql_script_registry_new(resultPtr)
        );
        const registry = new DashQLScriptRegistry(ptr);
        this.registerMemory({ type: SCRIPT_REGISTRY_TYPE, value: registry.ptr! });
        return registry;
    }

    public createPlanViewModel(layoutConfig: buffers.view.PlanLayoutConfigT): DashQLPlanViewModel {
        const ptr = this.readPtrResult(PLAN_VIEW_MODEL_TYPE, (resultPtr) =>
            this.instanceExports.dashql_plan_view_model_new(resultPtr)
        );
        const viewModel = new DashQLPlanViewModel(ptr, layoutConfig);
        this.registerMemory({ type: PLAN_VIEW_MODEL_TYPE, value: viewModel.ptr! });
        return viewModel;
    }

    public getVersionText(): string {
        const versionPtr = this.instanceExports.dashql_version();
        const heapU32 = this.module.HEAPU32;
        const dataPtr = heapU32[versionPtr / 4];
        const dataLength = heapU32[versionPtr / 4 + 1];
        const dataArray = this.module.HEAPU8.subarray(dataPtr, dataPtr + dataLength);
        return this.decoder.decode(dataArray);
    }

    public readString(dataPtr: number, dataLength: number): string {
        const dataArray = this.module.HEAPU8.subarray(dataPtr, dataPtr + dataLength);
        return this.decoder.decode(dataArray);
    }

    public readPtrResult<T extends symbol>(ptrType: T, fn: (resultPtr: number) => void) {
        const result = this.callSRet(fn);
        return new Ptr(ptrType, this, result.owner_ptr, result.owner_deleter);
    }

    public readFlatBufferResult<T extends FlatBufferObject<T, O> = any, O = any>(sym: symbol, fn: (resultPtr: number) => void, factory: () => T) {
        const result = this.callSRet(fn);
        return new FlatBufferPtr<T>(sym, this, result.data_ptr, result.data_length, result.owner_ptr, result.owner_deleter, factory);
    }

    public readStringResult(fn: (resultPtr: number) => void): string {
        const result = this.callSRet(fn);
        const dataArray = this.module.HEAPU8.subarray(result.data_ptr, result.data_ptr + result.data_length);
        const text = this.decoder.decode(dataArray);
        // Clean up the owner
        this.instanceExports.dashql_delete_owner(result.owner_ptr, result.owner_deleter);
        return text;
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
    /// Owner info for cleanup
    private ownerPtr: number | null;
    private ownerDeleter: number | null;
    /// Unique key for registration (use owner_ptr as key)
    resultPtr: number | null;

    public constructor(type: T, api: DashQL, ownerPtr: number, ownerDeleter: number) {
        this.type = type;
        this.api = api;
        this.ptr = ownerPtr;
        this.ownerPtr = ownerPtr;
        this.ownerDeleter = ownerDeleter;
        this.resultPtr = ownerPtr; // Use owner_ptr as the key for registration
    }
    /// Delete the object
    public destroy() {
        if (this.ownerPtr != null && this.ownerDeleter != null) {
            try {
                if (this.resultPtr != null) {
                    this.api.unregisterMemory(this.resultPtr);
                }
                this.api.instanceExports.dashql_delete_owner(this.ownerPtr, this.ownerDeleter);
            } catch (e) {
                // Memory may have been freed - this is OK during cleanup
            } finally {
                this.ownerPtr = null;
                this.ownerDeleter = null;
                this.resultPtr = null;
            }
        }
    }
    /// Make sure the pointer is not null
    public assertNotNull(): number {
        if (this.ownerPtr == null) {
            throw NULL_POINTER_EXCEPTION;
        }
        return this.ptr;
    }
    /// Is null?
    public isNull(): boolean {
        return this.ownerPtr == null;
    }
    /// Get the object pointer
    public get(): number | null {
        return this.ptr;
    }
    /// Mark a pointer alive in epoch
    public markAliveInEpoch(epoch: number) {
        if (this.resultPtr == null) {
            throw NULL_POINTER_EXCEPTION;
        }
        const mem = this.api.registeredMemory.get(this.resultPtr);
        if (mem == null) {
            throw NULL_POINTER_EXCEPTION;
        }
        mem.epoch = epoch;
    }
}

export class FlatBufferPtr<T extends FlatBufferObject<T, O>, O = any> {
    /// The object type
    public readonly type: symbol;
    /// The DashQL api
    public readonly api: DashQL;
    /// The data pointer
    dataPtr: number | null;
    /// The data length
    dataLength: number;
    /// Owner info for cleanup
    private ownerPtr: number | null;
    private ownerDeleter: number | null;
    /// Unique key for registration (use owner_ptr as key)
    resultPtr: number | null;
    /// The factory
    factory: () => T;

    public constructor(type: symbol, api: DashQL, dataPtr: number, dataLength: number, ownerPtr: number, ownerDeleter: number, factory: () => T) {
        this.type = type;
        this.api = api;
        this.dataPtr = dataPtr;
        this.dataLength = dataLength;
        this.ownerPtr = ownerPtr;
        this.ownerDeleter = ownerDeleter;
        this.resultPtr = ownerPtr; // Use owner_ptr as the key for registration
        this.factory = factory;
    }
    /// Delete the buffer
    public destroy(registered: boolean = true) {
        if (this.ownerPtr != null && this.ownerDeleter != null) {
            try {
                if (registered && this.resultPtr != null) {
                    this.api.unregisterMemory(this.resultPtr);
                }
                this.api.instanceExports.dashql_delete_owner(this.ownerPtr, this.ownerDeleter);
            } catch (e) {
                // Memory may have been freed - this is OK during cleanup
            } finally {
                this.ownerPtr = null;
                this.ownerDeleter = null;
                this.resultPtr = null;
            }
        }
    }
    /// Make sure the data ptr is not null
    public assertResultNotNull(): number {
        if (this.resultPtr == null) {
            throw NULL_POINTER_EXCEPTION;
        }
        return this.resultPtr;
    }
    /// Make sure the data ptr is not null
    public assertDataNotNull(): number {
        if (this.dataPtr == null) {
            throw NULL_POINTER_EXCEPTION;
        }
        return this.dataPtr;
    }
    /// Get the data
    public get data(): Uint8Array {
        const begin = this.dataPtr ?? 0;
        return this.api.module.HEAPU8.subarray(begin, begin + this.dataLength);
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
        if (this.resultPtr == null) {
            throw NULL_POINTER_EXCEPTION;
        }
        const mem = this.api.registeredMemory.get(this.resultPtr);
        if (mem == null) {
            throw NULL_POINTER_EXCEPTION;
        }
        mem.epoch = epoch;
    }
}

export class ScannerError extends Error {
    public scanned: FlatBufferPtr<buffers.parser.ScannedScript>;
    constructor(scanned: FlatBufferPtr<buffers.parser.ScannedScript>, firstError: buffers.parser.Error) {
        super(firstError.message()!);
        this.scanned = scanned;
    }
}
export class ParserError extends Error {
    public parsed: FlatBufferPtr<buffers.parser.ParsedScript>;
    constructor(parsed: FlatBufferPtr<buffers.parser.ParsedScript>, firstError: buffers.parser.Error) {
        super(firstError.message()!);
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
    /// Get the script id
    public getCatalogEntryId(): number {
        return this.ptr.api.instanceExports.dashql_script_get_catalog_entry_id(this.ptr.assertNotNull());
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
        return this.ptr.api.readStringResult((resultPtr) =>
            this.ptr.api.instanceExports.dashql_script_to_string(resultPtr, scriptPtr)
        );
    }
    /// Scan the script (throws exception on error)
    public scan() {
        const scriptPtr = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_script_scan(scriptPtr);
    }
    /// Parse the script (throws exception on error)
    public parse() {
        const scriptPtr = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_script_parse(scriptPtr);
    }
    /// Analyze the script (throws exception on error)
    public analyze(parseIfOutdated: boolean = true) {
        const scriptPtr = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_script_analyze(scriptPtr, parseIfOutdated);
    }
    /// Get the scanned script
    public getScanned(): FlatBufferPtr<buffers.parser.ScannedScript> {
        const scriptPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.parser.ScannedScript, buffers.parser.ScannedScriptT>(
            SCANNED_SCRIPT_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_get_scanned(resultPtr, scriptPtr),
            () => new buffers.parser.ScannedScript()
        );
        this.ptr.api.registerMemory({ type: SCANNED_SCRIPT_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Get the parsed script
    public getParsed(): FlatBufferPtr<buffers.parser.ParsedScript> {
        const scriptPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.parser.ParsedScript, buffers.parser.ParsedScriptT>(
            PARSED_SCRIPT_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_get_parsed(resultPtr, scriptPtr),
            () => new buffers.parser.ParsedScript()
        );
        this.ptr.api.registerMemory({ type: PARSED_SCRIPT_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Get the analyzed script
    public getAnalyzed(): FlatBufferPtr<buffers.analyzer.AnalyzedScript> {
        const scriptPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.analyzer.AnalyzedScript, buffers.analyzer.AnalyzedScriptT>(
            ANALYZED_SCRIPT_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_get_analyzed(resultPtr, scriptPtr),
            () => new buffers.analyzer.AnalyzedScript()
        );
        this.ptr.api.registerMemory({ type: ANALYZED_SCRIPT_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Move the cursor
    public moveCursor(textOffset: number): FlatBufferPtr<buffers.cursor.ScriptCursor> {
        const scriptPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.cursor.ScriptCursor, buffers.cursor.ScriptCursorT>(
            CURSOR_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_move_cursor(resultPtr, scriptPtr, textOffset),
            () => new buffers.cursor.ScriptCursor()
        );
        this.ptr.api.registerMemory({ type: CURSOR_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Complete at the cursor
    public completeAtCursor(limit: number, registry: DashQLScriptRegistry | null = null): FlatBufferPtr<buffers.completion.Completion> {
        const scriptPtr = this.ptr.assertNotNull();
        const registryPtr = (registry == null || registry.ptr == null) ? 0 : registry.ptr?.assertNotNull();
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.completion.Completion, buffers.completion.CompletionT>(
            COMPLETION_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_complete_at_cursor(resultPtr, scriptPtr, limit, registryPtr),
            () => new buffers.completion.Completion()
        );
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
    public selectCompletionCandidateAtCursor(completion: FlatBufferPtr<buffers.completion.Completion>, candidateId: number): FlatBufferPtr<buffers.completion.Completion> {
        const scriptPtr = this.ptr.assertNotNull();
        const completionPtr = completion.assertDataNotNull();
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.completion.Completion, buffers.completion.CompletionT>(
            COMPLETION_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_select_completion_candidate_at_cursor(resultPtr, scriptPtr, completionPtr, candidateId),
            () => new buffers.completion.Completion()
        );
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
    public selectCompletionCatalogObjectAtCursor(completion: FlatBufferPtr<buffers.completion.Completion>, candidateId: number, catalogObjectIdx: number): FlatBufferPtr<buffers.completion.Completion> {
        const scriptPtr = this.ptr.assertNotNull();
        const completionPtr = completion.assertDataNotNull();
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.completion.Completion, buffers.completion.CompletionT>(
            COMPLETION_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_select_completion_catalog_object_at_cursor(resultPtr, scriptPtr, completionPtr, candidateId, catalogObjectIdx),
            () => new buffers.completion.Completion()
        );
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
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.statistics.ScriptStatistics, buffers.statistics.ScriptStatisticsT>(
            SCRIPT_STATISTICS_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_get_statistics(resultPtr, scriptPtr),
            () => new buffers.statistics.ScriptStatistics()
        );
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
    public readonly ptr: Ptr<typeof CATALOG_TYPE>;
    public snapshot: DashQLCatalogSnapshot | null;

    public constructor(ptr: Ptr<typeof CATALOG_TYPE>) {
        this.ptr = ptr;
        this.snapshot = null;
    }
    /// Delete the graph
    public destroy() {
        this.ptr?.destroy();
    }
    /// Delete the snapshot if there is one
    protected deleteSnapshot() {
        if (this.snapshot != null) {
            this.snapshot.destroy();
            this.snapshot = null;
        }
    }
    /// Reset a catalog
    public clear(): void {
        this.deleteSnapshot();
        this.ptr.api.instanceExports.dashql_catalog_clear(this.ptr.assertNotNull());
    }
    /// Contains an entry id?
    public containsEntryId(entryId: number): boolean {
        return this.ptr.api.instanceExports.dashql_catalog_contains_entry_id(this.ptr.assertNotNull(), entryId);
    }
    /// Describe catalog entries
    public describeEntries(): FlatBufferPtr<buffers.catalog.CatalogEntries> {
        const catalogPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.catalog.CatalogEntries>(
            CATALOG_ENTRIES_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_catalog_describe_entries(resultPtr, catalogPtr),
            () => new buffers.catalog.CatalogEntries()
        );
        this.ptr.api.registerMemory({ type: CATALOG_ENTRIES_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Describe catalog entries
    public describeEntriesOf(id: number): FlatBufferPtr<buffers.catalog.CatalogEntries> {
        const catalogPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.readFlatBufferResult<buffers.catalog.CatalogEntries>(
            CATALOG_ENTRIES_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_catalog_describe_entries_of(resultPtr, catalogPtr, id),
            () => new buffers.catalog.CatalogEntries()
        );
        this.ptr.api.registerMemory({ type: CATALOG_ENTRIES_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Export a catalog snapshot
    public createSnapshot(): DashQLCatalogSnapshot {
        if (this.snapshot != null) {
            return this.snapshot;
        }
        const catalogPtr = this.ptr.assertNotNull();
        const snapshot = this.ptr.api.readFlatBufferResult<buffers.catalog.FlatCatalog>(
            FLAT_CATALOG_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_catalog_flatten(resultPtr, catalogPtr),
            () => new buffers.catalog.FlatCatalog()
        );
        this.snapshot = new DashQLCatalogSnapshot(snapshot);
        this.ptr.api.registerMemory({ type: FLAT_CATALOG_TYPE, value: snapshot });
        return this.snapshot;
    }
    /// Add a script in the registry (throws exception on error)
    public loadScript(script: DashQLScript, rank: number) {
        this.deleteSnapshot();
        this.ptr.api.instanceExports.dashql_catalog_load_script(this.ptr.assertNotNull(), script.ptr.assertNotNull(), rank);
    }
    /// Update a script from the registry
    public dropScript(script: DashQLScript) {
        this.deleteSnapshot();
        this.ptr.api.instanceExports.dashql_catalog_drop_script(this.ptr.assertNotNull(), script.ptr.assertNotNull());
    }
    /// Add an external schema
    public addDescriptorPool(rank: number): number {
        this.deleteSnapshot();
        const catalogPtr = this.ptr.assertNotNull();

        // Unpack the result
        const resultPtr = this.ptr.api.readFlatBufferResult<buffers.catalog.CatalogDescriptorPool>(
            DESCRIPTOR_POOL_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_catalog_add_descriptor_pool(resultPtr, catalogPtr, rank),
            () => new buffers.catalog.CatalogDescriptorPool()
        );
        this.ptr.api.registerMemory({ type: DESCRIPTOR_POOL_TYPE, value: resultPtr });
        const poolPtr = resultPtr.read();
        const entryId = poolPtr.catalogEntryId();
        resultPtr.destroy();
        return entryId;
    }
    /// Drop an external schema
    public dropDescriptorPool(id: number) {
        this.deleteSnapshot();
        const catalogPtr = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_catalog_drop_descriptor_pool(catalogPtr, id);
    }
    /// Add a schema descriptor to a descriptor pool (throws exception on error)
    public addSchemaDescriptor(id: number, buffer: Uint8Array) {
        this.deleteSnapshot();
        const [bufferPtr, bufferLength] = this.ptr.api.copyBuffer(buffer);
        this.ptr.api.instanceExports.dashql_catalog_add_schema_descriptor(
            this.ptr.assertNotNull(),
            id,
            bufferPtr, // pass ownership over buffer
            bufferLength,
        );
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
    /// Add schema descriptors to a descriptor pool (throws exception on error)
    public addSchemaDescriptors(id: number, buffer: Uint8Array) {
        this.deleteSnapshot();
        const [bufferPtr, bufferLength] = this.ptr.api.copyBuffer(buffer);
        this.ptr.api.instanceExports.dashql_catalog_add_schema_descriptors(
            this.ptr.assertNotNull(),
            id,
            bufferPtr, // pass ownership over buffer
            bufferLength,
        );
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
        const resultPtr = this.ptr.api.readFlatBufferResult<buffers.catalog.CatalogStatistics>(
            CATALOG_STATISTICS_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_catalog_get_statistics(resultPtr, catalogPtr),
            () => new buffers.catalog.CatalogStatistics()
        );
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
    public readonly ptr: Ptr<typeof CATALOG_TYPE>;

    public constructor(ptr: Ptr<typeof CATALOG_TYPE>) {
        this.ptr = ptr;
    }
    /// Make sure the pointer is not null
    protected assertNotNull(): Ptr<typeof CATALOG_TYPE> {
        if (this.ptr == null) {
            throw NULL_POINTER_EXCEPTION;
        }
        return this.ptr;
    }
    /// Delete the graph
    public destroy() {
        this.ptr?.destroy();
    }
    /// Reset a script registry
    public clear(): void {
        this.ptr.api.instanceExports.dashql_script_registry_clear(this.ptr.assertNotNull());
    }
    /// Add a script in the registry (throws exception on error)
    public addScript(script: DashQLScript) {
        this.ptr.api.instanceExports.dashql_script_registry_add_script(this.ptr.assertNotNull(), script.ptr.assertNotNull());
    }
    /// Update a script from the registry
    public dropScript(script: DashQLScript) {
        this.ptr.api.instanceExports.dashql_script_registry_drop_script(this.ptr.assertNotNull(), script.ptr.assertNotNull());
    }
    /// Find information about a column
    public findColumnInfo(table_id: bigint, table_column_id: number, referenced_catalog_version: number | null = null): FlatBufferPtr<buffers.registry.ScriptRegistryColumnInfo, buffers.registry.ScriptRegistryColumnInfoT> {
        // Lookup a column in the script registry
        const catalogVersion = referenced_catalog_version == null ? -1 : referenced_catalog_version;
        const registryPtr = this.ptr.assertNotNull();
        // Unpack the result
        const resultPtr = this.ptr.api.readFlatBufferResult<buffers.registry.ScriptRegistryColumnInfo>(
            SCRIPT_REGISTRY_COLUMN_INFO_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_registry_find_column(
                resultPtr,
                registryPtr,
                ExternalObjectID.getOrigin(table_id),
                ExternalObjectID.getObject(table_id),
                table_column_id,
                catalogVersion
            ),
            () => new buffers.registry.ScriptRegistryColumnInfo()
        );
        this.ptr.api.registerMemory({ type: SCRIPT_REGISTRY_COLUMN_INFO_TYPE, value: resultPtr });
        return resultPtr;
    }
}

export class DashQLPlanViewModel {
    public readonly ptr: Ptr<typeof CATALOG_TYPE>;
    public layout: buffers.view.PlanLayoutConfigT;
    public buffer: FlatBufferPtr<buffers.view.PlanViewModel, buffers.view.PlanViewModelT> | null;

    public constructor(ptr: Ptr<typeof CATALOG_TYPE>, layout: buffers.view.PlanLayoutConfigT) {
        this.ptr = ptr;
        this.layout = layout;
        this.reconfigure(layout);
        this.buffer = null;
    }
    /// Delete the plan view model
    public destroy() {
        this.ptr?.destroy();
        this.buffer?.destroy();
    }
    /// Reconfigure the plan view model
    public reconfigure(config: buffers.view.PlanLayoutConfigT) {
        this.layout = config;
        this.ptr.api.instanceExports.dashql_plan_view_model_configure(
            this.ptr.assertNotNull(),
            this.layout.levelHeight,
            this.layout.nodeHeight,
            this.layout.nodeMarginHorizontal,
            this.layout.nodePaddingLeft,
            this.layout.nodePaddingRight,
            this.layout.iconWidth,
            this.layout.iconMarginRight,
            this.layout.maxLabelChars,
            this.layout.widthPerLabelChar,
            this.layout.nodeMinWidth,
        );
    }
    /// Pack a Hyper plan as FlatBuffer
    public pack(): FlatBufferPtr<buffers.view.PlanViewModel, buffers.view.PlanViewModelT> {
        const viewModelPtr = this.ptr.assertNotNull();
        const resultPtr = this.ptr.api.readFlatBufferResult<buffers.view.PlanViewModel>(
            FLAT_PLAN_VIEW_MODEL_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_plan_view_model_pack(resultPtr, viewModelPtr),
            () => new buffers.view.PlanViewModel()
        );
        this.ptr.api.registerMemory({ type: FLAT_PLAN_VIEW_MODEL_TYPE, value: resultPtr });
        this.buffer?.destroy();
        this.buffer = resultPtr;
        return this.buffer;
    }
    /// Reset a Hyper plan
    public reset(): FlatBufferPtr<buffers.view.PlanViewModel, buffers.view.PlanViewModelT> {
        this.ptr.api.instanceExports.dashql_plan_view_model_reset(this.ptr.assertNotNull());
        this.buffer?.destroy();
        this.buffer = null;
        this.buffer = this.pack();
        return this.buffer;
    }
    /// Reset a Hyper plan
    public resetExecution(): FlatBufferPtr<buffers.view.PlanViewModel, buffers.view.PlanViewModelT> {
        this.ptr.api.instanceExports.dashql_plan_view_model_reset_execution(this.ptr.assertNotNull());
        this.buffer?.destroy();
        this.buffer = null;
        this.buffer = this.pack();
        return this.buffer;
    }
    /// Load a Hyper plan (throws exception on error)
    public loadHyperPlan(plan: string): FlatBufferPtr<buffers.view.PlanViewModel, buffers.view.PlanViewModelT> {
        const [textBegin, textLength] = this.ptr.api.copyString(plan);
        this.ptr.api.instanceExports.dashql_plan_view_model_load_hyper_plan(this.ptr.assertNotNull(), textBegin, textLength);
        this.buffer?.destroy();
        this.buffer = null;
        this.buffer = this.pack();
        return this.buffer;
    }
}
