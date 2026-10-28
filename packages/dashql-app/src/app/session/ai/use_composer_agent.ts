import * as React from 'react';

import type { AgentBridge } from '../../agent/agent_bridge.js';
import { AgentConnectionStatus } from '../../../platform/agent/agent_client.js';
import type { ScriptData, SessionScripts } from '../scripts/session_scripts.js';
import { scriptDisplayName } from '../scripts/script_types.js';
import { isAgentAnswering, useAgentQuestions, type AgentFollowTarget } from './use_agent_questions.js';
import { useAgentSessionContext, type ComposerAgent, type ComposerAgentScript, type ComposerAgentTurn } from './ui/agent_prompt_panel.js';

/// The session of the composer and what the feed does for the agent
export interface ComposerAgentArgs {
    /// The agent bridge, null outside of the provider
    agent: AgentBridge | null;
    /// The scripts of the session
    sessionScripts: SessionScripts;
    /// Runs a script that the agent wrote
    runScript: (next: SessionScripts, scriptData: ScriptData) => void;
    /// Follows the agent to a script, every time the agent edits or runs it
    followScript: (scriptKey: number, target: AgentFollowTarget) => void;
    /// Shows a script that the user picked in a question
    showScript: (scriptKey: number) => void;
}

/// The agent of the composer
export interface ComposerAgentState {
    /// The agent on top of the composer, null without agent access
    agent: ComposerAgent | null;
    /// Can the composer ask the agent?
    available: boolean;
    /// Ask the agent a question
    ask: (question: string) => Promise<void>;
}

/// The agent of a session in the composer: its harness, its status lines and its answers.
/// The scripts of the feed only show the edits of the agent.
export function useComposerAgent(args: ComposerAgentArgs): ComposerAgentState {
    const { agent, sessionScripts, showScript } = args;
    const sessionId = sessionScripts.sessionId;
    const questions = useAgentQuestions({
        agent,
        sessionScripts,
        runScript: args.runScript,
        followScript: args.followScript,
    });

    // The harness context changes with every finished question
    let workingCount = 0;
    for (const question of questions.questions.values()) {
        if (isAgentAnswering(question)) ++workingCount;
    }
    const context = useAgentSessionContext(agent, sessionId, workingCount);

    const access = agent != null && agent.supported && agent.hasAccess(sessionId);
    const composerAgent = React.useMemo<ComposerAgent | null>(() => {
        if (agent == null || !access) return null;
        const turns: ComposerAgentTurn[] = [];
        for (const [questionId, question] of questions.questions) {
            // Deleted scripts drop out
            const scripts: ComposerAgentScript[] = [];
            for (const scriptKey of question.scripts) {
                const scriptData = sessionScripts.scripts[scriptKey];
                if (scriptData != null) scripts.push({ scriptKey, scriptName: scriptDisplayName(scriptData.fileName) });
            }
            turns.push({ questionId, question, scripts });
        }
        return {
            connected: agent.status === AgentConnectionStatus.Connected,
            port: agent.port,
            context,
            turns,
            onStop: questions.stop,
            onDismiss: questions.dismiss,
            onShowScript: showScript,
        };
    }, [agent, access, context, questions.questions, questions.stop, questions.dismiss, sessionScripts.scripts, showScript]);
    return { agent: composerAgent, available: questions.available, ask: questions.ask };
}
