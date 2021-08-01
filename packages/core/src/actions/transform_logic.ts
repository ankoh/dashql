import * as proto from '@dashql/proto';
import * as model from '../model';
import { ActionHandle, Statement, UniqueBlob } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

interface TransformOptions {
    expression?: string;
}

export class TransformActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(context: ActionContext): void {}
    public willExecute(_context: ActionContext): void {}

    public async execute(context: ActionContext): Promise<void> {
        const instance = context.plan.programInstance;
        const stmtId = this._origin.statementId;
        const transform = instance.transformStatements.get(stmtId);
        if (!transform) throw new Error(`missing information for transform statement ${stmtId}`);

        // Find the loaded blob
        const state = context.platform.store.getState();
        const planState = state.core.planState;
        const blobName = transform.dataSource();
        const blobID = planState.blobsByName.get(blobName);

        // Parse transform options
        const extra = JSON.parse(transform.extra()) as TransformOptions;

        // Evaluate a jmespath
        const blob = planState.objects.get(blobID) as UniqueBlob;
        const buffer = new Uint8Array(await blob.blob.arrayBuffer());
        const jp = await context.platform.resolveJMESPath();
        const result = await jp.evaluateUTF8(extra.expression || '.', buffer);
        const resultBlob = new Blob([result]);

        // Register the file handle in DuckDB
        const name = this.buffer.nameQualified();
        const db = context.platform.database;
        await db.use(async c => await c.instance.registerFileHandle(name, resultBlob));

        // Build the plan object
        const now = new Date();
        const obj: UniqueBlob = {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.UNIQUE_BLOB,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: name || '',
            blob: resultBlob,
            archiveMode: proto.analyzer.ArchiveMode.NONE,
        };

        // Store as plan object
        const store = context.platform.store;
        model.mutate(store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [obj],
        });
    }
}
