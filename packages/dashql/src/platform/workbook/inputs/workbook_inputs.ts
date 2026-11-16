import * as core from '../../../core/index.js';


const SqlTypeKind = core.buffers.analyzer.SqlTypeKind;

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

/// The inputs that the runtime collected from the scripts of a workbook, the consumers by the keys of the scripts in
/// the order of the request
export function readSessionInputs(collected: core.buffers.execution.SessionInputsT, scriptKeys: readonly number[]): SessionInput[] {
    return collected.inputs.map(input => ({
        name: String(input.name ?? ''),
        type: readWorkbookInputType(input.sqlType, input.typeSource),
        value: input.hasValue ? String(input.value ?? '') : null,
        literal: input.hasValue ? String(input.literal ?? '') : null,
        consumers: input.consumers.flatMap(c => {
            const scriptKey = scriptKeys[c.script];
            return scriptKey == null ? [] : [{ scriptKey, statementId: c.statement }];
        }),
        warnings: input.warnings.map(String),
    }));
}

/// The inputs of the draft of a composer, a script session that is no workbook script: nothing consumes them yet
export function collectDraftInputs(instance: core.DashQL, draft: core.DashQLScriptSession, catalog: core.DashQLCatalog): SessionInput[] {
    try {
        const request = {
            connections: [{ id: 'draft', local: false, catalog }],
            scripts: [{ name: 'draft', connection: 0, session: draft }],
        };
        return readSessionInputs(instance.collectSessionInputs(request).unpack() as core.buffers.execution.SessionInputsT, []);
    } catch (e) {
        console.warn('cannot collect the inputs of the draft', e);
        return NO_INPUTS;
    }
}

/// The scripts that use an input, without duplicates
export function inputConsumerScripts(input: SessionInput): number[] {
    return [...new Set(input.consumers.map(c => c.scriptKey))];
}

export function sameInputs(l: SessionInput[], r: SessionInput[]): boolean {
    return JSON.stringify(l) === JSON.stringify(r);
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
