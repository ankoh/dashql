import { IpcRenderer } from 'electron';
import { Backend, SessionId, WorkflowFrontend } from './workflow_backend';
import { invokeIPCWorkflowFrontend, createIPCWorkflowFrontendBridge } from './ipc_bridge_to_frontend';
import { IpcMain, WebContents } from 'electron';

export function createIPCBackendBridge(ipc: IpcRenderer): Backend {
    return {
        workflow: {
            configureDefault: async (): Promise<void> => {
                await ipc.invoke('WorkflowBackend.configure');
            },
            createSession: async (frontend: WorkflowFrontend): Promise<SessionId> => {
                const sessionID = await ipc.invoke('WorkflowBackend.createSession', []);
                ipc.on(`WorkflowFrontend.session[${sessionID}]`, (_event, message) => {
                    invokeIPCWorkflowFrontend(frontend, message);
                });
                return sessionID;
            },
            closeSession: async (session: SessionId): Promise<void> => {
                await ipc.invoke('WorkflowBackend.closeSession', session);
                ipc.removeAllListeners(`WorkflowFrontend.session[${session}]`);
            },
            updateProgram: async (session: SessionId, text: string): Promise<void> => {
                await ipc.invoke('WorkflowBackend.updateProgram', session, text);
            },
            runQuery: async (session: SessionId, text: string): Promise<Uint8Array> => {
                return await ipc.invoke('WorkflowBackend.runQuery', session, text);
            },
        },
    };
}

export function registerIPCBackend(backend: Backend, ipc: IpcMain, renderer: WebContents) {
    ipc.on('WorkflowBackend.configure', async _event => {
        return await backend.workflow.configureDefault();
    });
    ipc.on('WorkflowBackend.createSession', async (_event, db) => {
        const workflow = createIPCWorkflowFrontendBridge((session, msg) => {
            renderer.send(`WorkflowFrontend.session[${session}]`, msg);
        });
        return await backend.workflow.createSession(workflow);
    });
    ipc.on('WorkflowBackend.closeSession', async (_event, session) => {
        return await backend.workflow.closeSession(session);
    });
    ipc.on('WorkflowBackend.updateProgram', async (_event, session, text) => {
        return await backend.workflow.updateProgram(session, text);
    });
    ipc.on('WorkflowBackend.runQuery', async (_event, session, text) => {
        return await backend.workflow.runQuery(session, text);
    });
}
