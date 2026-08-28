import * as buffers from './buffers.js';
import * as flatbuffers from 'flatbuffers';

import { VariantKind } from './variant.js';

// Emscripten module interface (what the generated JS provides)
export interface EmscriptenModule {
    // Memory views (Emscripten provides these automatically)
    HEAP8: Int8Array;
    HEAPU8: Uint8Array;
    HEAP16: Int16Array;
    HEAPU16: Uint16Array;
    HEAP32: Int32Array;
    HEAPU32: Uint32Array;
    HEAPF32: Float32Array;
    HEAPF64: Float64Array;

    memory?: WebAssembly.Memory;
    onDashQLAnalysisJobComplete?: (jobId: number, state: number) => void;

    // Stack manipulation functions (for stack allocation)
    stackSave: () => number;
    stackAlloc: (size: number) => number;
    stackRestore: (ptr: number) => void;

    // All C functions exported with underscore prefix
    _dashql_malloc: (length: number) => number;
    _dashql_free: (ptr: number) => void;
    _dashql_delete_owner: (owner_ptr: number, owner_deleter: number) => void;
    _dashql_agent_session_new: (result: number, catalog: number, target: number, dialect: number, mode: number, maxWidth: number, indentationWidth: number, debugMode: boolean) => void;
    _dashql_agent_session_start: (result: number, ptr: number, request: number, requestLength: number) => void;
    _dashql_agent_session_complete_effect: (result: number, ptr: number, completion: number, completionLength: number) => void;
    _dashql_agent_session_cancel: (result: number, ptr: number) => void;
    _dashql_editor_session_new: (result: number, catalog: number, offsetUnit: number) => void;
    _dashql_editor_session_destroy: (ptr: number) => void;
    _dashql_editor_session_get_catalog_entry_id: (ptr: number) => number;
    _dashql_editor_session_get_text: (result: number, ptr: number) => void;
    _dashql_editor_session_get_document_revision: (ptr: number) => bigint;
    _dashql_editor_session_get_state_revision: (ptr: number) => bigint;
    _dashql_editor_session_get_catalog_revision: (ptr: number) => bigint;
    _dashql_editor_session_replace_text: (result: number, ptr: number, expectedDocumentRevision: bigint, text: number, textLength: number) => void;
    _dashql_editor_session_apply: (result: number, ptr: number, event: number, eventLength: number) => void;
    _dashql_editor_session_set_primary_cursor: (result: number, ptr: number, expectedDocumentRevision: bigint, offset: bigint) => void;
    _dashql_editor_session_ensure_analysis: (result: number, ptr: number) => void;
    _dashql_editor_session_complete_at_cursor: (result: number, ptr: number, limit: number) => void;
    _dashql_editor_session_compile_query: (result: number, ptr: number, dialect: number, mode: number, maxWidth: number, indentationWidth: number, allowExtensions: boolean, parseIfOutdated: boolean) => void;
    _dashql_editor_session_format: (result: number, ptr: number, dialect: number, mode: number, maxWidth: number, indentationWidth: number, debugMode: boolean, parseIfOutdated: boolean, catalog: number) => void;
    _dashql_editor_session_is_fully_formattable: (ptr: number, dialect: number, mode: number, maxWidth: number, indentationWidth: number, debugMode: boolean, parseIfOutdated: boolean) => number;
    _dashql_editor_session_compute_diff: (result: number, ptr: number, target: number) => void;
    _dashql_editor_session_load_into_catalog: (ptr: number, rank: number) => void;
    _dashql_editor_session_drop_from_catalog: (ptr: number) => void;
    _dashql_script_new: (result: number, catalog: number) => void;
    _dashql_script_insert_text_at: (ptr: number, offset: number, text: number, textLength: number) => void;
    _dashql_script_insert_char_at: (ptr: number, offset: number, unicode: number) => void;
    _dashql_script_erase_text_range: (ptr: number, offset: number, length: number) => void;
    _dashql_script_replace_text: (ptr: number, text: number, textLength: number) => void;
    _dashql_script_to_string: (result: number, ptr: number, offset: number, length: number) => void;
    _dashql_script_get_statement_text: (result: number, ptr: number, parse_if_outdated: boolean) => void;
    _dashql_script_compile_query: (result: number, ptr: number, dialect: number, mode: number, max_width: number, indentation_width: number, allow_extensions: boolean, parse_if_outdated: boolean) => void;
    _dashql_script_parse: (ptr: number) => void;
    _dashql_script_analyze: (ptr: number, parse_if_outdated: boolean) => void;
    _dashql_script_analyze_async: (ptr: number, parse_if_outdated: boolean) => number;
    _dashql_script_analysis_job_get_error_code: (job: number) => number;
    _dashql_script_analysis_job_get_error_message: (result: number, job: number) => void;
    _dashql_script_analysis_job_cancel: (job: number) => boolean;
    _dashql_script_analysis_job_release: (job: number) => void;
    _dashql_script_move_cursor: (result: number, ptr: number, offset: number) => void;
    _dashql_script_complete_at_cursor: (result: number, ptr: number, limit: number) => void;
    _dashql_script_get_catalog_entry_id: (ptr: number) => number;
    _dashql_script_get_parsed: (result: number, ptr: number) => void;
    _dashql_script_get_analyzed: (result: number, ptr: number) => void;
    _dashql_script_compute_diff: (result: number, source: number, target: number) => void;
    _dashql_script_get_statistics: (result: number, ptr: number) => void;
    _dashql_script_format: (result: number, ptr: number, dialect: number, mode: number, max_width: number, indentation_width: number, debug_mode: boolean, parse_if_outdated: boolean, catalog: number) => void;
    _dashql_script_is_fully_formattable: (ptr: number, dialect: number, mode: number, max_width: number, indentation_width: number, debug_mode: boolean, parse_if_outdated: boolean) => number;
    _dashql_script_get_unformattable_nodes: (result: number, ptr: number, dialect: number, mode: number, max_width: number, indentation_width: number, debug_mode: boolean, parse_if_outdated: boolean) => void;
    _dashql_catalog_new: (result: number) => void;
    _dashql_catalog_clear: (catalog_ptr: number) => void;
    _dashql_catalog_contains_entry_id: (catalog_ptr: number, external_id: number) => boolean;
    _dashql_catalog_describe_entries: (result: number, catalog_ptr: number) => void;
    _dashql_catalog_describe_entries_of: (result: number, catalog_ptr: number, external_id: number) => void;
    _dashql_catalog_flatten: (result: number, catalog_ptr: number) => void;
    _dashql_parse_vegalite_to_visualize: (result: number, json: number, json_length: number) => void;
    _dashql_catalog_load_script: (catalog_ptr: number, script_ptr: number, rank: number) => void;
    _dashql_catalog_load_scripts: (catalog_ptr: number, script_ptrs: number, ranks: number, script_count: number) => void;
    _dashql_catalog_drop_script: (catalog_ptr: number, script_ptr: number) => void;
    _dashql_catalog_get_statistics: (result: number, ptr: number) => void;
    _dashql_plan_view_model_new: (result: number) => void;
    _dashql_plan_view_model_configure: (viewmodel_ptr: number, levelHeight: number, nodeHeight: number, nodeMarginHorizontal: number, nodePaddingLeft: number, nodePaddingRight: number, iconWidth: number, iconMarginRight: number, maxLabelChars: number, widthPerLabelChar: number, minNodeWidth: number) => void;
    _dashql_plan_view_model_load_hyper_plan: (viewmodel_ptr: number, text: number, text_length: number) => void;
    _dashql_plan_view_model_reset: (viewmodel_ptr: number) => void;
    _dashql_plan_view_model_reset_execution: (viewmodel_ptr: number) => void;
    _dashql_plan_view_model_pack: (result: number, viewmodel_ptr: number) => void;
}

export interface DashQLModuleOptions {
    instantiateWasm?: InstantiateWasmCallback;
    wasmBinary?: Uint8Array;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
    locateFile?: (path: string, prefix: string) => string;
    mainScriptUrlOrBlob?: string | Blob;
}

// Our cleaned-up API interface (without underscores)
interface DashQLModuleExports {
    dashql_malloc: (length: number) => number;
    dashql_free: (ptr: number) => void;
    dashql_delete_owner: (owner_ptr: number, owner_deleter: number) => void;

    dashql_agent_session_new: (result: number, catalog: number, target: number, dialect: number, mode: number, maxWidth: number, indentationWidth: number, debugMode: boolean) => void;
    dashql_agent_session_start: (result: number, ptr: number, request: number, requestLength: number) => void;
    dashql_agent_session_complete_effect: (result: number, ptr: number, completion: number, completionLength: number) => void;
    dashql_agent_session_cancel: (result: number, ptr: number) => void;

    dashql_editor_session_new: (result: number, catalog: number, offsetUnit: number) => void;
    dashql_editor_session_destroy: (ptr: number) => void;
    dashql_editor_session_get_catalog_entry_id: (ptr: number) => number;
    dashql_editor_session_get_text: (result: number, ptr: number) => void;
    dashql_editor_session_get_document_revision: (ptr: number) => bigint;
    dashql_editor_session_get_state_revision: (ptr: number) => bigint;
    dashql_editor_session_get_catalog_revision: (ptr: number) => bigint;
    dashql_editor_session_replace_text: (result: number, ptr: number, expectedDocumentRevision: bigint, text: number, textLength: number) => void;
    dashql_editor_session_apply: (result: number, ptr: number, event: number, eventLength: number) => void;
    dashql_editor_session_set_primary_cursor: (result: number, ptr: number, expectedDocumentRevision: bigint, offset: bigint) => void;
    dashql_editor_session_ensure_analysis: (result: number, ptr: number) => void;
    dashql_editor_session_complete_at_cursor: (result: number, ptr: number, limit: number) => void;
    dashql_editor_session_compile_query: (result: number, ptr: number, dialect: number, mode: number, maxWidth: number, indentationWidth: number, allowExtensions: boolean, parseIfOutdated: boolean) => void;
    dashql_editor_session_format: (result: number, ptr: number, dialect: number, mode: number, maxWidth: number, indentationWidth: number, debugMode: boolean, parseIfOutdated: boolean, catalog: number) => void;
    dashql_editor_session_is_fully_formattable: (ptr: number, dialect: number, mode: number, maxWidth: number, indentationWidth: number, debugMode: boolean, parseIfOutdated: boolean) => number;
    dashql_editor_session_compute_diff: (result: number, ptr: number, target: number) => void;
    dashql_editor_session_load_into_catalog: (ptr: number, rank: number) => void;
    dashql_editor_session_drop_from_catalog: (ptr: number) => void;

    dashql_script_new: (result: number, catalog: number) => void;
    dashql_script_insert_text_at: (ptr: number, offset: number, text: number, textLength: number) => void;
    dashql_script_insert_char_at: (ptr: number, offset: number, unicode: number) => void;
    dashql_script_erase_text_range: (ptr: number, offset: number, length: number) => void;
    dashql_script_replace_text: (ptr: number, text: number, textLength: number) => void;
    dashql_script_to_string: (result: number, ptr: number, offset: number, length: number) => void;
    dashql_script_get_statement_text: (result: number, ptr: number, parse_if_outdated: boolean) => void;
    dashql_script_compile_query: (result: number, ptr: number, dialect: number, mode: number, max_width: number, indentation_width: number, allow_extensions: boolean, parse_if_outdated: boolean) => void;
    dashql_script_parse: (ptr: number) => void;
    dashql_script_analyze: (ptr: number, parse_if_outdated: boolean) => void;
    dashql_script_analyze_async: (ptr: number, parse_if_outdated: boolean) => number;
    dashql_script_analysis_job_get_error_code: (job: number) => number;
    dashql_script_analysis_job_get_error_message: (result: number, job: number) => void;
    dashql_script_analysis_job_cancel: (job: number) => boolean;
    dashql_script_analysis_job_release: (job: number) => void;
    dashql_script_move_cursor: (result: number, ptr: number, offset: number) => void;
    dashql_script_complete_at_cursor: (result: number, ptr: number, limit: number) => void;
    dashql_script_get_catalog_entry_id: (ptr: number) => number;
    dashql_script_get_parsed: (result: number, ptr: number) => void;
    dashql_script_get_analyzed: (result: number, ptr: number) => void;
    dashql_script_compute_diff: (result: number, source: number, target: number) => void;
    dashql_script_get_statistics: (result: number, ptr: number) => void;
    dashql_script_format: (result: number, ptr: number, dialect: number, mode: number, max_width: number, indentation_width: number, debug_mode: boolean, parse_if_outdated: boolean, catalog: number) => void;
    dashql_script_is_fully_formattable: (ptr: number, dialect: number, mode: number, max_width: number, indentation_width: number, debug_mode: boolean, parse_if_outdated: boolean) => number;
    dashql_script_get_unformattable_nodes: (result: number, ptr: number, dialect: number, mode: number, max_width: number, indentation_width: number, debug_mode: boolean, parse_if_outdated: boolean) => void;

    dashql_catalog_new: (result: number) => void;
    dashql_catalog_clear: (catalog_ptr: number) => void;
    dashql_catalog_contains_entry_id: (catalog_ptr: number, external_id: number) => boolean;
    dashql_catalog_describe_entries: (result: number, catalog_ptr: number) => void;
    dashql_catalog_describe_entries_of: (result: number, catalog_ptr: number, external_id: number) => void;
    dashql_catalog_flatten: (result: number, catalog_ptr: number) => void;
    dashql_parse_vegalite_to_visualize: (result: number, json: number, json_length: number) => void;
    dashql_catalog_load_script: (catalog_ptr: number, script_ptr: number, rank: number) => void;
    dashql_catalog_load_scripts: (catalog_ptr: number, script_ptrs: number, ranks: number, script_count: number) => void;
    dashql_catalog_drop_script: (catalog_ptr: number, script_ptr: number) => void;
    dashql_catalog_get_statistics: (result: number, ptr: number) => void;

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
    export default function createDashQLModule(options?: DashQLModuleOptions): Promise<EmscriptenModule>;
}

interface FlatBufferObject<T, O> {
    __init(i: number, bb: flatbuffers.ByteBuffer): T;
    unpack(): O;
}

const ANALYZED_SCRIPT_TYPE = Symbol('ANALYZED_SCRIPT_TYPE');
const AGENT_SESSION_TYPE = Symbol('AGENT_SESSION_TYPE');
const AGENT_OPERATION_TYPE = Symbol('AGENT_OPERATION_TYPE');
const CATALOG_ENTRIES_TYPE = Symbol('CATALOG_ENTRIES_TYPE');
const CATALOG_STATISTICS_TYPE = Symbol('CATALOG_STATISTICS_TYPE');
const CATALOG_TYPE = Symbol('CATALOG_TYPE');
const COMPLETION_TYPE = Symbol('COMPLETION_TYPE');
const CURSOR_TYPE = Symbol('CURSOR_TYPE');
const EDITOR_SESSION_TYPE = Symbol('EDITOR_SESSION_TYPE');
const EDITOR_UPDATE_TYPE = Symbol('EDITOR_UPDATE_TYPE');
const SCRIPT_DIFF_TYPE = Symbol('SCRIPT_DIFF_TYPE');
const SCRIPT_COMPILATION_TYPE = Symbol('SCRIPT_COMPILATION_TYPE');
const FLAT_CATALOG_TYPE = Symbol('FLAT_CATALOG_TYPE');
const FLAT_PLAN_VIEW_MODEL_TYPE = Symbol('FLAT_PLAN_VIEW_MODEL_TYPE');
const PARSED_SCRIPT_TYPE = Symbol('PARSED_SCRIPT_TYPE');
const PLAN_VIEW_MODEL_TYPE = Symbol('PLAN_VIEW_MODEL_TYPE');
const SCRIPT_STATISTICS_TYPE = Symbol('SCRIPT_STATISTICS_TYPE');
const SCRIPT_TYPE = Symbol('SCRIPT_TYPE');
const TEMPORARY = Symbol('TEMPORARY');

export type DashQLRegisteredMemory =
    | VariantKind<typeof AGENT_SESSION_TYPE, Ptr<typeof AGENT_SESSION_TYPE>>
    | VariantKind<typeof AGENT_OPERATION_TYPE, FlatBufferPtr<buffers.agent.AgentOperation>>
    | VariantKind<typeof ANALYZED_SCRIPT_TYPE, FlatBufferPtr<buffers.analyzer.AnalyzedScript>>
    | VariantKind<typeof CATALOG_ENTRIES_TYPE, FlatBufferPtr<buffers.catalog.CatalogEntries>>
    | VariantKind<typeof CATALOG_STATISTICS_TYPE, FlatBufferPtr<buffers.catalog.CatalogStatistics>>
    | VariantKind<typeof CATALOG_TYPE, Ptr<typeof CATALOG_TYPE>>
    | VariantKind<typeof COMPLETION_TYPE, FlatBufferPtr<buffers.completion.Completion>>
    | VariantKind<typeof CURSOR_TYPE, FlatBufferPtr<buffers.cursor.ScriptCursor>>
    | VariantKind<typeof EDITOR_SESSION_TYPE, Ptr<typeof EDITOR_SESSION_TYPE>>
    | VariantKind<typeof EDITOR_UPDATE_TYPE, FlatBufferPtr<buffers.editor.EditorUpdate>>
    | VariantKind<typeof SCRIPT_DIFF_TYPE, FlatBufferPtr<buffers.diff.ScriptDiff>>
    | VariantKind<typeof SCRIPT_COMPILATION_TYPE, FlatBufferPtr<buffers.execution.ScriptCompilationResult>>
    | VariantKind<typeof FLAT_CATALOG_TYPE, FlatBufferPtr<buffers.catalog.FlatCatalog>>
    | VariantKind<typeof FLAT_PLAN_VIEW_MODEL_TYPE, FlatBufferPtr<buffers.view.PlanViewModel>>
    | VariantKind<typeof PARSED_SCRIPT_TYPE, FlatBufferPtr<buffers.parser.ParsedScript>>
    | VariantKind<typeof PLAN_VIEW_MODEL_TYPE, Ptr<typeof PLAN_VIEW_MODEL_TYPE>>
    | VariantKind<typeof SCRIPT_STATISTICS_TYPE, FlatBufferPtr<buffers.statistics.ScriptStatistics>>
    | VariantKind<typeof SCRIPT_TYPE, Ptr<typeof SCRIPT_TYPE>>
    | VariantKind<typeof TEMPORARY, FlatBufferPtr<any>>
    ;

export interface DashQLRegisteredMemoryEntry {
    value: DashQLRegisteredMemory;
}

export class DashQL {
    encoder: TextEncoder;
    decoder: TextDecoder;
    module: EmscriptenModule;
    memory: WebAssembly.Memory;
    instanceExports: DashQLModuleExports;
    nextScriptId: number;
    registeredMemory: Map<number, DashQLRegisteredMemoryEntry>;
    private asyncAnalysisJobs = new Map<number, {
        resolve: () => void;
        reject: (error: AsyncAnalysisError) => void;
    }>();
    private completedAsyncAnalysisJobs = new Map<number, number>();

    public constructor(module: EmscriptenModule) {
        this.encoder = new TextEncoder();
        this.decoder = new TextDecoder();
        this.module = module;
        this.memory = module.memory ?? ({ buffer: module.HEAPU8.buffer } as WebAssembly.Memory);
        this.nextScriptId = 1;
        this.registeredMemory = new Map();
        module.onDashQLAnalysisJobComplete = (jobId, state) => this.completeAsyncAnalysisJob(jobId, state);

        // Wrap all Emscripten exports, removing the leading underscore
        this.instanceExports = {
            dashql_malloc: module._dashql_malloc,
            dashql_free: module._dashql_free,
            dashql_delete_owner: module._dashql_delete_owner,
            dashql_agent_session_new: module._dashql_agent_session_new,
            dashql_agent_session_start: module._dashql_agent_session_start,
            dashql_agent_session_complete_effect: module._dashql_agent_session_complete_effect,
            dashql_agent_session_cancel: module._dashql_agent_session_cancel,
            dashql_editor_session_new: module._dashql_editor_session_new,
            dashql_editor_session_destroy: module._dashql_editor_session_destroy,
            dashql_editor_session_get_catalog_entry_id: module._dashql_editor_session_get_catalog_entry_id,
            dashql_editor_session_get_text: module._dashql_editor_session_get_text,
            dashql_editor_session_get_document_revision: module._dashql_editor_session_get_document_revision,
            dashql_editor_session_get_state_revision: module._dashql_editor_session_get_state_revision,
            dashql_editor_session_get_catalog_revision: module._dashql_editor_session_get_catalog_revision,
            dashql_editor_session_replace_text: module._dashql_editor_session_replace_text,
            dashql_editor_session_apply: module._dashql_editor_session_apply,
            dashql_editor_session_set_primary_cursor: module._dashql_editor_session_set_primary_cursor,
            dashql_editor_session_ensure_analysis: module._dashql_editor_session_ensure_analysis,
            dashql_editor_session_complete_at_cursor: module._dashql_editor_session_complete_at_cursor,
            dashql_editor_session_compile_query: module._dashql_editor_session_compile_query,
            dashql_editor_session_format: module._dashql_editor_session_format,
            dashql_editor_session_is_fully_formattable: module._dashql_editor_session_is_fully_formattable,
            dashql_editor_session_compute_diff: module._dashql_editor_session_compute_diff,
            dashql_editor_session_load_into_catalog: module._dashql_editor_session_load_into_catalog,
            dashql_editor_session_drop_from_catalog: module._dashql_editor_session_drop_from_catalog,
            dashql_script_new: module._dashql_script_new,
            dashql_catalog_clear: module._dashql_catalog_clear,
            dashql_script_insert_text_at: module._dashql_script_insert_text_at,
            dashql_script_insert_char_at: module._dashql_script_insert_char_at,
            dashql_script_erase_text_range: module._dashql_script_erase_text_range,
            dashql_script_replace_text: module._dashql_script_replace_text,
            dashql_script_to_string: module._dashql_script_to_string,
            dashql_script_get_statement_text: module._dashql_script_get_statement_text,
            dashql_script_compile_query: module._dashql_script_compile_query,
            dashql_script_parse: module._dashql_script_parse,
            dashql_script_analyze: module._dashql_script_analyze,
            dashql_script_analyze_async: module._dashql_script_analyze_async,
            dashql_script_analysis_job_get_error_code: module._dashql_script_analysis_job_get_error_code,
            dashql_script_analysis_job_get_error_message: module._dashql_script_analysis_job_get_error_message,
            dashql_script_analysis_job_cancel: module._dashql_script_analysis_job_cancel,
            dashql_script_analysis_job_release: module._dashql_script_analysis_job_release,
            dashql_script_get_statistics: module._dashql_script_get_statistics,
            dashql_script_get_catalog_entry_id: module._dashql_script_get_catalog_entry_id,
            dashql_script_get_parsed: module._dashql_script_get_parsed,
            dashql_script_get_analyzed: module._dashql_script_get_analyzed,
            dashql_script_compute_diff: module._dashql_script_compute_diff,
            dashql_script_move_cursor: module._dashql_script_move_cursor,
            dashql_script_complete_at_cursor: module._dashql_script_complete_at_cursor,
            dashql_script_format: module._dashql_script_format,
            dashql_script_is_fully_formattable: module._dashql_script_is_fully_formattable,
            dashql_script_get_unformattable_nodes: module._dashql_script_get_unformattable_nodes,
            dashql_catalog_new: module._dashql_catalog_new,
            dashql_catalog_contains_entry_id: module._dashql_catalog_contains_entry_id,
            dashql_catalog_describe_entries: module._dashql_catalog_describe_entries,
            dashql_catalog_describe_entries_of: module._dashql_catalog_describe_entries_of,
            dashql_catalog_flatten: module._dashql_catalog_flatten,
            dashql_parse_vegalite_to_visualize: module._dashql_parse_vegalite_to_visualize,
            dashql_catalog_load_script: module._dashql_catalog_load_script,
            dashql_catalog_load_scripts: module._dashql_catalog_load_scripts,
            dashql_catalog_drop_script: module._dashql_catalog_drop_script,
            dashql_catalog_get_statistics: module._dashql_catalog_get_statistics,
            dashql_plan_view_model_new: module._dashql_plan_view_model_new,
            dashql_plan_view_model_configure: module._dashql_plan_view_model_configure,
            dashql_plan_view_model_load_hyper_plan: module._dashql_plan_view_model_load_hyper_plan,
            dashql_plan_view_model_reset: module._dashql_plan_view_model_reset,
            dashql_plan_view_model_reset_execution: module._dashql_plan_view_model_reset_execution,
            dashql_plan_view_model_pack: module._dashql_plan_view_model_pack,
        };
    }

    public waitForAsyncAnalysisJob(jobId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.asyncAnalysisJobs.set(jobId, { resolve, reject });
            const state = this.completedAsyncAnalysisJobs.get(jobId);
            if (state != null) {
                this.completedAsyncAnalysisJobs.delete(jobId);
                this.completeAsyncAnalysisJob(jobId, state);
            }
        });
    }

    private completeAsyncAnalysisJob(jobId: number, state: number): void {
        const pending = this.asyncAnalysisJobs.get(jobId);
        if (pending == null) {
            this.completedAsyncAnalysisJobs.set(jobId, state);
            return;
        }
        this.asyncAnalysisJobs.delete(jobId);
        if (state === 3) {
            pending.resolve();
            return;
        }
        if (state === 4) {
            const code = this.instanceExports.dashql_script_analysis_job_get_error_code(jobId);
            const message = this.readStringResult((resultPtr) =>
                this.instanceExports.dashql_script_analysis_job_get_error_message(resultPtr, jobId)
            );
            pending.reject(new AsyncAnalysisError(code, message));
            return;
        }
        pending.reject(new AsyncAnalysisError(0, 'asynchronous analysis was cancelled'));
    }

    public static async create(options?: DashQLModuleOptions): Promise<DashQL> {
        const testWorkerUrl = (globalThis as typeof globalThis & { DASHQL_CORE_WORKER_URL?: string })
            .DASHQL_CORE_WORKER_URL;
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

            locateFile: options?.locateFile,
            mainScriptUrlOrBlob: options?.mainScriptUrlOrBlob ?? testWorkerUrl,
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
        // TextEncoder rejects views backed by SharedArrayBuffer, as used by pthread Wasm modules.
        const encodedBuffer = new Uint8Array(bufferSize);
        const textEncoded = this.encoder.encodeInto(text, encodedBuffer);
        if (textEncoded.written == undefined || textEncoded.written == 0) {
            this.instanceExports.dashql_free(textBegin);
            throw new Error(`failed to encode a string of size ${text.length}`);
        }
        const textBuffer = this.module.HEAPU8.subarray(textBegin, textBegin + bufferSize);
        textBuffer.set(encodedBuffer.subarray(0, textEncoded.written));
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
        this.registeredMemory.set(key!, { value: ptr });
    }
    public unregisterMemory(resultPtr: number) {
        this.registeredMemory.delete(resultPtr);
    }
    /// Destroy all registered memory.
    /// This is unsafe because it will just release all memory while javascript might still reference into the heap.
    /// Test-only teardown helper.
    ///
    /// Objects are freed in reverse registration order (LIFO, like RAII) because
    /// some destructors reach into objects registered earlier: e.g. Script::~Script
    /// calls catalog.DropScript(*this). A catalog is typically created (and thus
    /// registered) before the scripts loaded into it, so freeing in registration
    /// order would destroy the catalog first and leave ~Script touching freed
    /// memory, corrupting the WASM allocator. Reverse order destroys the scripts
    /// before the catalog they depend on.
    public resetUnsafe() {
        const entries = Array.from(this.registeredMemory.entries());
        for (let i: number = entries.length - 1; i >= 0; --i) {
            const inner = entries[i][1].value;
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
        const scriptPtr = this.callSRetPtr(SCRIPT_TYPE, (resultPtr) =>
            this.instanceExports.dashql_script_new(resultPtr, catalogPtr)
        );
        const script = new DashQLScript(scriptPtr);
        this.registerMemory({ type: SCRIPT_TYPE, value: script.ptr });
        return script;
    }

    public createAgentSession(
        catalog: DashQLCatalog,
        target: DashQLEditorSession | null = null,
        formattingConfig: buffers.formatting.FormattingConfigT = new buffers.formatting.FormattingConfigT(
            buffers.formatting.FormattingDialect.HYPER,
            buffers.formatting.FormattingMode.PRETTY,
            120,
            2,
            false,
        ),
    ): DashQLAgentSession {
        const catalogPtr = catalog.ptr.assertNotNull();
        const targetPtr = target?.ptr.assertNotNull() ?? 0;
        const ptr = this.callSRetPtr(AGENT_SESSION_TYPE, (resultPtr) =>
            this.instanceExports.dashql_agent_session_new(
                resultPtr,
                catalogPtr,
                targetPtr,
                formattingConfig.dialect,
                formattingConfig.mode,
                formattingConfig.maxWidth,
                formattingConfig.indentationWidth,
                formattingConfig.debugMode,
            )
        );
        const session = new DashQLAgentSession(ptr);
        this.registerMemory({ type: AGENT_SESSION_TYPE, value: session.ptr });
        return session;
    }

    public createCatalog(): DashQLCatalog {
        const ptr = this.callSRetPtr(CATALOG_TYPE, (resultPtr) =>
            this.instanceExports.dashql_catalog_new(resultPtr)
        );
        const catalog = new DashQLCatalog(ptr);
        this.registerMemory({ type: CATALOG_TYPE, value: catalog.ptr! });
        return catalog;
    }

    public createEditorSession(
        catalog: DashQLCatalog,
        offsetUnit = buffers.editor.EditorOffsetUnit.UTF16_CODE_UNITS,
    ): DashQLEditorSession {
        const catalogPtr = catalog.ptr.assertNotNull();
        const ptr = this.callSRetPtr(EDITOR_SESSION_TYPE, (resultPtr) =>
            this.instanceExports.dashql_editor_session_new(resultPtr, catalogPtr, offsetUnit)
        );
        const session = new DashQLEditorSession(ptr);
        this.registerMemory({ type: EDITOR_SESSION_TYPE, value: session.ptr });
        return session;
    }

    public createPlanViewModel(layoutConfig: buffers.view.PlanLayoutConfigT): DashQLPlanViewModel {
        const ptr = this.callSRetPtr(PLAN_VIEW_MODEL_TYPE, (resultPtr) =>
            this.instanceExports.dashql_plan_view_model_new(resultPtr)
        );
        const viewModel = new DashQLPlanViewModel(ptr, layoutConfig);
        this.registerMemory({ type: PLAN_VIEW_MODEL_TYPE, value: viewModel.ptr! });
        return viewModel;
    }

    public readString(dataPtr: number, dataLength: number): string {
        const dataArray = new Uint8Array(this.module.HEAPU8.subarray(dataPtr, dataPtr + dataLength));
        return this.decoder.decode(dataArray);
    }

    public callSRetPtr<T extends symbol>(ptrType: T, fn: (resultPtr: number) => void) {
        const result = this.callSRet(fn);
        return new Ptr(ptrType, this, result.owner_ptr, result.owner_deleter);
    }

    public callSRetFlatBufPtr<T extends FlatBufferObject<T, O> = any, O = any>(sym: symbol, fn: (resultPtr: number) => void, factory: () => T) {
        const result = this.callSRet(fn);
        return new FlatBufferPtr<T>(sym, this, result.data_ptr, result.data_length, result.owner_ptr, result.owner_deleter, factory);
    }

    public readStringResult(fn: (resultPtr: number) => void): string {
        const result = this.callSRet(fn);
        const dataArray = new Uint8Array(
            this.module.HEAPU8.subarray(result.data_ptr, result.data_ptr + result.data_length),
        );
        const text = this.decoder.decode(dataArray);
        // Clean up the owner
        this.instanceExports.dashql_delete_owner(result.owner_ptr, result.owner_deleter);
        return text;
    }

    public readUint32ArrayResult(fn: (resultPtr: number) => void): number[] {
        const result = this.callSRet(fn);
        try {
            const begin = result.data_ptr / Uint32Array.BYTES_PER_ELEMENT;
            return Array.from(this.module.HEAPU32.subarray(
                begin,
                begin + result.data_length / Uint32Array.BYTES_PER_ELEMENT,
            ));
        } finally {
            this.instanceExports.dashql_delete_owner(result.owner_ptr, result.owner_deleter);
        }
    }

    /// Transcode a (constrained) Vega-Lite JSON spec into a VISUALIZE statement.
    /// Returns an empty string if the JSON is malformed. The source clause is derived from the
    /// spec's `data` member (see `ParseVegaLiteToVisualize` in `vegalite_parser.cc`).
    public parseVegaLiteToVisualize(vegaLiteJson: string): string {
        const [jsonBegin, jsonLength] = this.copyString(vegaLiteJson);
        return this.readStringResult((resultPtr) =>
            this.instanceExports.dashql_parse_vegalite_to_visualize(resultPtr, jsonBegin, jsonLength),
        );
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
}

export class ParserError extends Error {
    public parsed: FlatBufferPtr<buffers.parser.ParsedScript>;
    constructor(parsed: FlatBufferPtr<buffers.parser.ParsedScript>, firstError: buffers.parser.Error) {
        super(firstError.message()!);
        this.parsed = parsed;
    }
}

export class AsyncAnalysisError extends Error {
    public readonly code: number;

    constructor(code: number, message: string) {
        super(message || `asynchronous analysis failed with error code ${code}`);
        this.name = 'AsyncAnalysisError';
        this.code = code;
    }
}

export class DashQLAgentSession {
    public readonly ptr: Ptr<typeof AGENT_SESSION_TYPE>;

    public constructor(ptr: Ptr<typeof AGENT_SESSION_TYPE>) {
        this.ptr = ptr;
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    public start(request: buffers.agent.AgentStartRequestT): buffers.agent.AgentOperationT {
        return this.callWithInput(request, (resultPtr, inputPtr, inputLength) =>
            this.ptr.api.instanceExports.dashql_agent_session_start(
                resultPtr,
                this.ptr.assertNotNull(),
                inputPtr,
                inputLength,
            )
        );
    }

    public completeEffect(completion: buffers.agent.AgentEffectCompletionT): buffers.agent.AgentOperationT {
        return this.callWithInput(completion, (resultPtr, inputPtr, inputLength) =>
            this.ptr.api.instanceExports.dashql_agent_session_complete_effect(
                resultPtr,
                this.ptr.assertNotNull(),
                inputPtr,
                inputLength,
            )
        );
    }

    public cancel(): buffers.agent.AgentOperationT {
        return this.readOperation((resultPtr) =>
            this.ptr.api.instanceExports.dashql_agent_session_cancel(resultPtr, this.ptr.assertNotNull())
        );
    }

    private callWithInput(
        input: flatbuffers.IGeneratedObject,
        invoke: (resultPtr: number, inputPtr: number, inputLength: number) => void,
    ): buffers.agent.AgentOperationT {
        const builder = new flatbuffers.Builder();
        builder.finish(input.pack(builder));
        const [inputPtr, inputLength] = this.ptr.api.copyBuffer(builder.asUint8Array());
        try {
            return this.readOperation((resultPtr) => invoke(resultPtr, inputPtr, inputLength));
        } finally {
            this.ptr.api.instanceExports.dashql_free(inputPtr);
        }
    }

    private readOperation(fn: (resultPtr: number) => void): buffers.agent.AgentOperationT {
        const result = this.ptr.api.callSRetFlatBufPtr<buffers.agent.AgentOperation, buffers.agent.AgentOperationT>(
            AGENT_OPERATION_TYPE,
            fn,
            () => new buffers.agent.AgentOperation(),
        );
        this.ptr.api.registerMemory({ type: AGENT_OPERATION_TYPE, value: result });
        return result.unpackAndDestroy();
    }
}

export class DashQLEditorSession {
    public readonly ptr: Ptr<typeof EDITOR_SESSION_TYPE>;
    public readonly catalog_entry_id: number;

    public constructor(ptr: Ptr<typeof EDITOR_SESSION_TYPE>) {
        this.ptr = ptr;
        this.catalog_entry_id = this.ptr.api.instanceExports.dashql_editor_session_get_catalog_entry_id(
            ptr.assertNotNull(),
        );
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    public getCatalogEntryId(): number {
        return this.ptr.api.instanceExports.dashql_editor_session_get_catalog_entry_id(this.ptr.assertNotNull());
    }

    public getText(): string {
        const sessionPtr = this.ptr.assertNotNull();
        return this.ptr.api.readStringResult((resultPtr) =>
            this.ptr.api.instanceExports.dashql_editor_session_get_text(resultPtr, sessionPtr)
        );
    }

    public getDocumentRevision(): bigint {
        return this.ptr.api.instanceExports.dashql_editor_session_get_document_revision(this.ptr.assertNotNull());
    }

    public getStateRevision(): bigint {
        return this.ptr.api.instanceExports.dashql_editor_session_get_state_revision(this.ptr.assertNotNull());
    }

    public getCatalogRevision(): bigint {
        return this.ptr.api.instanceExports.dashql_editor_session_get_catalog_revision(this.ptr.assertNotNull());
    }

    public replaceText(expectedDocumentRevision: bigint, text: string): buffers.editor.EditorUpdateT {
        const sessionPtr = this.ptr.assertNotNull();
        const [textBegin, textLength] = this.ptr.api.copyString(text);
        return this.readUpdate((resultPtr) =>
            this.ptr.api.instanceExports.dashql_editor_session_replace_text(
                resultPtr,
                sessionPtr,
                expectedDocumentRevision,
                textBegin,
                textLength,
            )
        );
    }

    public apply(event: buffers.editor.EditorEventT): buffers.editor.EditorUpdateT {
        const sessionPtr = this.ptr.assertNotNull();
        const builder = new flatbuffers.Builder();
        builder.finish(event.pack(builder));
        const [eventBegin, eventLength] = this.ptr.api.copyBuffer(builder.asUint8Array());
        try {
            return this.readUpdate((resultPtr) =>
                this.ptr.api.instanceExports.dashql_editor_session_apply(
                    resultPtr,
                    sessionPtr,
                    eventBegin,
                    eventLength,
                )
            );
        } finally {
            this.ptr.api.instanceExports.dashql_free(eventBegin);
        }
    }

    public setCursor(expectedDocumentRevision: bigint, offset: bigint): buffers.editor.EditorUpdateT {
        const sessionPtr = this.ptr.assertNotNull();
        return this.readUpdate((resultPtr) =>
            this.ptr.api.instanceExports.dashql_editor_session_set_primary_cursor(
                resultPtr,
                sessionPtr,
                expectedDocumentRevision,
                offset,
            )
        );
    }

    public ensureAnalysis(): buffers.editor.EditorUpdateT {
        const sessionPtr = this.ptr.assertNotNull();
        return this.readUpdate((resultPtr) =>
            this.ptr.api.instanceExports.dashql_editor_session_ensure_analysis(resultPtr, sessionPtr)
        );
    }

    public completeAtCursor(limit: number): FlatBufferPtr<buffers.completion.Completion> {
        const sessionPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.completion.Completion, buffers.completion.CompletionT>(
            COMPLETION_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_editor_session_complete_at_cursor(
                resultPtr,
                sessionPtr,
                limit,
            ),
            () => new buffers.completion.Completion(),
        );
        this.ptr.api.registerMemory({ type: COMPLETION_TYPE, value: resultBuffer });
        return resultBuffer;
    }

    public compileQuery(
        config: buffers.formatting.FormattingConfigT,
        allowExtensions: boolean = true,
        parseIfOutdated: boolean = true,
    ): FlatBufferPtr<buffers.execution.ScriptCompilationResult> {
        const sessionPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.execution.ScriptCompilationResult, buffers.execution.ScriptCompilationResultT>(
            SCRIPT_COMPILATION_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_editor_session_compile_query(
                resultPtr,
                sessionPtr,
                config.dialect,
                config.mode,
                config.maxWidth,
                config.indentationWidth,
                allowExtensions,
                parseIfOutdated,
            ),
            () => new buffers.execution.ScriptCompilationResult(),
        );
        this.ptr.api.registerMemory({ type: SCRIPT_COMPILATION_TYPE, value: resultBuffer });
        return resultBuffer;
    }

    public format(
        config: buffers.formatting.FormattingConfigT,
        catalog: DashQLCatalog | null = null,
        parseIfOutdated: boolean = true,
    ): DashQLScript {
        const sessionPtr = this.ptr.assertNotNull();
        const catalogPtr = catalog?.ptr.assertNotNull() ?? 0;
        const scriptPtr = this.ptr.api.callSRetPtr(SCRIPT_TYPE, (resultPtr) =>
            this.ptr.api.instanceExports.dashql_editor_session_format(
                resultPtr,
                sessionPtr,
                config.dialect,
                config.mode,
                config.maxWidth,
                config.indentationWidth,
                config.debugMode,
                parseIfOutdated,
                catalogPtr,
            )
        );
        const script = new DashQLScript(scriptPtr);
        this.ptr.api.registerMemory({ type: SCRIPT_TYPE, value: script.ptr });
        return script;
    }

    public isFullyFormattable(
        config: buffers.formatting.FormattingConfigT,
        parseIfOutdated: boolean = true,
    ): boolean {
        return this.ptr.api.instanceExports.dashql_editor_session_is_fully_formattable(
            this.ptr.assertNotNull(),
            config.dialect,
            config.mode,
            config.maxWidth,
            config.indentationWidth,
            config.debugMode,
            parseIfOutdated,
        ) !== 0;
    }

    public computeDiff(target: DashQLScript): FlatBufferPtr<buffers.diff.ScriptDiff> {
        const sessionPtr = this.ptr.assertNotNull();
        const targetPtr = target.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.diff.ScriptDiff, buffers.diff.ScriptDiffT>(
            SCRIPT_DIFF_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_editor_session_compute_diff(
                resultPtr,
                sessionPtr,
                targetPtr,
            ),
            () => new buffers.diff.ScriptDiff(),
        );
        this.ptr.api.registerMemory({ type: SCRIPT_DIFF_TYPE, value: resultBuffer });
        return resultBuffer;
    }

    public loadIntoCatalog(rank: number): void {
        this.ptr.api.instanceExports.dashql_editor_session_load_into_catalog(this.ptr.assertNotNull(), rank);
    }

    public dropFromCatalog(): void {
        this.ptr.api.instanceExports.dashql_editor_session_drop_from_catalog(this.ptr.assertNotNull());
    }

    private readUpdate(fn: (resultPtr: number) => void): buffers.editor.EditorUpdateT {
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.editor.EditorUpdate, buffers.editor.EditorUpdateT>(
            EDITOR_UPDATE_TYPE,
            fn,
            () => new buffers.editor.EditorUpdate(),
        );
        this.ptr.api.registerMemory({ type: EDITOR_UPDATE_TYPE, value: resultBuffer });
        return resultBuffer.unpackAndDestroy();
    }
}


export class DashQLScript {
    public readonly ptr: Ptr<typeof SCRIPT_TYPE>;
    public readonly catalog_entry_id: number;
    private asyncJobId: number | null = null;

    public constructor(ptr: Ptr<typeof SCRIPT_TYPE>) {
        this.ptr = ptr;
        this.catalog_entry_id = this.ptr.api.instanceExports.dashql_script_get_catalog_entry_id(ptr.assertNotNull());
    }
    /// Delete a graph
    public destroy() {
        if (this.asyncJobId != null) {
            this.ptr.api.instanceExports.dashql_script_analysis_job_cancel(this.asyncJobId);
            throw new Error('cannot destroy a script while asynchronous analysis is active');
        }
        this.ptr.destroy();
    }
    private assertIdle(): void {
        if (this.asyncJobId != null) {
            throw new Error('script has an active asynchronous analysis job');
        }
    }
    /// Get the script id
    public getCatalogEntryId(): number {
        this.assertIdle();
        return this.ptr.api.instanceExports.dashql_script_get_catalog_entry_id(this.ptr.assertNotNull());
    }
    /// Whether formatting can complete without unsupported-node placeholders.
    public isFullyFormattable(config: buffers.formatting.FormattingConfigT, parseIfOutdated: boolean = true): boolean {
        this.assertIdle();
        return this.ptr.api.instanceExports.dashql_script_is_fully_formattable(
            this.ptr.assertNotNull(),
            config.dialect,
            config.mode,
            config.maxWidth,
            config.indentationWidth,
            config.debugMode,
            parseIfOutdated,
        ) !== 0;
    }
    /// AST node ids that prevent formatting.
    public getUnformattableNodes(config: buffers.formatting.FormattingConfigT, parseIfOutdated: boolean = true): number[] {
        this.assertIdle();
        return this.ptr.api.readUint32ArrayResult((resultPtr) =>
            this.ptr.api.instanceExports.dashql_script_get_unformattable_nodes(
                resultPtr,
                this.ptr.assertNotNull(),
                config.dialect,
                config.mode,
                config.maxWidth,
                config.indentationWidth,
                config.debugMode,
                parseIfOutdated,
            )
        );
    }
    /// Insert text at an offset
    public insertTextAt(offset: number, text: string) {
        this.assertIdle();
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
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_script_erase_text_range(scriptPtr, offset, length);
    }
    /// Replace the text text
    public replaceText(text: string) {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        const [textBegin, textLength] = this.ptr.api.copyString(text);
        this.ptr.api.instanceExports.dashql_script_replace_text(scriptPtr, textBegin, textLength);
    }
    /// Convert the script, or a UTF-8 byte range of it, to a string.
    public toString(offset?: number, length?: number): string {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        return this.ptr.api.readStringResult((resultPtr) =>
            this.ptr.api.instanceExports.dashql_script_to_string(
                resultPtr,
                scriptPtr,
                offset ?? 0,
                length ?? 0,
            )
        );
    }
    /// Return the first parsed statement without its separator or surrounding trivia.
    public getStatementText(parseIfOutdated: boolean = true): string {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        return this.ptr.api.readStringResult((resultPtr) =>
            this.ptr.api.instanceExports.dashql_script_get_statement_text(
                resultPtr,
                scriptPtr,
                parseIfOutdated,
            )
        );
    }
    /// Compile the script into an executable query.
    public compileQuery(
        config: buffers.formatting.FormattingConfigT,
        allowExtensions: boolean = true,
        parseIfOutdated: boolean = true,
    ): FlatBufferPtr<buffers.execution.ScriptCompilationResult> {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.execution.ScriptCompilationResult, buffers.execution.ScriptCompilationResultT>(
            SCRIPT_COMPILATION_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_compile_query(
                resultPtr,
                scriptPtr,
                config.dialect,
                config.mode,
                config.maxWidth,
                config.indentationWidth,
                allowExtensions,
                parseIfOutdated,
            ),
            () => new buffers.execution.ScriptCompilationResult(),
        );
        this.ptr.api.registerMemory({ type: SCRIPT_COMPILATION_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Parse the script (throws exception on error)
    public parse() {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_script_parse(scriptPtr);
    }
    /// Analyze the script (throws exception on error)
    public analyze(parseIfOutdated: boolean = true) {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        this.ptr.api.instanceExports.dashql_script_analyze(scriptPtr, parseIfOutdated);
    }
    /// Analyze without blocking the caller when the module has native Wasm threads.
    public async analyzeAsync(parseIfOutdated: boolean = true): Promise<void> {
        this.assertIdle();
        const api = this.ptr.api;
        const jobId = api.instanceExports.dashql_script_analyze_async(this.ptr.assertNotNull(), parseIfOutdated);
        this.asyncJobId = jobId;
        try {
            await api.waitForAsyncAnalysisJob(jobId);
        } finally {
            api.instanceExports.dashql_script_analysis_job_release(jobId);
            this.asyncJobId = null;
        }
    }
    /// Get the parsed script
    public getParsed(): FlatBufferPtr<buffers.parser.ParsedScript> {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.parser.ParsedScript, buffers.parser.ParsedScriptT>(
            PARSED_SCRIPT_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_get_parsed(resultPtr, scriptPtr),
            () => new buffers.parser.ParsedScript()
        );
        this.ptr.api.registerMemory({ type: PARSED_SCRIPT_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Get the analyzed script
    public getAnalyzed(): FlatBufferPtr<buffers.analyzer.AnalyzedScript> {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.analyzer.AnalyzedScript, buffers.analyzer.AnalyzedScriptT>(
            ANALYZED_SCRIPT_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_get_analyzed(resultPtr, scriptPtr),
            () => new buffers.analyzer.AnalyzedScript()
        );
        this.ptr.api.registerMemory({ type: ANALYZED_SCRIPT_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Compute a statement-level semantic diff from this (source/old) script to another (target/new) script
    public computeDiff(target: DashQLScript): FlatBufferPtr<buffers.diff.ScriptDiff> {
        this.assertIdle();
        target.assertIdle();
        const sourcePtr = this.ptr.assertNotNull();
        const targetPtr = target.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.diff.ScriptDiff, buffers.diff.ScriptDiffT>(
            SCRIPT_DIFF_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_compute_diff(resultPtr, sourcePtr, targetPtr),
            () => new buffers.diff.ScriptDiff()
        );
        this.ptr.api.registerMemory({ type: SCRIPT_DIFF_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Move the cursor
    public moveCursor(textOffset: number): FlatBufferPtr<buffers.cursor.ScriptCursor> {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.cursor.ScriptCursor, buffers.cursor.ScriptCursorT>(
            CURSOR_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_move_cursor(resultPtr, scriptPtr, textOffset),
            () => new buffers.cursor.ScriptCursor()
        );
        this.ptr.api.registerMemory({ type: CURSOR_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Complete at the cursor
    public completeAtCursor(limit: number): FlatBufferPtr<buffers.completion.Completion> {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.completion.Completion, buffers.completion.CompletionT>(
            COMPLETION_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_complete_at_cursor(resultPtr, scriptPtr, limit),
            () => new buffers.completion.Completion()
        );
        this.ptr.api.registerMemory({ type: COMPLETION_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Try to complete at cursor
    public tryCompleteAtCursor(limit: number): FlatBufferPtr<buffers.completion.Completion> | null {
        try {
            return this.completeAtCursor(limit);
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
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.statistics.ScriptStatistics, buffers.statistics.ScriptStatisticsT>(
            SCRIPT_STATISTICS_TYPE,
            (resultPtr) => this.ptr.api.instanceExports.dashql_script_get_statistics(resultPtr, scriptPtr),
            () => new buffers.statistics.ScriptStatistics()
        );
        this.ptr.api.registerMemory({ type: SCRIPT_STATISTICS_TYPE, value: resultBuffer });
        return resultBuffer;
    }
    /// Format the script
    public format(
        config: buffers.formatting.FormattingConfigT,
        catalog: DashQLCatalog | null = null,
        parseIfOutdated: boolean = true,
    ): DashQLScript {
        this.assertIdle();
        const scriptPtr = this.ptr.assertNotNull();
        const catalogPtr = catalog?.ptr.assertNotNull() ?? 0;
        const newScriptPtr = this.ptr.api.callSRetPtr(SCRIPT_TYPE, (resultPtr) =>
            this.ptr.api.instanceExports.dashql_script_format(
                resultPtr,
                scriptPtr,
                config.dialect,
                config.mode,
                config.maxWidth,
                config.indentationWidth,
                config.debugMode,
                parseIfOutdated,
                catalogPtr)
        );
        const script = new DashQLScript(newScriptPtr);
        this.ptr.api.registerMemory({ type: SCRIPT_TYPE, value: script.ptr });
        return script;

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
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.catalog.CatalogEntries>(
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
        const resultBuffer = this.ptr.api.callSRetFlatBufPtr<buffers.catalog.CatalogEntries>(
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
        const snapshot = this.ptr.api.callSRetFlatBufPtr<buffers.catalog.FlatCatalog>(
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
    /// Atomically add or replace ranked scripts in the catalog.
    public loadScripts(scripts: ReadonlyArray<readonly [DashQLScript, number]>): void {
        if (scripts.length === 0) {
            return;
        }
        const stack = this.ptr.api.module.stackSave();
        try {
            const scriptPtrs = this.ptr.api.module.stackAlloc(scripts.length * 4);
            const ranks = this.ptr.api.module.stackAlloc(scripts.length * 4);
            const scriptHeap = this.ptr.api.module.HEAPU32.subarray(scriptPtrs / 4, scriptPtrs / 4 + scripts.length);
            const rankHeap = this.ptr.api.module.HEAPU32.subarray(ranks / 4, ranks / 4 + scripts.length);
            for (let i = 0; i < scripts.length; ++i) {
                scriptHeap[i] = scripts[i][0].ptr.assertNotNull();
                rankHeap[i] = scripts[i][1];
            }
            this.ptr.api.instanceExports.dashql_catalog_load_scripts(
                this.ptr.assertNotNull(), scriptPtrs, ranks, scripts.length
            );
            this.deleteSnapshot();
        } finally {
            this.ptr.api.module.stackRestore(stack);
        }
    }
    /// Update a script from the registry
    public dropScript(script: DashQLScript) {
        this.deleteSnapshot();
        this.ptr.api.instanceExports.dashql_catalog_drop_script(this.ptr.assertNotNull(), script.ptr.assertNotNull());
    }
    /// Get the catalog statistics.
    public getStatistics(): FlatBufferPtr<buffers.catalog.CatalogStatistics, buffers.catalog.CatalogStatisticsT> {
        const catalogPtr = this.ptr.assertNotNull();
        const resultPtr = this.ptr.api.callSRetFlatBufPtr<buffers.catalog.CatalogStatistics>(
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
        const resultPtr = this.ptr.api.callSRetFlatBufPtr<buffers.view.PlanViewModel>(
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
