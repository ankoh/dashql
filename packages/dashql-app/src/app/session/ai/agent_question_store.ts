import type { ScriptData, SessionScripts } from '../scripts/session_scripts.js';
import type { AgentFollowTarget, AgentQuestion } from './use_agent_questions.js';

/// The feed that shows a session, it runs and follows the scripts that the agent writes
export interface AgentQuestionFeed {
    /// The current scripts of the session
    sessionScripts: () => SessionScripts;
    /// Runs a script that the agent wrote
    runScript: (next: SessionScripts, scriptData: ScriptData) => void;
    /// Follows the agent to a script
    followScript: (scriptKey: number, target: AgentFollowTarget) => void;
}

/// The questions of a session
interface SessionAgentQuestions {
    /// The running, failed and answered questions by question id, oldest first
    questions: ReadonlyMap<number, AgentQuestion>;
    /// The questions that the agent works on, notifications of other requests are dropped
    working: Set<number>;
    /// The turns of the questions, once the server queued them
    turnIds: Map<number, string>;
    /// The feed that shows the session, null while no feed shows it
    feed: AgentQuestionFeed | null;
}

const NO_QUESTIONS: ReadonlyMap<number, AgentQuestion> = new Map();

/// The questions of the sessions that the agent answers.
/// The bridge keeps them, a question outlives the feed that asked it and shows again when the user returns to the session.
export class AgentQuestionStore {
    private sessions = new Map<string, SessionAgentQuestions>();
    private listeners = new Set<() => void>();
    private nextQuestionId = 1;

    private session(sessionId: string): SessionAgentQuestions {
        let session = this.sessions.get(sessionId);
        if (session == null) {
            session = { questions: NO_QUESTIONS, working: new Set(), turnIds: new Map(), feed: null };
            this.sessions.set(sessionId, session);
        }
        return session;
    }
    private setQuestions(sessionId: string, questions: ReadonlyMap<number, AgentQuestion>) {
        this.session(sessionId).questions = questions;
        for (const listener of this.listeners) listener();
    }

    /// Subscribe to the questions of all sessions, returns the unsubscribe
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    /// The questions of a session, the same map until they change
    questions(sessionId: string): ReadonlyMap<number, AgentQuestion> {
        return this.sessions.get(sessionId)?.questions ?? NO_QUESTIONS;
    }

    /// Add a question that the agent works on, returns its question id
    add(sessionId: string, question: AgentQuestion): number {
        const questionId = this.nextQuestionId++;
        const session = this.session(sessionId);
        session.working.add(questionId);
        this.setQuestions(sessionId, new Map(session.questions).set(questionId, question));
        return questionId;
    }
    /// Update a question, null drops it
    update(sessionId: string, questionId: number, update: (prev: AgentQuestion) => AgentQuestion | null) {
        const session = this.sessions.get(sessionId);
        const current = session?.questions.get(questionId);
        if (session == null || current == null) return;
        const next = new Map(session.questions);
        const updated = update(current);
        if (updated == null) next.delete(questionId);
        else next.set(questionId, updated);
        this.setQuestions(sessionId, next);
    }
    /// Drop a question
    remove(sessionId: string, questionId: number) {
        const session = this.sessions.get(sessionId);
        if (session == null || !session.questions.has(questionId)) return;
        const next = new Map(session.questions);
        next.delete(questionId);
        this.setQuestions(sessionId, next);
    }

    /// Does the agent work on a question?
    isWorking(sessionId: string, questionId: number): boolean {
        return this.sessions.get(sessionId)?.working.has(questionId) ?? false;
    }
    /// The server queued the turn of a question
    setTurnId(sessionId: string, questionId: number, turnId: string) {
        this.session(sessionId).turnIds.set(questionId, turnId);
    }
    /// The turn of a question, null before the server queued it
    turnId(sessionId: string, questionId: number): string | null {
        return this.sessions.get(sessionId)?.turnIds.get(questionId) ?? null;
    }
    /// The agent stopped working on a question, false if it did not work on it
    finish(sessionId: string, questionId: number): boolean {
        const session = this.sessions.get(sessionId);
        if (session == null) return false;
        session.turnIds.delete(questionId);
        return session.working.delete(questionId);
    }

    /// Forget the questions of a deleted session
    drop(sessionId: string) {
        if (!this.sessions.delete(sessionId)) return;
        for (const listener of this.listeners) listener();
    }

    /// Show a session in a feed, returns the detach
    attach(sessionId: string, feed: AgentQuestionFeed): () => void {
        this.session(sessionId).feed = feed;
        return () => {
            const session = this.sessions.get(sessionId);
            if (session?.feed === feed) session.feed = null;
        };
    }
    /// The feed that shows a session, null while no feed shows it
    feed(sessionId: string): AgentQuestionFeed | null {
        return this.sessions.get(sessionId)?.feed ?? null;
    }
}
