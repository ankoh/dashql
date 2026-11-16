import type { AgentSessionTarget } from '@ankoh/dashql/platform/session/agent_session_client';
import type { AgentSessionState } from '@ankoh/dashql/platform/session/agent_session_state';
import { workbookCopyPath, type SessionWorkbook } from '@ankoh/dashql/platform/session/workbook_journal';
import { STORAGE_SCRIPTS_FOLDER } from '@ankoh/dashql/platform/storage/storage_backend';
import { stringifyError, type Logger } from '@ankoh/dashql/platform/platform/logger/logger';
import type { Runtime } from '@ankoh/dashql/runtime/runtime';

const LOG_CTX = 'agent_session';

/// A script of the copy of a workbook, `scripts/<name>.sql`, as the page takes it
const COPY_SCRIPT = new RegExp(`^${STORAGE_SCRIPTS_FOLDER}/([^/]+)\\.sql$`);

/// The stamps of the files of the copy of a workbook by their paths
function stampsOf(workbook: SessionWorkbook): Map<string, string> {
    return new Map(workbook.files.map(file => [file.path, `${file.size}:${file.mtimeMs}`]));
}

/// The scripts of a copy that changed since the page saw it last, in the order of the files
export function changedCopyScripts(seen: ReadonlyMap<string, string>, workbook: SessionWorkbook): string[] {
    return [...stampsOf(workbook)].filter(([path, stamp]) => COPY_SCRIPT.test(path) && seen.get(path) !== stamp).map(([path]) => path);
}

/// What the page does with the copies, the tests pass their own
export interface AgentSessionCopyHost {
    /// The text of a file of a copy
    fetchText: (workbookId: string, path: string) => Promise<string>;
    /// The scripts of a workbook of the page by file name with their texts, null for a workbook that the page doesn't have
    scripts: (workbookId: string) => Map<string, { scriptKey: number; text: string }> | null;
    /// Stage a new text of a script as a rewrite to accept or reject
    rewriteScript: (workbookId: string, scriptKey: number, text: string) => void;
    /// Create a script with a text, returns its key
    createScript: (workbookId: string, base: string, text: string) => number | null;
}

/// The host of the copies of a page over the runtime and the server of the session
export function agentSessionCopyHost(runtime: Runtime, target: AgentSessionTarget): AgentSessionCopyHost {
    return {
        fetchText: async (workbookId, path) => {
            const parts = ['v1', 'workbooks', target.token, workbookId, ...path.split('/')];
            const response = await fetch(new URL(`/${parts.map(encodeURIComponent).join('/')}`, target.endpoint));
            if (!response.ok) throw new Error(`the session answered ${path} with ${response.status}`);
            return await response.text();
        },
        scripts: workbookId => {
            const workbook = runtime.store.get('workbook', workbookId);
            if (workbook == null) return null;
            const scripts = new Map<string, { scriptKey: number; text: string }>();
            for (const [fileName, ref] of Object.entries(workbook.scriptRefs)) {
                const script = runtime.store.get('script', ref.scriptId);
                if (script != null) scripts.set(fileName, { scriptKey: ref.scriptId, text: script.scriptSession.getText() });
            }
            return scripts;
        },
        rewriteScript: (workbookId, scriptKey, text) => {
            runtime.dispatch({ workbook: workbookId }, { kind: 'setScriptText', value: { scriptKey, text, withDiff: true } });
        },
        createScript: (workbookId, base, text) => {
            const before = new Set(Object.values(runtime.store.get('workbook', workbookId)?.scriptRefs ?? {}).map(ref => ref.scriptId));
            runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text, base } });
            runtime.flush();
            const created = Object.values(runtime.store.get('workbook', workbookId)?.scriptRefs ?? {}).find(ref => !before.has(ref.scriptId));
            return created?.scriptId ?? null;
        },
    };
}

/// Follows the copies of the workbooks of the page in a session (docs/wip/agent_session.md): the scripts that the agent
/// changed in a copy come into the workbook of the page. A changed script is staged as a rewrite that the user accepts
/// or rejects, a new script becomes a script of the workbook. The page stays the truth: what the agent deletes stays,
/// the workbook file and the attachments of a copy are not taken yet.
export class AgentSessionCopies {
    /// The stamps of the files of every copy as the page saw them last, by workbook
    private readonly seen = new Map<string, Map<string, string>>();
    /// The scripts that the page created for new scripts of a copy, by workbook and path in the copy
    private readonly created = new Map<string, number>();
    /// The changes apply one after the other
    private applying: Promise<void> = Promise.resolve();

    constructor(private readonly host: AgentSessionCopyHost, private readonly logger: Logger) { }

    /// The page writes the copy of a workbook: the next state that names the copy is what the page has
    reset(workbookId: string): void {
        this.seen.delete(workbookId);
    }

    /// Take a state of the session, resolves when its changes were applied
    update(state: AgentSessionState): Promise<void> {
        for (const workbook of state.workbooks ?? []) {
            if (workbook.path !== workbookCopyPath(workbook.workbookId)) continue;
            const seen = this.seen.get(workbook.workbookId);
            this.seen.set(workbook.workbookId, stampsOf(workbook));
            if (seen == null) continue;
            for (const path of changedCopyScripts(seen, workbook)) {
                this.applying = this.applying.then(() => this.apply(workbook.workbookId, path)).catch(error => {
                    this.logger.warn('Cannot take a script of the agent', { workbook: workbook.workbookId, path, error: stringifyError(error) }, LOG_CTX);
                });
            }
        }
        return this.applying;
    }

    private async apply(workbookId: string, path: string): Promise<void> {
        const text = await this.host.fetchText(workbookId, path);
        const scripts = this.host.scripts(workbookId);
        if (scripts == null) return;
        const fileName = path.slice(STORAGE_SCRIPTS_FOLDER.length + 1);
        const createdKey = this.created.get(`${workbookId}/${path}`);
        const script = scripts.get(fileName) ?? [...scripts.values()].find(other => other.scriptKey === createdKey);
        if (script != null) {
            if (script.text !== text) this.host.rewriteScript(workbookId, script.scriptKey, text);
            return;
        }
        const key = this.host.createScript(workbookId, fileName.replace(/\.sql$/, ''), text);
        if (key != null) this.created.set(`${workbookId}/${path}`, key);
    }
}
