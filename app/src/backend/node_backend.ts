import { WorkflowBackend, WorkflowFrontend } from './backend';
import * as dashql from '@dashql/dashql-core/node';

export class NodeWorkflowBackend implements WorkflowBackend {
    async configureDefault(): Promise<void> {
        dashql.workflow.configureDefault();
    }
    async createSession(frontend: WorkflowFrontend): Promise<number> {
        return dashql.workflow.createSession(frontend);
    }
    async closeSession(session: number): Promise<void> {
        return new Promise(resolve => dashql.workflow.closeSession(session, resolve));
    }
    async updateProgram(session: number, text: string): Promise<void> {
        dashql.workflow.updateProgram(session, text);
    }
    async runQuery(session: number, text: string): Promise<Uint8Array> {
        return dashql.workflow.runQuery(session, text);
    }
}
