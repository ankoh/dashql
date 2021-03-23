import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb/dist/webdb-async.module';
import { ActionHandle, Statement } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import ActionStatusCode = proto.action.ActionStatusCode;

export class UnnamedSelectLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext) {}

    public async execute(context: ActionContext): Promise<void> {
        const script = this.script;
        if (!script) return;

        const db = context.platform.database;
        await db.use(async (c: webdb.AsyncConnection) => {
            const result = await c.runQuery(script);

            const chunkIter = new webdb.ChunkStreamIterator(c, result);
            while (await chunkIter.nextAsync()) {
                console.log(`rows ${chunkIter.rowCount} columns ${chunkIter.columnCount}`);
                let row = 0;
                for (const v of chunkIter.iterateNumberColumn(0)) {
                    console.log(`[${row++}] ${v}`);
                }
            }
        });
    }
}
