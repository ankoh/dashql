import { DashQL, buffers, type DashQLBindings, type DashQLModuleOptions } from '@akohn/dashql';
import * as publicBuffers from '@akohn/dashql/buffers';
import * as glue from '@akohn/dashql/wasm/glue';
import {
    createBatchWorker,
    DashQLBatchWorker,
    type BatchWorkerRequest,
    type BatchWorkerResponse,
    type BatchRequest,
    type BatchResult,
    type BatchScriptInput,
    type BatchScriptResult,
    type BatchDiagnostic,
    type BatchOutput,
} from '@akohn/dashql/browser-worker';

const output: BatchOutput = 'analyzed';
const script: BatchScriptInput = { id: 'query', text: 'select 1', outputs: [output] };
const request: BatchRequest = { scripts: [script] };
const message: BatchWorkerRequest = { requestId: 1, request };
const diagnostic: BatchDiagnostic = { stage: 'analyze', severity: 'warning', offset: 0, length: 1, message: 'test' };
const scriptResult: BatchScriptResult = { id: script.id, diagnostics: [diagnostic] };
const result: BatchResult = { scripts: [scriptResult] };
const response: BatchWorkerResponse = { requestId: message.requestId, result };
const options: DashQLModuleOptions = {
    wasmBinary: new Uint8Array(),
    module: new WebAssembly.Module(new Uint8Array()),
};
await glue.default({ module_or_path: options.module! });
const bindings: DashQLBindings = { ...glue };
const core: DashQL = new DashQL(bindings);
const parsed: publicBuffers.parser.ParsedScript = new buffers.parser.ParsedScript();
const worker: DashQLBatchWorker = createBatchWorker();
const pending: Promise<BatchResult> = worker.processBatch(request);
void [response, core, parsed, pending];

// The fixture must not accidentally acquire lib.dom through declarations.
// @ts-expect-error Document is a DOM-only type, unavailable in this consumer.
type _NoDOM = Document;
