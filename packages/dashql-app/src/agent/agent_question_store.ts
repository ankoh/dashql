import type { ScriptData, WorkbookScripts } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import type { AgentFollowTarget, AgentQuestion } from './use_agent_questions.js';

/// The feed that shows a workbook, it runs and follows the scripts that the agent writes
export interface AgentQuestionFeed {
    /// The current scripts of the workbook
    workbookScripts: () => WorkbookScripts;
    /// Runs a script that the agent wrote
    runScript: (next: WorkbookScripts, scriptData: ScriptData) => void;
    /// Follows the agent to a script
    followScript: (scriptKey: number, target: AgentFollowTarget) => void;
}

/// The questions of a workbook
interface WorkbookAgentQuestions {
    /// The running, failed and answered questions by question id, oldest first
    questions: ReadonlyMap<number, AgentQuestion>;
    /// The questions that the agent works on, notifications of other requests are dropped
    working: Set<number>;
    /// The turns of the questions, once the server queued them
    turnIds: Map<number, string>;
    /// The feed that shows the workbook, null while no feed shows it
    feed: AgentQuestionFeed | null;
}

const NO_QUESTIONS: ReadonlyMap<number, AgentQuestion> = new Map();

/// The questions of the workbooks that the agent answers.
/// The bridge keeps them, a question outlives the feed that asked it and shows again when the user returns to the workbook.
export class AgentQuestionStore {
    private workbooks = new Map<string, WorkbookAgentQuestions>();
    private listeners = new Set<() => void>();
    private nextQuestionId = 1;

    private workbook(workbookId: string): WorkbookAgentQuestions {
        let workbook = this.workbooks.get(workbookId);
        if (workbook == null) {
            workbook = { questions: NO_QUESTIONS, working: new Set(), turnIds: new Map(), feed: null };
            this.workbooks.set(workbookId, workbook);
        }
        return workbook;
    }
    private setQuestions(workbookId: string, questions: ReadonlyMap<number, AgentQuestion>) {
        this.workbook(workbookId).questions = questions;
        for (const listener of this.listeners) listener();
    }

    /// Subscribe to the questions of all workbooks, returns the unsubscribe
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    /// The questions of a workbook, the same map until they change
    questions(workbookId: string): ReadonlyMap<number, AgentQuestion> {
        return this.workbooks.get(workbookId)?.questions ?? NO_QUESTIONS;
    }

    /// Add a question that the agent works on, returns its question id
    add(workbookId: string, question: AgentQuestion): number {
        const questionId = this.nextQuestionId++;
        const workbook = this.workbook(workbookId);
        workbook.working.add(questionId);
        this.setQuestions(workbookId, new Map(workbook.questions).set(questionId, question));
        return questionId;
    }
    /// Update a question, null drops it
    update(workbookId: string, questionId: number, update: (prev: AgentQuestion) => AgentQuestion | null) {
        const workbook = this.workbooks.get(workbookId);
        const current = workbook?.questions.get(questionId);
        if (workbook == null || current == null) return;
        const next = new Map(workbook.questions);
        const updated = update(current);
        if (updated == null) next.delete(questionId);
        else next.set(questionId, updated);
        this.setQuestions(workbookId, next);
    }
    /// Drop a question
    remove(workbookId: string, questionId: number) {
        const workbook = this.workbooks.get(workbookId);
        if (workbook == null || !workbook.questions.has(questionId)) return;
        const next = new Map(workbook.questions);
        next.delete(questionId);
        this.setQuestions(workbookId, next);
    }

    /// Does the agent work on a question?
    isWorking(workbookId: string, questionId: number): boolean {
        return this.workbooks.get(workbookId)?.working.has(questionId) ?? false;
    }
    /// The server queued the turn of a question
    setTurnId(workbookId: string, questionId: number, turnId: string) {
        this.workbook(workbookId).turnIds.set(questionId, turnId);
    }
    /// The turn of a question, null before the server queued it
    turnId(workbookId: string, questionId: number): string | null {
        return this.workbooks.get(workbookId)?.turnIds.get(questionId) ?? null;
    }
    /// The agent stopped working on a question, false if it did not work on it
    finish(workbookId: string, questionId: number): boolean {
        const workbook = this.workbooks.get(workbookId);
        if (workbook == null) return false;
        workbook.turnIds.delete(questionId);
        return workbook.working.delete(questionId);
    }

    /// Forget the questions of a deleted workbook
    drop(workbookId: string) {
        if (!this.workbooks.delete(workbookId)) return;
        for (const listener of this.listeners) listener();
    }

    /// Show a workbook in a feed, returns the detach
    attach(workbookId: string, feed: AgentQuestionFeed): () => void {
        this.workbook(workbookId).feed = feed;
        return () => {
            const workbook = this.workbooks.get(workbookId);
            if (workbook?.feed === feed) workbook.feed = null;
        };
    }
    /// The feed that shows a workbook, null while no feed shows it
    feed(workbookId: string): AgentQuestionFeed | null {
        return this.workbooks.get(workbookId)?.feed ?? null;
    }
}
