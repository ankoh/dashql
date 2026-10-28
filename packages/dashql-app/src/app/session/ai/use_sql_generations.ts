import * as React from 'react';

import type { AgentBridge } from '../../agent/agent_bridge.js';
import { AgentConnectionStatus } from '../../../platform/agent/agent_client.js';
import type { SessionScripts, ScriptData } from '../scripts/session_scripts.js';
import { buildCatalogNameIndex, collectMentionedIdentifiers } from './catalog_name_index.js';
import { buildAgentPrompt, describeSqlDialect } from './sql_generation.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';

const LOG_CTX = 'sql_generations';

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
export interface SqlGenerationsArgs {
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
export interface SqlGenerations {
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

/// The status line of a request that waits for the agent
const WAITING_STATUS = 'waiting for agent...';

/// Answer questions through the agent.
///
/// The agent writes its SQL into the scripts of the session through the dashql command, a new script or an existing
/// one. The composer shows the question with its status lines. Once the agent finishes, a script it edited without
/// running it runs.
export function useSqlGenerations(args: SqlGenerationsArgs): SqlGenerations {
    const logger = useLogger();
    const latest = React.useRef(args);
    latest.current = args;
    const mounted = React.useRef(true);
    React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const [questions, setQuestions] = React.useState<ReadonlyMap<number, AgentQuestion>>(() => new Map());
    const setQuestion = React.useCallback((questionId: number, question: AgentQuestion | null) => {
        setQuestions(prev => {
            const next = new Map(prev);
            if (question == null) next.delete(questionId);
            else next.set(questionId, question);
            return next;
        });
    }, []);
    /// Update a question, null drops it
    const updateQuestion = React.useCallback((questionId: number, update: (prev: AgentQuestion) => AgentQuestion | null) => {
        setQuestions(prev => {
            const current = prev.get(questionId);
            if (current == null) return prev;
            const next = new Map(prev);
            const updated = update(current);
            if (updated == null) next.delete(questionId);
            else next.set(questionId, updated);
            return next;
        });
    }, []);

    // The questions that the agent works on, notifications of other requests are dropped
    const working = React.useRef(new Set<number>());
    const nextQuestionId = React.useRef(1);

    const sessionId = args.sessionScripts.sessionId;
    const stop = React.useCallback((questionId: number) => {
        if (!working.current.delete(questionId)) return;
        setQuestion(questionId, null);
        logger.info('Stopping the agent', { questionId: String(questionId) }, LOG_CTX);
        latest.current.agent?.cancel(sessionId).catch(e => {
            logger.warn('Stopping the agent failed', { error: stringifyError(e) }, LOG_CTX);
        });
    }, [logger, setQuestion, sessionId]);
    const dismiss = React.useCallback((questionId: number) => setQuestion(questionId, null), [setQuestion]);

    const ask = React.useCallback(async (question: string) => {
        const { agent, sessionScripts } = latest.current;
        if (agent == null || !agent.hasAccess(sessionId)) {
            logger.error('Cannot ask a question without agent access', {}, LOG_CTX);
            return;
        }
        const questionId = nextQuestionId.current++;
        working.current.add(questionId);
        setQuestion(questionId, { question, status: WAITING_STATUS, error: null, note: null, scripts: [] });

        const prompt = buildAgentPrompt({
            question,
            dialect: describeSqlDialect(sessionScripts.connectorInfo.connectorType),
            mentionedIdentifiers: collectMentionedIdentifiers(buildCatalogNameIndex(sessionScripts.connectionCatalog), question),
        });
        logger.info('Asking the agent', { questionId: String(questionId), characters: String(question.length) }, LOG_CTX);
        const active = () => working.current.has(questionId);
        try {
            await agent.request(sessionId, prompt, {
                status: (_state, text) => {
                    if (active()) updateQuestion(questionId, q => ({ ...q, status: text }));
                },
                edited: scriptKey => {
                    if (!active()) return;
                    updateQuestion(questionId, q => (q.scripts.includes(scriptKey) ? q : { ...q, scripts: [...q.scripts, scriptKey] }));
                    latest.current.followScript?.(scriptKey, 'script');
                },
                ran: scriptKey => {
                    if (active()) latest.current.followScript?.(scriptKey, 'result');
                },
                done: (message, unrunEdits) => {
                    if (!working.current.delete(questionId)) return;
                    const note = message.trim();
                    // Without an answer and without scripts, nothing is left to show
                    updateQuestion(questionId, q => (note.length > 0 || q.scripts.length > 0 ? { ...q, status: null, note: note.length > 0 ? note : null } : null));
                    if (!mounted.current) return;
                    // Run the first script that the agent wrote but did not run
                    const current = latest.current.sessionScripts;
                    const scriptData = unrunEdits.length > 0 ? current.scripts[unrunEdits[0]] : undefined;
                    if (scriptData == null) return;
                    latest.current.followScript?.(scriptData.scriptKey, 'result');
                    latest.current.runScript(current, scriptData);
                },
                failed: (error, cancelled) => {
                    if (!working.current.delete(questionId)) return;
                    if (cancelled) setQuestion(questionId, null);
                    else updateQuestion(questionId, q => ({ ...q, status: null, error }));
                },
            });
        } catch (e: unknown) {
            if (!working.current.delete(questionId)) return;
            logger.error('Asking the agent failed', { questionId: String(questionId), error: stringifyError(e) }, LOG_CTX);
            updateQuestion(questionId, q => ({ ...q, status: null, error: stringifyError(e) }));
        }
    }, [logger, setQuestion, updateQuestion, sessionId]);

    const available = args.agent != null
        && args.agent.hasAccess(sessionId)
        && args.agent.status === AgentConnectionStatus.Connected;
    return { available, questions, ask, stop, dismiss };
}
