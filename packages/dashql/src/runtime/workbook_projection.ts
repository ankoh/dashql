import * as core from '../core/index.js';
import * as Immutable from 'immutable';

import { share } from './store/projection.js';
import type { ViewProjection } from './store/runtime_store.js';
import { readWorkbookInputs } from '../platform/workbook/workbook_inputs.js';
import { resolveCompiledVisualization } from '../platform/workbook/script_compilation.js';
import { readScriptReferenceReports } from '../platform/workbook/script_reference_check.js';
import { createScriptRef, type ScriptAnnotations, type ScriptRef, type WorkbookMetadata } from '../platform/workbook/script_types.js';
import type { ScriptData, WorkbookDerived, WorkbookScripts } from '../platform/workbook/workbook_scripts.js';

/// The projections of the views of the workbooks into what the app reads (docs/design/dashql_runtime.md): a script
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
    /// The session handles of the scripts with the generations of their sessions
    private readonly sessions = new Map<number, { generation: number; session: core.DashQLWorkbookScriptSession }>();
    /// The keys of the editor updates that the projection handed out, the editors name the update they hold by it
    private readonly updateKeys = new WeakMap<core.buffers.editor.EditorUpdateT, string>();

    constructor(private readonly api: core.DashQL, private readonly runtime: core.Runtime) {
        this.pendingDiffs = new core.FlatBufferCache(bb => core.buffers.diff.ScriptDiff.getRootAsScriptDiff(bb), (_, bytes) => core.scriptDiffBuffer(api, bytes));
    }

    /// Hold the update of an editor event of a script with its key, the next projection of the script takes it instead
    /// of reading it again
    hold(scriptKey: number, key: string, update: core.buffers.editor.EditorUpdateT): void {
        this.editorUpdates.hold(scriptKey, key, update);
        this.updateKeys.set(update, key);
    }

    /// The key of an editor update that the projection handed out, null for another one
    keyOf(update: core.buffers.editor.EditorUpdateT): string | null {
        return this.updateKeys.get(update) ?? null;
    }

    /// The keys of the payloads of a script that the projection holds
    private keysOf(key: number, withStatistics: boolean): core.WorkbookScriptKeys {
        const statistics = this.views.get(key)?.view.statistics ?? [];
        return {
            editorUpdate: this.editorUpdates.known(key),
            pendingDiff: this.pendingDiffs.known(key),
            visualization: this.visualizations.known(key),
            statistics: withStatistics && statistics.length > 0 ? statistics[statistics.length - 1].key : null,
        };
    }

    known(ids: number[]): (core.WorkbookScriptKeys | null)[] {
        return ids.map(id => this.keysOf(id, true));
    }

    /// The session handle of a script, one per session. The handle of a replaced session stays usable for the editors
    /// that still hold it until they take the new one, the module frees it once it is collected.
    private session(key: number, generation: number): core.DashQLWorkbookScriptSession {
        const held = this.sessions.get(key);
        if (held != null && held.generation === generation) return held.session;
        const session = this.api.runtimeScriptSession(this.runtime, key);
        if (session == null) throw new Error(`the runtime holds no script ${key}`);
        this.sessions.set(key, { generation, session });
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
            const again = this.runtime.views('script', [key], [this.keysOf(key, false)])[0] ?? null;
            if (again != null && again !== 'busy') view = again;
        }

        // The payloads keep their objects while their keys don't move, the update of an editor event is held as it is
        const editorUpdate = this.editorUpdates.read(key, view.editorUpdateKey, view.editorUpdate);
        if (editorUpdate != null && view.editorUpdateKey != null) this.updateKeys.set(editorUpdate, view.editorUpdateKey);
        const diffBuffer = this.pendingDiffs.read(key, view.pendingDiff?.key ?? null, view.pendingDiff?.diff ?? null);
        const pendingDiff = view.pendingDiff == null || diffBuffer == null ? null
            : before?.data.pendingDiff?.diffBuffer === diffBuffer && before.data.pendingDiff.priorText === view.pendingDiff.priorText
                ? before.data.pendingDiff
                : { priorText: view.pendingDiff.priorText, diffBuffer };
        const visualization = this.visualizations.read(key, view.visualization?.key ?? null, view.visualization?.visualization ?? null);
        const visualizeQuery = view.visualization == null || visualization == null ? null
            : before != null && before.view.visualization?.key === view.visualization.key ? before.data.annotations.visualizeQuery
                : resolveCompiledVisualization(view.visualization.sql, visualization, view.visualization.statementId);
        // The runtime derives the annotations from the analysis, the visualization that a run captured holds without one
        const annotations = share<ScriptAnnotations>(before?.data.annotations, { ...view.annotations, visualizeQuery });
        const statistics = view.statistics.flatMap(entry => {
            if (entry.statistics == null) return held.get(entry.key) ?? [];
            return [core.readFlatBuffer(entry.statistics, bb => core.buffers.editor.EditorProcessingStatistics.getRootAsEditorProcessingStatistics(bb)).unpack()];
        });
        const sameStatistics = before != null && before.data.statistics.size === statistics.length
            && statistics.every((value, i) => value === before.data.statistics.get(i));

        const data: ScriptData = {
            scriptKey: key,
            workbookId: view.workbookId,
            sessionGeneration: view.sessionGeneration,
            scriptSession: this.session(key, view.sessionGeneration),
            editorUpdate,
            analysisOutdated: view.analysisOutdated,
            annotations,
            statistics: sameStatistics ? before.data.statistics : Immutable.List(statistics),
            pendingDiff,
            externalChanges: view.externalChanges,
            latestQueryId: view.latestQueryId,
            latestResultQueryId: view.latestResultQueryId,
            storedResult: view.storedResult,
            fileName: view.fileName,
            connectionId: view.connectionId,
            ...(view.unresolvedConnectionId != null ? { unresolvedConnectionId: view.unresolvedConnectionId } : {}),
        };
        this.views.set(key, { view, data });
        return data;
    }

    release(key: number): void {
        this.views.delete(key);
        // An editor may still hold the handle, the module frees it once it is collected
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

/// The projection of the derived views of the workbooks, the FlatBuffers read once per view. A buffer with the hash of
/// the previous view keeps what was read from it. The view carries the names of the scripts and the attachments that
/// its buffers refer to, the projection reads no other slice.
export class WorkbookDerivedProjection implements ViewProjection<'workbookDerived', WorkbookDerived> {
    /// The last view of every workbook with the names that its references were read with
    private readonly held = new Map<string, { view: core.WorkbookDerivedView; names: string }>();

    project(workbookId: string, prev: WorkbookDerived | null, view: core.WorkbookDerivedView): WorkbookDerived {
        const before = prev != null ? this.held.get(workbookId) ?? null : null;
        const files = view.scriptFiles;
        const attachments = view.attachments;
        const names = JSON.stringify([files, attachments]);
        this.held.set(workbookId, { view, names });
        const scriptKeys = share(prev?.scriptKeys, view.scriptKeys);
        const sameScripts = prev != null && scriptKeys === prev.scriptKeys;
        const [references0, dataflow0, inputs0] = before?.view.hashes ?? [null, null, null];
        const [referencesHash, dataflowHash, inputsHash] = view.hashes;
        const references = prev != null && before != null && sameScripts && before.names === names && references0 === referencesHash
            ? prev.references
            : readScriptReferenceReports(
                core.readFlatBuffer(view.references, bb => core.buffers.execution.ScriptReferenceCheck.getRootAsScriptReferenceCheck(bb)).unpack(),
                view.scriptKeys, files, attachments, prev?.references ?? null,
            );
        const dataflow = prev != null && before != null && dataflow0 === dataflowHash
            ? prev.dataflow
            : core.readFlatBuffer(view.dataflow, bb => core.buffers.execution.SessionDataflow.getRootAsSessionDataflow(bb)).unpack();
        const inputs = prev != null && before != null && sameScripts && inputs0 === inputsHash
            ? prev.inputs
            : share(prev?.inputs, readWorkbookInputs(
                core.readFlatBuffer(view.inputs, bb => core.buffers.execution.SessionInputs.getRootAsSessionInputs(bb)).unpack(), view.scriptKeys,
            ));
        if (prev != null && prev.scriptKeys === scriptKeys && prev.references === references && prev.dataflow === dataflow && prev.inputs === inputs) {
            return prev;
        }
        return { workbookId, scriptKeys, references, dataflow, inputs };
    }

    release(workbookId: string): void {
        this.held.delete(workbookId);
    }
}

