import * as core from '@ankoh/dashql-core';

import { scriptDisplayName } from '../scripts/script_types.js';
import { formattingDialectForConnector } from '../scripts/script_format.js';
import { attachmentPrefix, planAttachments } from '../attachments/workbook_attachments.js';
import { orderedWorkbookScripts, workbookAnalysisSignature, type ScriptData, type WorkbookScripts } from '../scripts/workbook_scripts.js';

const SqlTypeKind = core.buffers.analyzer.SqlTypeKind;
const EdgeKind = core.buffers.execution.DataflowEdgeKind;

/// The control that edits the value of an input, from its type
export enum WorkbookInputControl {
    Number = 'number',
    Integer = 'integer',
    Boolean = 'boolean',
    Date = 'date',
    Timestamp = 'timestamp',
    Interval = 'interval',
    Text = 'text',
}

/// The type of an input, of a cast of the parameter or of the literal of its value
export interface WorkbookInputType {
    kind: core.buffers.analyzer.SqlTypeKind;
    /// The SQL text of the type, e.g. `numeric(10,2)`
    sql: string;
    arrayDimensions: number;
    withTimeZone: boolean;
    /// Is the type the type of a cast? The type of a literal follows the value.
    cast: boolean;
    /// Is the type known? An input without a cast and without a value is text until it has one.
    known: boolean;
}

/// A statement that uses an input
export interface SessionInputConsumer {
    scriptKey: number;
    statementId: number;
}

/// An input of a workbook: a named scalar parameter of its scripts, see docs/design/workbook_inputs.md
export interface SessionInput {
    name: string;
    type: WorkbookInputType;
    /// The value as a control shows it, null if no script has a value: the number, the content of a string, the text of
    /// a typed literal
    value: string | null;
    /// The value as SQL literal in the Hyper dialect, the value of the `@param` tags
    literal: string | null;
    /// The statements that use the input, in workbook order
    consumers: SessionInputConsumer[];
    /// The problems of the input, e.g. casts to different types
    warnings: string[];
}

const NO_INPUTS: SessionInput[] = [];

/// The request of the core for the scripts of a workbook, connections in the order of their first script. A
/// connection speaks the dialect of its connector, the planner prints the values of inputs in it. With the workbook,
/// the request holds its attachments and the directory the embedded Hyper mounts them in.
export function workbookPlanRequest(
    scripts: readonly ScriptData[],
    files: readonly string[],
    workbook?: Pick<WorkbookScripts, 'workbookId' | 'attachments'>,
): core.SessionPlanRequest {
    const connections: ScriptData['connection'][] = [];
    for (const script of scripts) {
        if (connections.some(c => c.connectionId === script.connection.connectionId)) continue;
        connections.push(script.connection);
    }
    const connectionIds = connections.map(c => c.connectionId);
    return {
        connections: connections.map(c => ({
            id: c.connectionId,
            local: c.local ?? false,
            catalog: c.catalog,
            dialect: formattingDialectForConnector(c.connectorInfo?.connectorType),
            defaults: c.catalogNameDefaults,
        })),
        scripts: scripts.map((script, index) => ({
            name: scriptDisplayName(files[index]),
            connection: connectionIds.indexOf(script.connection.connectionId),
            session: script.scriptSession,
        })),
        attachments: planAttachments(workbook?.attachments),
        attachmentPrefix: workbook == null ? undefined : attachmentPrefix(workbook.workbookId),
    };
}

/// The type of an input of the core
export function readWorkbookInputType(type: core.buffers.analyzer.SqlTypeT | null, source: core.buffers.execution.SessionInputTypeSource): WorkbookInputType {
    return {
        kind: type?.kind ?? SqlTypeKind.TEXT,
        sql: String(type?.sql ?? 'text'),
        arrayDimensions: type?.arrayDimensions ?? 0,
        withTimeZone: type?.withTimeZone ?? false,
        cast: source === core.buffers.execution.SessionInputTypeSource.CAST,
        known: source !== core.buffers.execution.SessionInputTypeSource.NONE,
    };
}

/// Collect the inputs of a plan request with the core, `scripts` are the scripts of the request that have a key
function readWorkbookInputs(instance: core.DashQL, request: core.SessionPlanRequest, scripts: readonly Pick<ScriptData, 'scriptKey'>[]): SessionInput[] {
    const collected = instance.collectSessionInputs(request).unpack() as core.buffers.execution.SessionInputsT;
    return collected.inputs.map(input => ({
        name: String(input.name ?? ''),
        type: readWorkbookInputType(input.sqlType, input.typeSource),
        value: input.hasValue ? String(input.value ?? '') : null,
        literal: input.hasValue ? String(input.literal ?? '') : null,
        consumers: input.consumers.flatMap(c => {
            const script = scripts[c.script];
            return script == null ? [] : [{ scriptKey: script.scriptKey, statementId: c.statement }];
        }),
        warnings: input.warnings.map(String),
    }));
}

/// Collect the inputs of a workbook with the core
function collectSessionInputs(workbook: WorkbookScripts): SessionInput[] {
    const scripts = orderedWorkbookScripts(workbook);
    if (scripts.length === 0 || typeof workbook.instance?.collectSessionInputs !== 'function') return NO_INPUTS;
    return readWorkbookInputs(workbook.instance, workbookPlanRequest(scripts, scripts.map(s => s.fileName), workbook), scripts);
}

/// The inputs of the draft of a composer, a script session that is no workbook script: nothing consumes them yet
export function collectDraftInputs(instance: core.DashQL, draft: core.DashQLScriptSession, catalog: core.DashQLCatalog): SessionInput[] {
    try {
        return readWorkbookInputs(instance, {
            connections: [{ id: 'draft', local: false, catalog }],
            scripts: [{ name: 'draft', connection: 0, session: draft }],
        }, []);
    } catch (e) {
        console.warn('cannot collect the inputs of the draft', e);
        return NO_INPUTS;
    }
}

/// The scripts that use an input, without duplicates
export function inputConsumerScripts(input: SessionInput): number[] {
    return [...new Set(input.consumers.map(c => c.scriptKey))];
}

interface CachedInputs {
    signature: string;
    inputs: SessionInput[];
}

/// The last inputs of every workbook, by workbook id
const INPUTS = new Map<string, CachedInputs>();

export function sameInputs(l: SessionInput[], r: SessionInput[]): boolean {
    return JSON.stringify(l) === JSON.stringify(r);
}

/// The inputs of a workbook, collected again when a script or its analysis changed. A script that is being edited
/// keeps the inputs of its last analysis: an input stays while its analysis lags behind its text.
export function deriveWorkbookInputs(workbook: WorkbookScripts): SessionInput[] {
    // Workbooks without the core, e.g. of tests, have no inputs
    if (workbook.scriptOrder == null || workbook.scriptOrder.length === 0 || typeof workbook.instance?.collectSessionInputs !== 'function') return NO_INPUTS;
    const signature = workbookAnalysisSignature(workbook);
    const cached = INPUTS.get(workbook.workbookId);
    if (cached?.signature === signature) return cached.inputs;
    let inputs: SessionInput[];
    try {
        inputs = collectSessionInputs(workbook);
    } catch (e) {
        console.warn('cannot collect the inputs of the workbook', e);
        return cached?.inputs ?? NO_INPUTS;
    }
    if (cached != null && sameInputs(cached.inputs, inputs)) inputs = cached.inputs;
    INPUTS.set(workbook.workbookId, { signature, inputs });
    return inputs;
}

/// The control of the value of an input
export function workbookInputControl(type: WorkbookInputType): WorkbookInputControl {
    if (type.arrayDimensions > 0) return WorkbookInputControl.Text;
    switch (type.kind) {
        case SqlTypeKind.INT1:
        case SqlTypeKind.INT2:
        case SqlTypeKind.INT4:
        case SqlTypeKind.INT8:
            return type.cast ? WorkbookInputControl.Integer : WorkbookInputControl.Number;
        case SqlTypeKind.INTERVAL:
            return WorkbookInputControl.Interval;
        case SqlTypeKind.FLOAT4:
        case SqlTypeKind.FLOAT8:
        case SqlTypeKind.NUMERIC:
            return WorkbookInputControl.Number;
        case SqlTypeKind.BOOL:
            return WorkbookInputControl.Boolean;
        case SqlTypeKind.DATE:
            return WorkbookInputControl.Date;
        case SqlTypeKind.TIMESTAMP:
            return WorkbookInputControl.Timestamp;
        default:
            return WorkbookInputControl.Text;
    }
}

/// The literal of the value of a control in the Hyper dialect, the value of the `@param` tags, or the problem with the
/// value. The type of the input decides what the value is (`SqlLiteral::from_value` of the core), an input whose type
/// is unknown reads a number, `true`, `false` or a string.
export function workbookInputLiteral(instance: core.DashQL, type: WorkbookInputType, value: string): { literal: string } | { error: string } {
    if (value.trim().length === 0) return { error: 'The input has no value' };
    try {
        return { literal: instance.inputLiteral(value, type.known ? type.sql : null) };
    } catch (e: any) {
        return { error: String(e?.message ?? e) };
    }
}

/// The scripts that an input change reruns: the scripts that use one of the inputs and every script downstream of
/// them, by the references and relation edges of the dataflow. A script that runs only on request (`@manual`) is left
/// out, the scripts downstream of it are not. Indexes the scripts of the dataflow.
export function affectedScriptIndices(dataflow: core.buffers.execution.SessionDataflowT, inputs: readonly string[]): number[] {
    const names = new Set(inputs);
    const affected = new Set<number>();
    const pending: number[] = [];
    for (const edge of dataflow.edges) {
        if (edge.kind !== EdgeKind.INPUT) continue;
        const input = dataflow.inputs[edge.fromScript];
        if (input == null || !names.has(String(input.name ?? ''))) continue;
        if (!affected.has(edge.toScript)) {
            affected.add(edge.toScript);
            pending.push(edge.toScript);
        }
    }
    while (pending.length > 0) {
        const script = pending.pop()!;
        for (const edge of dataflow.edges) {
            if (edge.kind === EdgeKind.INPUT || edge.kind === EdgeKind.INVALID_REFERENCE || edge.fromScript !== script) continue;
            if (!affected.has(edge.toScript)) {
                affected.add(edge.toScript);
                pending.push(edge.toScript);
            }
        }
    }
    return [...affected].filter(script => !dataflow.scripts[script]?.manual).sort((l, r) => l - r);
}
