import { Backend, WorkflowBackend, WorkflowFrontend } from './backend';
import * as dashql from '@dashql/dashql-core/dist/node';
import { StatementEditOperation } from '../model';

export class NodeWorkflowBackend implements WorkflowBackend {
    async configureDefault(): Promise<void> {
        dashql.workflow.configureDefault();
    }
    async createSession(frontend: WorkflowFrontend): Promise<number> {
        return dashql.workflow.createSession(frontend);
    }
    async closeSession(session: number): Promise<void> {
        return new Promise(resolve => dashql.workflow.closeSession(resolve, session));
    }
    async updateProgram(session: number, text: string): Promise<void> {
        return new Promise(resolve => dashql.workflow.updateProgram(resolve, session, text));
    }
    async executeProgram(session: number): Promise<void> {
        return new Promise(resolve => dashql.workflow.executeProgram(resolve, session));
    }
    async editProgram(session: number, edits: StatementEditOperation[]): Promise<void> {
        const editsJSON = JSON.stringify(edits);
        return new Promise(resolve => dashql.workflow.editProgram(resolve, session, editsJSON));
    }
    async runQuery(session: number, text: string): Promise<Uint8Array> {
        return dashql.workflow.runQuery(session, text);
    }
}

export function createNodeBackend(): Backend {
    return {
        workflow: new NodeWorkflowBackend(),
    };
}