import * as React from 'react';

import type { AgentBridge } from '../../agent/agent_bridge.js';
import { AgentConnectionStatus } from '../../../platform/agent/agent_client.js';
import type { SessionScripts, ScriptData } from '../scripts/session_scripts.js';
import { scriptDisplayName } from '../scripts/script_types.js';
import { buildCatalogNameIndex, collectMentionedIdentifiers } from './catalog_name_index.js';
import { buildAgentPrompt, describeSqlDialect, promptComment } from './sql_generation.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';

const LOG_CTX = 'sql_generations';

/// The answer of the agent to a question, in the script that holds the question
export interface ScriptGeneration {
    /// The question that the agent answers
    question: string;
    /// The latest status line of the agent while it works, null once it finished
    status: string | null;
    /// The error of a failed request
    error: string | null;
    /// The final message of the agent
    note: string | null;
}

/// A script that was appended to the session
export interface AppendedScript {
    /// The session scripts with the appended script
    next: SessionScripts;
    /// The appended script
    scriptData: ScriptData;
}

/// The session a question is answered in
export interface SqlGenerationsArgs {
    /// The agent bridge, null outside of the provider
    agent: AgentBridge | null;
    /// The scripts of the session, a deleted script stops its request
    sessionScripts: SessionScripts;
    /// Appends a script with the given text to the session
    appendScript: (text: string) => Promise<AppendedScript | null>;
    /// Runs a script that the agent wrote
    runScript: (next: SessionScripts, scriptData: ScriptData) => void;
}

/// The questions of a session that the agent answers
export interface SqlGenerations {
    /// Can the session ask the agent?
    available: boolean;
    /// The running, failed and answered questions by script key
    generations: ReadonlyMap<number, ScriptGeneration>;
    /// Ask the agent a question in a new script
    translate: (question: string) => Promise<void>;
    /// Stop the agent
    stop: (scriptKey: number) => void;
    /// Dismiss the error or the note of a script
    dismiss: (scriptKey: number) => void;
}

/// The status line of a request that waits for the agent
const WAITING_STATUS = 'waiting for agent...';

/// Answer questions through the agent.
///
/// A question becomes a script with the question as comment right away. The agent writes its SQL into the
/// script through the dashql command. Once the agent finishes, a script it edited without running it runs.
export function useSqlGenerations(args: SqlGenerationsArgs): SqlGenerations {
    const logger = useLogger();
    const latest = React.useRef(args);
    latest.current = args;
    const mounted = React.useRef(true);
    React.useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const [generations, setGenerations] = React.useState<ReadonlyMap<number, ScriptGeneration>>(() => new Map());
    const generationsRef = React.useRef(generations);
    generationsRef.current = generations;
    const setGeneration = React.useCallback((scriptKey: number, generation: ScriptGeneration | null) => {
        setGenerations(prev => {
            const next = new Map(prev);
            if (generation == null) next.delete(scriptKey);
            else next.set(scriptKey, generation);
            return next;
        });
    }, []);
    const updateGeneration = React.useCallback((scriptKey: number, update: (prev: ScriptGeneration) => ScriptGeneration) => {
        setGenerations(prev => {
            const current = prev.get(scriptKey);
            if (current == null) return prev;
            const next = new Map(prev);
            next.set(scriptKey, update(current));
            return next;
        });
    }, []);

    // The scripts whose requests the agent works on, notifications of other requests are dropped
    const working = React.useRef(new Set<number>());

    const sessionId = args.sessionScripts.sessionId;
    const stop = React.useCallback((scriptKey: number) => {
        if (!working.current.delete(scriptKey)) return;
        setGeneration(scriptKey, null);
        logger.info('Stopping the agent', { scriptKey: String(scriptKey) }, LOG_CTX);
        latest.current.agent?.cancel(sessionId).catch(e => {
            logger.warn('Stopping the agent failed', { error: stringifyError(e) }, LOG_CTX);
        });
    }, [logger, setGeneration, sessionId]);
    const dismiss = React.useCallback((scriptKey: number) => setGeneration(scriptKey, null), [setGeneration]);

    // A deleted script stops its request
    React.useEffect(() => {
        for (const [scriptKey, generation] of generationsRef.current) {
            if (args.sessionScripts.scripts[scriptKey] != null) continue;
            setGeneration(scriptKey, null);
            if (working.current.delete(scriptKey) && generation.status != null) {
                logger.info('Stopping the agent for a deleted script', { scriptKey: String(scriptKey) }, LOG_CTX);
                void latest.current.agent?.cancel(sessionId).catch(() => { });
            }
        }
    }, [args.sessionScripts.scripts, logger, setGeneration, sessionId]);

    const translate = React.useCallback(async (question: string) => {
        const { agent, appendScript } = latest.current;
        if (agent == null || !agent.hasAccess(sessionId)) {
            logger.error('Cannot ask a question without agent access', {}, LOG_CTX);
            return;
        }
        const appended = await appendScript(promptComment(question));
        if (appended == null) return;
        const scriptKey = appended.scriptData.scriptKey;
        working.current.add(scriptKey);
        setGeneration(scriptKey, { question, status: WAITING_STATUS, error: null, note: null });

        const { sessionScripts } = latest.current;
        const prompt = buildAgentPrompt({
            question,
            scriptName: scriptDisplayName(appended.scriptData.fileName),
            dialect: describeSqlDialect(sessionScripts.connectorInfo.connectorType),
            mentionedIdentifiers: collectMentionedIdentifiers(buildCatalogNameIndex(sessionScripts.connectionCatalog), question),
        });
        logger.info('Asking the agent', { scriptKey: String(scriptKey), characters: String(question.length) }, LOG_CTX);
        const active = () => working.current.has(scriptKey);
        try {
            await agent.request(sessionId, prompt, {
                status: (_state, text) => {
                    if (active()) updateGeneration(scriptKey, g => ({ ...g, status: text }));
                },
                done: (message, unrunEdits) => {
                    if (!working.current.delete(scriptKey)) return;
                    const note = message.trim();
                    setGeneration(scriptKey, note.length > 0 ? { question, status: null, error: null, note } : null);
                    if (!mounted.current) return;
                    // Run what the agent wrote but did not run, the script of the question first
                    const toRun = unrunEdits.includes(scriptKey) ? scriptKey : unrunEdits[0];
                    const current = latest.current.sessionScripts;
                    const scriptData = toRun == null ? undefined : current.scripts[toRun];
                    if (scriptData != null) latest.current.runScript(current, scriptData);
                },
                failed: (error, cancelled) => {
                    if (!working.current.delete(scriptKey)) return;
                    setGeneration(scriptKey, cancelled ? null : { question, status: null, error, note: null });
                },
            });
        } catch (e: unknown) {
            if (!working.current.delete(scriptKey)) return;
            logger.error('Asking the agent failed', { scriptKey: String(scriptKey), error: stringifyError(e) }, LOG_CTX);
            setGeneration(scriptKey, { question, status: null, error: stringifyError(e), note: null });
        }
    }, [logger, setGeneration, updateGeneration, sessionId]);

    const available = args.agent != null
        && args.agent.hasAccess(sessionId)
        && args.agent.status === AgentConnectionStatus.Connected;
    return { available, generations, translate, stop, dismiss };
}
