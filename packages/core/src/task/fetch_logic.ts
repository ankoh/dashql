import * as proto from '@dashql/proto';
import * as model from '../model';
import { TaskHandle, Statement, UniqueBlob } from '../model';
import { ProgramTaskLogic } from './task_logic';
import { TaskContext } from './task_context';

export class FetchTaskLogic extends ProgramTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, statement: Statement) {
        super(task_id, task, statement);
    }

    public prepare(_context: TaskContext): void {}
    public willExecute(_context: TaskContext): void {}

    /// Fetch via HTTP
    protected async fetchHTTP(
        context: TaskContext,
        url: string,
        headers?: Record<string, string>,
    ): Promise<ArrayBuffer | null> {
        const http = context.platform.http;
        try {
            const resp = await http.request({
                url,
                headers,
            });
            return resp.response.data;
        } catch (e) {
            return null;
        }
    }

    public async execute(context: TaskContext): Promise<void> {
        const instance = context.plan.programInstance;
        const stmtId = this._origin.statementId;
        const fetch = instance.fetchStatements.get(stmtId);
        if (!fetch) {
            console.warn(`missing information for fetch statement ${stmtId}`);
            return;
        }

        // Fetch the Blob
        let blob: Blob | null;
        switch (fetch.method()) {
            case proto.syntax.FetchMethodType.HTTP: {
                const extra = JSON.parse(fetch.extra()) as any;
                const buffer = await this.fetchHTTP(context, fetch.url(), extra.headers);
                blob = new Blob([buffer]);
                break;
            }
            default:
                console.error('not implemented');
                // XXX
                return;
        }
        if (!blob) {
            this.status = proto.task.TaskStatusCode.FAILED;
            return;
        }

        // Register as blob in database
        const db = context.platform.database;
        const name = this.buffer.nameQualified();

        // Register the file handle
        await db.use(async c => await c.instance.registerFileHandle(name, blob));

        // Create plan object
        const now = new Date();
        const blobRef: UniqueBlob = {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.UNIQUE_BLOB,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: name || '',
            blob,
            archiveMode: fetch.archive(),
        };

        // Store as plan object
        const store = context.platform.store;
        model.mutate(store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [blobRef],
        });
    }
}
