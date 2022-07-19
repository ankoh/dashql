import { Backend, WorkflowBackend, WorkflowFrontend } from './backend';
import * as dashql from '@dashql/dashql-core/dist/wasm';
import { EditOperationVariant } from '../model';

export class WasmWorkflowBackend implements WorkflowBackend {
    async configureDefault(): Promise<void> {
        await dashql.workflowConfigureDefault();
    }
    async createSession(frontend: WorkflowFrontend): Promise<number> {
        return await dashql.workflowCreateSession(frontend);
    }
    async closeSession(session: number): Promise<void> {
        return await dashql.workflowCloseSession(session);
    }
    async updateProgram(session: number, text: string): Promise<void> {
        await dashql.workflowUpdateProgram(session, text);
    }
    async editProgram(session: number, edits: EditOperationVariant[]): Promise<void> {
        const editsJSON = JSON.stringify(edits);
        await dashql.workflowEditProgram(session, editsJSON);
    }
    async runQuery(session: number, text: string): Promise<Uint8Array> {
        return await dashql.workflowRunQuery(session, text);
    }
}

export function createWasmBackend(): Backend {
    return {
        workflow: new WasmWorkflowBackend(),
    };
}
