import * as React from 'react';

import type { AgentBridge } from '../../agent/agent_bridge.js';
import { AgentConnectionStatus } from '../../../platform/agent/agent_client.js';
import { newScriptConnection, type SessionScripts, type ScriptData } from '../scripts/session_scripts.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { buildCatalogNameIndex, collectMentionedIdentifiers } from './catalog_name_index.js';
import { buildAgentPrompt, describeSqlDialect } from './agent_prompt.js';
import { collectReferencedScripts } from './script_references.js';
import { scriptDisplayName } from '../scripts/script_types.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';

const LOG_CTX = 'agent_questions';

/// A question that the agent answers or answered
export interface AgentQuestion {
    /// The question in natural language
    question: string;
    /// The latest status line of the agent while it works, null once it finished
    status: string | null;
    /// The error of a failed request
    error: string | null;
    /// The final message of the agent
    note: string | null;
    /// The scripts that the agent wrote, in the order of their first edit
    scripts: number[];
}

/// Is the agent working on a question?
export function isAgentAnswering(question: AgentQuestion): boolean {
    return question.status != null;
}

/// The session a question is answered in
export interface AgentQuestionsArgs {
    /// The agent bridge, null outside of the provider
    agent: AgentBridge | null;
    /// The scripts of the session
    sessionScripts: SessionScripts;
    /// Runs a script that the agent wrote
    runScript: (next: SessionScripts, scriptData: ScriptData) => void;
    /// Follows the agent to a script, every time the agent edits or runs it
    followScript?: (scriptKey: number, target: AgentFollowTarget) => void;
}

/// Where the feed follows the agent to: the text of a script it edits or the results of a script it runs
export type AgentFollowTarget = 'script' | 'result';

/// The questions of a session that the agent answers
export interface AgentQuestions {
    /// Can the session ask the agent?
    available: boolean;
    /// The running, failed and answered questions by question id, oldest first
    questions: ReadonlyMap<number, AgentQuestion>;
    /// Ask the agent a question, the agent picks the script it writes
    ask: (question: string) => Promise<void>;
    /// Stop the agent
    stop: (questionId: number) => void;
    /// Dismiss the error or the note of a question
    dismiss: (questionId: number) => void;
}

const NO_QUESTIONS: ReadonlyMap<number, AgentQuestion> = new Map();

/// The status line of a request that waits for the agent
const WAITING_STATUS = 'waiting for agent...';

/// Answer questions through the agent.
///
/// The agent writes its SQL into the scripts of the session through the dashql command, a new script or an existing
/// one. The composer shows the question with its status lines. Once the agent finishes, a script it edited without
/// running it runs.
export function useAgentQuestions(args: AgentQuestionsArgs): AgentQuestions {
    const logger = useLogger();
    const latest = React.useRef(args);
    latest.current = args;

    // The bridge keeps the questions of the session, its turns finish while the user is in another session
    const sessionId = args.sessionScripts.sessionId;
    const store = args.agent?.questions ?? null;
    const subscribe = React.useCallback((listener: () => void) => store?.subscribe(listener) ?? (() => { }), [store]);
    const questions = React.useSyncExternalStore(subscribe, () => store?.questions(sessionId) ?? NO_QUESTIONS);

    // The feed runs and follows the scripts of the agent while it shows the session
    React.useEffect(() => store?.attach(sessionId, {
        sessionScripts: () => latest.current.sessionScripts,
        runScript: (next, scriptData) => latest.current.runScript(next, scriptData),
        followScript: (scriptKey, target) => latest.current.followScript?.(scriptKey, target),
    }), [store, sessionId]);

    const cancelTurn = React.useCallback((questionId: number, turnId: string) => {
        logger.info('Stopping the agent', { questionId: String(questionId), turnId }, LOG_CTX);
        latest.current.agent?.cancel(sessionId, turnId).catch(e => {
            logger.warn('Stopping the agent failed', { error: stringifyError(e) }, LOG_CTX);
        });
    }, [logger, sessionId]);
    const stop = React.useCallback((questionId: number) => {
        if (store == null) return;
        // A question without a turn id is stopped once the request returns it
        const turnId = store.turnId(sessionId, questionId);
        if (!store.finish(sessionId, questionId)) return;
        store.remove(sessionId, questionId);
        if (turnId != null) cancelTurn(questionId, turnId);
    }, [store, sessionId, cancelTurn]);
    const dismiss = React.useCallback((questionId: number) => store?.remove(sessionId, questionId), [store, sessionId]);

    const ask = React.useCallback(async (question: string) => {
        const { agent, sessionScripts } = latest.current;
        if (agent == null || !agent.hasAccess(sessionId)) {
            logger.error('Cannot ask a question without agent access', {}, LOG_CTX);
            return;
        }
        const store = agent.questions;
        const questionId = store.add(sessionId, { question, status: WAITING_STATUS, error: null, note: null, scripts: [] });

        // The question is answered on the connection that the next script of the session runs on
        const connection = newScriptConnection(sessionScripts, null);
        const prompt = buildAgentPrompt({
            question,
            dialect: describeSqlDialect(connection?.connectorInfo.connectorType ?? ConnectorType.HYPER),
            mentionedIdentifiers: connection == null ? [] : collectMentionedIdentifiers(buildCatalogNameIndex(connection.catalog), question),
            referencedScripts: collectReferencedScripts(sessionScripts.scriptOrder.map(scriptDisplayName), question),
        });
        logger.info('Asking the agent', { questionId: String(questionId), characters: String(question.length) }, LOG_CTX);
        const active = () => store.isWorking(sessionId, questionId);
        const update = (fn: (prev: AgentQuestion) => AgentQuestion | null) => store.update(sessionId, questionId, fn);
        // The scripts that the agent edited, and whether it ran them after the last edit
        const edits = new Map<number, boolean>();
        try {
            const turnId = await agent.request(sessionId, prompt, {
                status: (_state, text) => {
                    if (active()) update(q => ({ ...q, status: text }));
                },
                edited: scriptKey => {
                    if (!active()) return;
                    edits.set(scriptKey, false);
                    update(q => (q.scripts.includes(scriptKey) ? q : { ...q, scripts: [...q.scripts, scriptKey] }));
                    store.feed(sessionId)?.followScript(scriptKey, 'script');
                },
                ran: scriptKey => {
                    if (!active()) return;
                    if (edits.has(scriptKey)) edits.set(scriptKey, true);
                    store.feed(sessionId)?.followScript(scriptKey, 'result');
                },
                done: message => {
                    if (!store.finish(sessionId, questionId)) return;
                    const note = message.trim();
                    // Without an answer and without scripts, nothing is left to show
                    update(q => (note.length > 0 || q.scripts.length > 0 ? { ...q, status: null, note: note.length > 0 ? note : null } : null));
                    // Run the first script that the agent wrote but did not run, while a feed shows the session
                    const feed = store.feed(sessionId);
                    if (feed == null) return;
                    const current = feed.sessionScripts();
                    const unrun = [...edits].find(([, ran]) => !ran);
                    const scriptData = unrun != null ? current.scripts[unrun[0]] : undefined;
                    if (scriptData == null) return;
                    feed.followScript(scriptData.scriptKey, 'result');
                    feed.runScript(current, scriptData);
                },
                failed: (error, cancelled) => {
                    if (!store.finish(sessionId, questionId)) return;
                    if (cancelled) store.remove(sessionId, questionId);
                    else update(q => ({ ...q, status: null, error }));
                },
            });
            if (active()) store.setTurnId(sessionId, questionId, turnId);
            else cancelTurn(questionId, turnId);
        } catch (e: unknown) {
            if (!store.finish(sessionId, questionId)) return;
            logger.error('Asking the agent failed', { questionId: String(questionId), error: stringifyError(e) }, LOG_CTX);
            update(q => ({ ...q, status: null, error: stringifyError(e) }));
        }
    }, [logger, cancelTurn, sessionId]);

    const available = args.agent != null
        && args.agent.hasAccess(sessionId)
        && args.agent.status === AgentConnectionStatus.Connected;
    return { available, questions, ask, stop, dismiss };
}
