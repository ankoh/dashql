import { IpcRenderer } from 'electron';
import { Backend, ConnectionId, DatabaseId, SessionId, WorkflowFrontend } from './backend_interfaces';
import { invokeIPCWorkflowFrontend, createIPCWorkflowFrontendBridge } from './ipc_bridge_to_frontend';
import { IpcMain, WebContents } from 'electron';

export function createIPCBackendBridge(ipc: IpcRenderer): Backend {
    return {
        database: {
            configure: async (): Promise<void> => {
                await ipc.invoke('DatabaseBackend.configure');
            },
            openDatabase: async (): Promise<DatabaseId> => {
                return await ipc.invoke('DatabaseBackend.openDatabase');
            },
            closeDatabase: async (db: DatabaseId): Promise<void> => {
                await ipc.invoke('DatabaseBackend.closeDatabase', db);
            },
            createConnection: async (db: DatabaseId): Promise<ConnectionId> => {
                return await ipc.invoke('DatabaseBackend.createConnection', db);
            },
            closeConnection: async (conn: ConnectionId): Promise<void> => {
                await ipc.invoke('DatabaseBackend.closeConnection', conn);
            },
            runQuery: async (conn: ConnectionId, text: string): Promise<Uint8Array> => {
                return await ipc.invoke('DatabaseBackend.runQuery', conn, text);
            },
        },
        workflow: {
            configure: async (): Promise<void> => {
                await ipc.invoke('WorkflowBackend.configure');
            },
            createSession: async (db: DatabaseId, frontend: WorkflowFrontend): Promise<SessionId> => {
                const sessionID = await ipc.invoke('WorkflowBackend.createSession', [db]);
                ipc.on(`WorkflowFrontend.session[${sessionID}]`, async (_event, message) => {
                    await invokeIPCWorkflowFrontend(frontend, message);
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
        },
    };
}

export function registerIPCBackend(backend: Backend, ipc: IpcMain, renderer: WebContents) {
    // Link Database backend
    ipc.on('DatabaseBackend.configure', async _event => {
        return await backend.database.configure();
    });
    ipc.on('DatabaseBackend.openDatabase', async _event => {
        return await backend.database.openDatabase();
    });
    ipc.on('DatabaseBackend.closeDatabase', async (_event, db) => {
        return await backend.database.closeDatabase(db);
    });
    ipc.on('DatabaseBackend.createConnection', async (_event, db) => {
        return await backend.database.createConnection(db);
    });
    ipc.on('DatabaseBackend.closeConnection', async (_event, conn) => {
        return await backend.database.closeConnection(conn);
    });
    ipc.on('DatabaseBackend.runQuery', async (_event, conn, text) => {
        return await backend.database.runQuery(conn, text);
    });

    // Link Workflow backend
    ipc.on('WorkflowBackend.configure', async _event => {
        return await backend.workflow.configure();
    });
    ipc.on('WorkflowBackend.createSession', async (_event, db) => {
        const workflow = createIPCWorkflowFrontendBridge(async (session, msg) => {
            renderer.send(`WorkflowFrontend.session[${session}]`, msg);
        });
        return await backend.workflow.createSession(db, workflow);
    });
    ipc.on('WorkflowBackend.closeSession', async (_event, session) => {
        return await backend.workflow.closeSession(session);
    });
    ipc.on('WorkflowBackend.updateProgram', async (_event, session, text) => {
        return await backend.workflow.updateProgram(session, text);
    });
}
