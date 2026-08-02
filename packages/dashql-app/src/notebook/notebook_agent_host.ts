import * as core from '../core/index.js';

import { AgentHost, AgentApplyPlan } from '../agent/agent_host.js';
import { AgentIntent } from '../agent/agent_prompts.js';
import { verifyScript, VerifyResult } from '../agent/agent_verify.js';
import {
    buildAgentContext,
    buildStatementDescriptionContexts,
    AgentContextContributor,
    OutputColumnResolver,
} from './notebook_agent_context.js';
import {
    CREATE_NOTEBOOK_ENTRY_WITH_TEXT,
    NotebookState,
    NotebookStateAction,
    REGISTER_AGENT_RUN,
    ScriptData,
    SET_SCRIPT_TEXT,
} from './notebook_state.js';
import { resolveSymbolSpan } from '../core/tokens.js';
import { normalizePageName, scriptDisplayName } from './notebook_types.js';

/// The source clause for the generated VISUALIZE statement.
///
/// The actual transcoding lives in the WASM core (`ParseVegaLiteToVisualize`); we encode the
/// source into the Vega-Lite spec's `data` member (see `visSourceToData`) and let the core
/// derive the `VISUALIZE <source> USING vegalite (…)` clause. This keeps a single transcoder.
export type VisSource =
    /// Reference an existing notebook script by `(folder, file)`.
    /// Encoded as `dashql.notebook."<folder>/<file>"`.
    | { kind: 'script-reference'; folderName: string; fileName: string }
    /// Reference a catalog table / relation by (optionally qualified) name.
    | { kind: 'table-reference'; database?: string | null; schema?: string | null; table: string }
    /// Inline SELECT subquery, emitted verbatim inside parentheses.
    | { kind: 'inline-select'; sql: string }
    /// Reuse a source clause extracted verbatim from an existing VISUALIZE statement.
    | { kind: 'raw'; text: string }
    /// No source clause (`VISUALIZE USING vegalite (…)`).
    | { kind: 'none' };

/// Encode a VisSource into the `data` member that the WASM transcoder understands.
/// Returns null for `none` (no `data` member is injected).
export function visSourceToData(source: VisSource): Record<string, unknown> | null {
    switch (source.kind) {
        case 'none':
            return null;
        case 'raw':
            return source.text.trim() ? { $raw: source.text.trim() } : null;
        case 'inline-select':
            return source.sql.trim() ? { $sql: source.sql.trim() } : null;
        case 'script-reference':
            return { $ref: ['dashql', 'notebook', `${source.folderName}/${source.fileName}`] };
        case 'table-reference': {
            const ref: string[] = [];
            if (source.database) ref.push(source.database);
            if (source.schema) ref.push(source.schema);
            ref.push(source.table);
            return { $ref: ref };
        }
    }
}

/// The parameters of the notebook agent host: everything a run needs to read + write a notebook.
export interface NotebookAgentHostParams {
    /// The notebook state (read once at run start).
    notebook: NotebookState;
    /// The focused script key: the context + default in-place target (null if nothing focused).
    contextScriptKey: number | null;
    /// Apply a result — and register the run — against the notebook.
    modifyNotebook: (action: NotebookStateAction) => void;
    /// Resolve a script's last-execution output columns (for the visualize context). Optional so
    /// callers without connection state in scope can omit it.
    resolveOutputColumns?: OutputColumnResolver;
    /// Optional context-contributor override (defaults to the standard chain).
    contributors?: AgentContextContributor[];
}

/// Build an `AgentHost` backed by a notebook. This is the notebook's adapter over the generic
/// agent run driver: it closes over the focused script + the notebook dispatch so the driver's
/// methods stay domain-free. All notebook knowledge (context contributors, VISUALIZE source
/// resolution + transcode, apply-action selection, run registration) lives here.
export function createNotebookAgentHost(params: NotebookAgentHostParams): AgentHost {
    const { notebook, contextScriptKey, modifyNotebook, resolveOutputColumns, contributors } = params;
    // Resolve the focused script once — every method reasons about the same context.
    const contextScriptData: ScriptData | null = contextScriptKey != null
        ? notebook.scripts[contextScriptKey] ?? null
        : null;
    let descriptionTemplate: StatementDescriptionTemplate | null = null;

    return {
        buildContext(intent: AgentIntent): string {
            return buildAgentContext(
                { notebook, contextScriptData, intent, resolveOutputColumns },
                contributors,
            );
        },

        descriptionContexts(): string[] {
            return buildStatementDescriptionContexts({
                notebook,
                contextScriptData,
                intent: 'describe',
                resolveOutputColumns,
            });
        },

        isEditingChart(): boolean {
            return focusedIsVisualize(contextScriptData);
        },

        transcodeVegaLite(rawSpecJson: string): string {
            // Parsed as a loose record: we only re-serialize it for the WASM transcoder, which does
            // the real work, so the strict TopLevelSpec type adds no safety and its narrow `data`
            // union rejects our `$ref`/`$sql` source records. Throws on malformed JSON, which the
            // driver treats as a verifiable error and repairs.
            const spec = JSON.parse(rawSpecJson) as Record<string, unknown>;
            // Inject the resolved source as the spec's `data` member; the WASM transcoder turns it
            // into the `VISUALIZE <source> USING vegalite (…)` clause. The model is told not to emit `data`, but
            // overwrite it defensively so our source always wins.
            const data = visSourceToData(determineVisSource(notebook, contextScriptData));
            if (data != null) {
                spec.data = data;
            } else {
                delete spec.data;
            }
            return notebook.instance.parseVegaLiteToVisualize(JSON.stringify(spec));
        },

        applyDescriptions(descriptions: string[], expectedSource: string): string {
            if (contextScriptData == null) {
                throw new Error('Statement descriptions require a focused script.');
            }
            if (contextScriptData.script.toString() !== expectedSource) {
                throw new Error('The script changed while descriptions were being generated. Run the action again.');
            }
            descriptionTemplate ??= captureStatementDescriptionTemplate(contextScriptData);
            return applyStatementDescriptionTemplate(descriptionTemplate, descriptions);
        },

        descriptionSource(): string {
            if (contextScriptData == null) return '';
            descriptionTemplate ??= captureStatementDescriptionTemplate(contextScriptData);
            return descriptionTemplate.source;
        },

        verify(candidateText: string): VerifyResult {
            return verifyScript(notebook.instance, notebook.connectionCatalog, candidateText);
        },

        planApply(intent: AgentIntent, candidateText: string): AgentApplyPlan {
            const action = chooseApplyAction(intent, contextScriptData, candidateText);
            const inPlace = action.type === SET_SCRIPT_TEXT;
            const targetName = contextScriptData != null ? scriptDisplayName(contextScriptData.fileName) : null;
            return {
                inPlace,
                targetName,
                commit: () => modifyNotebook(action),
            };
        },

        registerRun(runId: number): void {
            // A run with no context script has nothing to attach to (the guard also lives in the
            // driver, but keep it here too so the host is correct in isolation).
            if (contextScriptKey == null) return;
            modifyNotebook({ type: REGISTER_AGENT_RUN, value: [contextScriptKey, runId] });
        },
    };
}

/// Is the focused script a VISUALIZE statement? Derived from the cached annotation.
function focusedIsVisualize(contextScriptData: ScriptData | null): boolean {
    return contextScriptData?.annotations.visualizeQuery != null;
}

/// Choose the notebook action that applies the verified candidate.
///
/// | intent    | focused                | action                          |
/// |-----------|------------------------|---------------------------------|
/// | sql       | any focused script     | SET_SCRIPT_TEXT in place         |
/// | sql       | none focused           | CREATE_NOTEBOOK_ENTRY_WITH_TEXT  |
/// | visualize | focused is VISUALIZE   | SET_SCRIPT_TEXT in place         |
/// | visualize | focused is SQL / none  | CREATE_NOTEBOOK_ENTRY_WITH_TEXT  |
export function chooseApplyAction(
    intent: AgentIntent,
    contextScriptData: ScriptData | null,
    text: string,
): NotebookStateAction {
    if (intent === 'sql' || intent === 'describe') {
        if (contextScriptData != null) {
            // In-place rewrite of an existing script: stage it as a diff (withDiff) so the editor
            // shows an accept/reject overlay instead of silently replacing the text.
            return { type: SET_SCRIPT_TEXT, value: { scriptKey: contextScriptData.scriptKey, text, withDiff: true } };
        }
        return { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text } };
    }
    // visualize
    if (focusedIsVisualize(contextScriptData)) {
        return { type: SET_SCRIPT_TEXT, value: { scriptKey: contextScriptData!.scriptKey, text, withDiff: true } };
    }
    return { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text } };
}

interface DescriptionEdit {
    begin: number;
    end: number;
    prefix: string;
    indent: string;
}

interface StatementDescriptionTemplate {
    source: string;
    sourceBytes: Uint8Array;
    lineBreak: string;
    edits: DescriptionEdit[];
}

const DESCRIPTION_COMMENT_WIDTH = 80;

function descriptionNeedsLeadingLineBreak(source: Uint8Array, offset: number): boolean {
    for (let i = offset - 1; i >= 0; --i) {
        const byte = source[i];
        if (byte === 10 || byte === 13) return false;
        if (byte !== 9 && byte !== 12 && byte !== 32) return true;
    }
    return false;
}

function detectLineBreak(source: string): string {
    return source.includes('\r\n') ? '\r\n' : '\n';
}

function indentWidth(indent: string): number {
    let width = 0;
    for (const char of indent) width += char === '\t' ? 4 : 1;
    return width;
}

/// Wrap generated prose into readable SQL comment lines. The width includes indentation and the
/// `-- ` prefix, matching the formatter's default 80-column width. Explicit model line breaks are
/// retained as paragraph boundaries rather than being flattened into one long line.
function wrapDescription(description: string, indent: string): string[] {
    const contentWidth = Math.max(20, DESCRIPTION_COMMENT_WIDTH - indentWidth(indent) - 3);
    const output: string[] = [];
    for (const paragraph of description.split('\n')) {
        const words = paragraph.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) {
            output.push('');
            continue;
        }
        let line = words[0];
        for (let i = 1; i < words.length; ++i) {
            if (line.length + 1 + words[i].length <= contentWidth) {
                line += ` ${words[i]}`;
            } else {
                output.push(line);
                line = words[i];
            }
        }
        output.push(line);
    }
    return output;
}

function leadingIndent(source: Uint8Array, offset: number): string {
    let begin = offset;
    while (begin > 0 && source[begin - 1] !== 10 && source[begin - 1] !== 13) --begin;
    const prefix = source.subarray(begin, offset);
    for (const byte of prefix) {
        if (byte !== 9 && byte !== 32) return '';
    }
    return new TextDecoder().decode(prefix);
}

function captureStatementDescriptionTemplate(scriptData: ScriptData): StatementDescriptionTemplate {
    const parsedPtr = scriptData.scriptAnalysis.buffers.parsed;
    if (parsedPtr == null) {
        throw new Error('The script must parse before descriptions can be generated.');
    }
    const source = scriptData.script.toString();
    const sourceBytes = new TextEncoder().encode(source);
    const parsed = parsedPtr.read();
    const statementCount = parsed.statementsLength();
    if (statementCount === 0) {
        throw new Error('The script has no statements to describe.');
    }
    const statement = new core.buffers.parser.Statement();
    const statementSpan = new core.buffers.parser.TextSpan();
    const commentSpan = new core.buffers.parser.TextSpan();
    const edits: DescriptionEdit[] = [];
    for (let i = 0; i < statementCount; ++i) {
        const current = parsed.statements(i, statement);
        const currentSpan = current?.statementSpan(statementSpan);
        if (current == null || currentSpan == null) {
            throw new Error(`Statement ${i + 1} has no source span.`);
        }

        let begin = currentSpan.offset();
        if (current.descriptionCount() > 0) {
            const firstComment = parsed.comments(current.descriptionBegin(), commentSpan);
            if (firstComment == null) throw new Error(`Statement ${i + 1} has invalid description metadata.`);
            begin = firstComment.offset();
        }
        const indent = leadingIndent(sourceBytes, currentSpan.offset());
        const prefix = descriptionNeedsLeadingLineBreak(sourceBytes, begin) ? detectLineBreak(source) : '';
        edits.push({ begin, end: currentSpan.offset(), prefix, indent });
    }
    return { source, sourceBytes, lineBreak: detectLineBreak(source), edits };
}

function applyStatementDescriptionTemplate(template: StatementDescriptionTemplate, descriptions: string[]): string {
    if (descriptions.length !== template.edits.length) {
        throw new Error(`Expected ${template.edits.length} descriptions, but the model returned ${descriptions.length}.`);
    }
    let output = template.sourceBytes;
    const encoder = new TextEncoder();
    for (let i = template.edits.length - 1; i >= 0; --i) {
        const edit = template.edits[i];
        const description = descriptions[i].replace(/\r\n?/g, '\n').trim();
        if (description.length === 0) throw new Error(`Description ${i + 1} is empty.`);
        const commentText = wrapDescription(description, edit.indent)
            .map(line => `${line.length > 0 ? `-- ${line}` : '--'}`)
            .join(`${template.lineBreak}${edit.indent}`);
        const replacement = encoder.encode(`${edit.prefix}${commentText}${template.lineBreak}${edit.indent}`);
        const next = new Uint8Array(edit.begin + replacement.length + output.length - edit.end);
        next.set(output.subarray(0, edit.begin));
        next.set(replacement, edit.begin);
        next.set(output.subarray(edit.end), edit.begin + replacement.length);
        output = next;
    }
    return new TextDecoder().decode(output);
}

/// Apply one generated description to every parsed statement. FlatBuffer spans are UTF-8 byte
/// offsets, so edits operate on encoded bytes and decode once at the end; this also preserves all
/// SQL and non-description whitespace exactly, including non-ASCII source before later statements.
export function applyStatementDescriptions(scriptData: ScriptData, descriptions: string[]): string {
    return applyStatementDescriptionTemplate(captureStatementDescriptionTemplate(scriptData), descriptions);
}

/// Determine the VISUALIZE source clause for a visualize run.
///
/// - If the focused script is already a VISUALIZE statement, reuse its resolved source so an
///   in-place edit keeps pointing at the same data.
/// - Otherwise (focused is a SQL script) reference that script by its notebook path.
/// - If nothing usable is focused, fall back to no source (the verify pass will flag it).
export function determineVisSource(notebook: NotebookState, contextScriptData: ScriptData | null): VisSource {
    if (contextScriptData == null) {
        return { kind: 'none' };
    }
    if (focusedIsVisualize(contextScriptData)) {
        const reused = extractVisSourceFromScript(contextScriptData);
        if (reused != null) return reused;
    }
    // Reference the focused SQL script by its notebook path. Use the clean display names (folder
    // without its ordering prefix, file without prefix and ".sql") so the encoded reference matches
    // how the script is registered in the catalog (dashql.notebook."<clean folder>/<clean file>").
    if (contextScriptData.folderName && contextScriptData.fileName) {
        return {
            kind: 'script-reference',
            folderName: normalizePageName(contextScriptData.folderName),
            fileName: scriptDisplayName(contextScriptData.fileName),
        };
    }
    return { kind: 'none' };
}

/// Extract the source clause of the focused script's first VISUALIZE statement as a VisSource,
/// mirroring the source switch in `resolveVisualizeQuery`.
function extractVisSourceFromScript(scriptData: ScriptData): VisSource | null {
    const analyzedPtr = scriptData.scriptAnalysis.buffers.analyzed;
    const parsedPtr = scriptData.scriptAnalysis.buffers.parsed;
    if (!analyzedPtr || !parsedPtr) return null;

    const analyzed = analyzedPtr.read();
    if (analyzed.visualizationSpecsLength() === 0) return null;
    const tmpSpec = new core.buffers.analyzer.VisualizationSpec();
    const spec = analyzed.visualizationSpecs(0, tmpSpec);
    if (!spec) return null;

    switch (spec.sourceKind()) {
        case core.buffers.analyzer.VisSourceKind.SCRIPT_REFERENCE: {
            const tmpName = new core.buffers.analyzer.QualifiedTableName();
            const qname = spec.sourceQualifiedName(tmpName);
            const path = qname?.tableName() ?? null;
            if (path) {
                const slash = path.indexOf('/');
                if (slash > 0 && slash < path.length - 1) {
                    return {
                        kind: 'script-reference',
                        folderName: path.substring(0, slash),
                        fileName: path.substring(slash + 1),
                    };
                }
            }
            return null;
        }
        case core.buffers.analyzer.VisSourceKind.TABLE_REFERENCE: {
            const tmpName = new core.buffers.analyzer.QualifiedTableName();
            const qname = spec.sourceQualifiedName(tmpName);
            const tbl = qname?.tableName();
            if (!tbl) return null;
            return {
                kind: 'table-reference',
                database: qname?.databaseName() ?? null,
                schema: qname?.schemaName() ?? null,
                table: tbl,
            };
        }
        case core.buffers.analyzer.VisSourceKind.INLINE_SELECT: {
            const nodeId = spec.sourceInlineSelectAstNodeId();
            const parsed = parsedPtr.read();
            const tokens = parsed.tokens();
            const node = parsed.nodes(nodeId);
            const span = node?.symbolSpan() ?? null;
            if (tokens && span) {
                const ts = resolveSymbolSpan(tokens, span);
                const scriptText = scriptData.script.toString();
                const inner = scriptText.substr(ts.offset + 1, Math.max(ts.length - 2, 0)).trim();
                if (inner) return { kind: 'inline-select', sql: inner };
            }
            return null;
        }
        default:
            return null;
    }
}
