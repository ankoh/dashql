import * as core from '@ankoh/dashql-core';
import * as Immutable from 'immutable';

import { share } from '../../store/projection.js';
import type { ViewProjection } from '../../store/runtime_store.js';
import { readSessionInputs } from '@ankoh/dashql-platform/workbook/inputs/workbook_inputs';
import { resolveCompiledVisualization } from '@ankoh/dashql-platform/workbook/scripts/script_compilation';
import { readScriptReferenceReports } from '@ankoh/dashql-platform/workbook/scripts/script_reference_check';
import { createEmptyAnnotations, createScriptRef, type ResolvedVisualizeQuery, type ScriptAnnotations, type ScriptRef, type WorkbookMetadata } from '@ankoh/dashql-platform/workbook/scripts/script_types';
import type { ScriptData, WorkbookDerived, WorkbookScripts } from '@ankoh/dashql-platform/workbook/scripts/workbook_scripts';

/// The projections of the views of the workbooks into what the app reads (docs/wip/runtime_projection.md): a script
/// with its payloads read once per key and the session handle of its session, the workbook with its scripts by file
/// name, the derived views with their FlatBuffers read.

/// The script view of a projected script
interface ScriptViews {
    view: core.WorkbookScriptView;
    data: ScriptData;
}

/// The projection of the scripts of the workbooks. A script keeps its payload objects while their keys don't move and
/// its session handle while it keeps its session.
export class ScriptProjection implements ViewProjection<'script', ScriptData> {
    private readonly editorUpdates = new core.FlatBufferCache(bb => core.buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb), table => table.unpack());
    private readonly pendingDiffs: core.FlatBufferCache<core.buffers.diff.ScriptDiff, core.FlatBufferPtr<core.buffers.diff.ScriptDiff>, number>;
    private readonly visualizations = new core.FlatBufferCache<core.buffers.execution.CompiledVisualization, core.buffers.execution.CompiledVisualizationT, number>(
        bb => core.buffers.execution.CompiledVisualization.getRootAsCompiledVisualization(bb),
        table => table.unpack(),
    );
    /// The last view of every script, the next view crosses only the payloads it changed
    private readonly views = new Map<number, ScriptViews>();
    /// The session handles of the scripts with the ids of their sessions
    private readonly sessions = new Map<number, { sessionId: number; session: core.DashQLScriptSession }>();
    /// Editor updates that the editors reported, the projection holds them instead of reading them again
    private readonly reported = new Map<number, core.buffers.editor.EditorUpdateT>();

    constructor(private readonly api: core.DashQL, private readonly runtime: core.Runtime) {
        this.pendingDiffs = new core.FlatBufferCache(bb => core.buffers.diff.ScriptDiff.getRootAsScriptDiff(bb), (_, bytes) => core.scriptDiffBuffer(api, bytes));
    }

    /// Take an editor update for the next projection of a script instead of reading it again
    report(scriptKey: number, update: core.buffers.editor.EditorUpdateT): void {
        this.reported.set(scriptKey, update);
    }

    /// The keys of the payloads of a script that the projection holds
    private keysOf(key: number, withStatistics: boolean): core.WorkbookScriptKeys {
        const reported = this.reported.get(key);
        const statistics = this.views.get(key)?.view.statistics ?? [];
        return {
            editorUpdate: reported != null ? core.editorUpdateKey(reported) : this.editorUpdates.known(key),
            pendingDiff: this.pendingDiffs.known(key),
            visualization: this.visualizations.known(key),
            statistics: withStatistics && statistics.length > 0 ? statistics[statistics.length - 1].key : null,
        };
    }

    known(ids: number[]): (core.WorkbookScriptKeys | null)[] {
        return ids.map(id => this.keysOf(id, true));
    }

    /// The session handle of a script, one per session
    private session(key: number, sessionId: number): core.DashQLScriptSession {
        const held = this.sessions.get(key);
        if (held != null && held.sessionId === sessionId) return held.session;
        held?.session.destroy();
        const session = this.api.runtimeScriptSession(this.runtime, key);
        if (session == null) throw new Error(`the runtime holds no script ${key}`);
        this.sessions.set(key, { sessionId, session });
        return session;
    }

    project(key: number, _prev: ScriptData | null, next: core.WorkbookScriptView): ScriptData {
        const before = this.views.get(key) ?? null;
        let view = share(before?.view, next);
        // The statistics that the view left out are the ones of the previous projection
        const held = new Map<number, core.buffers.editor.EditorProcessingStatisticsT>();
        before?.view.statistics.forEach((entry, i) => {
            const statistics = before.data.statistics.get(i);
            if (statistics != null) held.set(entry.key, statistics);
        });
        if (view.statistics.some(entry => entry.statistics == null && !held.has(entry.key))) {
            view = this.runtime.views('script', [key], [this.keysOf(key, false)])[0] ?? view;
        }

        // The payloads keep their objects while their keys don't move, a reported editor update is held as it is
        const reported = this.reported.get(key);
        this.reported.delete(key);
        if (reported != null && view.editorUpdateKey != null && view.editorUpdateKey === core.editorUpdateKey(reported)) {
            this.editorUpdates.hold(key, view.editorUpdateKey, reported);
        }
        const editorUpdate = this.editorUpdates.read(key, view.editorUpdateKey, view.editorUpdate);
        const diffBuffer = this.pendingDiffs.read(key, view.pendingDiff?.key ?? null, view.pendingDiff?.diff ?? null);
        const pendingDiff = view.pendingDiff == null || diffBuffer == null ? null
            : before?.data.pendingDiff?.diffBuffer === diffBuffer && before.data.pendingDiff.priorText === view.pendingDiff.priorText
                ? before.data.pendingDiff
                : { priorText: view.pendingDiff.priorText, diffBuffer };
        const visualization = this.visualizations.read(key, view.visualization?.key ?? null, view.visualization?.visualization ?? null);
        const visualizeQuery = view.visualization == null || visualization == null ? null
            : before != null && before.view.visualization?.key === view.visualization.key ? before.data.annotations.visualizeQuery
                : resolveCompiledVisualization(view.visualization.sql, visualization, view.visualization.statementId);
        const annotations = before != null && before.data.editorUpdate === editorUpdate && before.data.annotations.visualizeQuery === visualizeQuery
            ? before.data.annotations
            : deriveScriptAnnotations(editorUpdate, visualizeQuery);
        const statistics = view.statistics.flatMap(entry => {
            if (entry.statistics == null) return held.get(entry.key) ?? [];
            return [core.readFlatBuffer(entry.statistics, bb => core.buffers.editor.EditorProcessingStatistics.getRootAsEditorProcessingStatistics(bb)).unpack()];
        });
        const sameStatistics = before != null && before.data.statistics.size === statistics.length
            && statistics.every((value, i) => value === before.data.statistics.get(i));

        const data: ScriptData = {
            scriptKey: key,
            workbookId: view.workbookId,
            sessionId: view.sessionId,
            scriptSession: this.session(key, view.sessionId),
            editorUpdate,
            analysisOutdated: view.analysisOutdated,
            annotations,
            statistics: sameStatistics ? before.data.statistics : Immutable.List(statistics),
            pendingDiff,
            externalChanges: view.externalChanges,
            latestQueryId: view.latestQueryId,
            latestResultQueryId: view.latestResultQueryId,
            fileName: view.fileName,
            connectionId: view.connectionId,
            ...(view.unresolvedConnectionId != null ? { unresolvedConnectionId: view.unresolvedConnectionId } : {}),
        };
        this.views.set(key, { view, data });
        return data;
    }

    release(key: number): void {
        this.views.delete(key);
        this.reported.delete(key);
        this.sessions.get(key)?.session.destroy();
        this.sessions.delete(key);
        const keys = [...this.views.keys()];
        this.editorUpdates.retain(keys);
        this.pendingDiffs.retain(keys);
        this.visualizations.retain(keys);
    }

    /// Destroy the session handles
    destroy(): void {
        for (const { session } of this.sessions.values()) session.destroy();
        this.sessions.clear();
        this.views.clear();
    }
}

/// The projection of the workbooks: the metadata typed, the scripts by file name
export const WORKBOOK_PROJECTION: ViewProjection<'workbook', WorkbookScripts> = {
    project(_id, prev, view) {
        const sameOrder = prev != null && prev.scriptOrder.length === view.scriptOrder.length
            && prev.scriptOrder.every((name, i) => name === view.scriptOrder[i] && prev.scriptKeys[i] === view.scriptKeys[i]);
        const scriptRefs: { [fileName: string]: ScriptRef } = {};
        if (!sameOrder) view.scriptOrder.forEach((name, i) => { scriptRefs[name] = createScriptRef(view.scriptKeys[i], name); });
        const projected: WorkbookScripts = {
            ...view,
            workbookMetadata: view.workbookMetadata as WorkbookMetadata,
            scriptRefs: sameOrder ? prev.scriptRefs : scriptRefs,
        };
        return share(prev, projected);
    },
};

/// The projection of the derived views of the workbooks, the FlatBuffers read once per view. The names of the scripts
/// and the attachments come from the view of the workbook of the same flush.
export class WorkbookDerivedProjection implements ViewProjection<'workbookDerived', WorkbookDerived> {
    constructor(private readonly workbook: (workbookId: string) => WorkbookScripts | null) { }

    project(workbookId: string, prev: WorkbookDerived | null, view: core.WorkbookDerivedView): WorkbookDerived {
        const workbook = this.workbook(workbookId);
        const files = view.scriptKeys.map((key, i) => workbook?.scriptKeys[i] === key ? workbook.scriptOrder[i] : null);
        const attachments = (workbook?.attachments ?? []).map(attachment => attachment.fileName);
        const check = core.readFlatBuffer(view.references, bb => core.buffers.execution.ScriptReferenceCheck.getRootAsScriptReferenceCheck(bb)).unpack();
        const references = readScriptReferenceReports(check, view.scriptKeys, files, attachments, prev?.references ?? null);
        const dataflow = core.readFlatBuffer(view.dataflow, bb => core.buffers.execution.SessionDataflow.getRootAsSessionDataflow(bb)).unpack();
        const collected = core.readFlatBuffer(view.inputs, bb => core.buffers.execution.SessionInputs.getRootAsSessionInputs(bb)).unpack();
        const inputs = share(prev?.inputs, readSessionInputs(collected, view.scriptKeys));
        return { workbookId, scriptKeys: share(prev?.scriptKeys, view.scriptKeys), references, dataflow, inputs };
    }
}

/// The annotations of a script for the views: its tables, its visualization, its positions on the canvas and the board
export function deriveScriptAnnotations(
    update: core.buffers.editor.EditorUpdateT | null | undefined,
    visualizeQuery: ResolvedVisualizeQuery | null,
): ScriptAnnotations {
    // The visualization that a run captured holds also without an analysis
    if (!update?.analysisAvailable) {
        return { ...createEmptyAnnotations(), visualizeQuery };
    }
    const tableDefs = update.scriptAnnotations?.tableDefinitions
        .map(table => typeof table.name === 'string' ? table.name : null)
        .filter((name): name is string => name != null)
        .sort() ?? [];
    const flow = update.scriptAnnotations?.flowPosition;
    const board = update.scriptAnnotations?.boardPosition;
    const lastStatement = (update.scriptAnnotations?.statements ?? [])
        .reduce<core.buffers.editor.EditorStatementT | null>((last, statement) => last == null || statement.statementId > last.statementId ? statement : last, null);
    return {
        tableDefs,
        visualizeQuery,
        flowPosition: flow != null
            ? { statementId: flow.statementId, x: flow.x, y: flow.y, width: flow.width, height: flow.height }
            : null,
        boardPosition: board != null
            ? { statementId: board.statementId, row: board.row, column: board.column, width: board.width, height: board.height }
            : null,
        lastStatementIsQuery: lastStatement?.statementType === core.buffers.parser.StatementType.SELECT,
        manual: update.scriptAnnotations?.manual ?? false,
    };
}
