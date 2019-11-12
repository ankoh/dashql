import * as Immutable from 'immutable';
import * as proto from 'tigon-proto';
import { CoreBuffer } from '../model';
import { LogController } from './log_ctrl';
import { TaskID, Task, TaskQueue } from './task_queue';

// Get the statement type
function getStatementType<T extends flatbuffers.Table>(s: T): proto.tql.TQLStatement {
    return s instanceof proto.tql.TQLQueryStatement ? proto.tql.TQLStatement.TQLQueryStatement :
        s instanceof proto.tql.TQLDisplayStatement ? proto.tql.TQLStatement.TQLDisplayStatement :
        s instanceof proto.tql.TQLExtractStatement ? proto.tql.TQLStatement.TQLExtractStatement :
        s instanceof proto.tql.TQLLoadStatement ? proto.tql.TQLStatement.TQLLoadStatement :
        s instanceof proto.tql.TQLParameterDeclaration ? proto.tql.TQLStatement.TQLParameterDeclaration
        : proto.tql.TQLStatement.NONE;
}


export class TQLInterpreter {
    protected log: LogController;

    protected queuedTasks: TaskQueue;
    protected activeTasks: Array<Task>;
    protected requiredFor: Map<TaskID, Array<TaskID>>;

    // Constructor
    constructor(log: LogController) {
        this.log = log;
        this.queuedTasks = new TaskQueue();
        this.activeTasks = new Array();
        this.requiredFor = new Map();
    }

    // Evaluate a single statement
    public async evalStatement(_module: CoreBuffer<proto.tql.TQLModule>, _statement: number) {
    }

    // Evaluate a program
    public async eval(_module: CoreBuffer<proto.tql.TQLModule>) {
    }

    // Iterate over statements
    public static forEachStatement<T extends flatbuffers.Table>(module: CoreBuffer<proto.tql.TQLModule>, obj: T, fn: (i: number, o: T) => void) {
        let reader = module.getReader();
        let filteredType = getStatementType(obj);
        for (let i = 0; i < reader.statementsLength(); ++i) {
            if (reader.statementsType(i)! != filteredType) {
                continue;
            }
            let o = reader.statements(i, obj)!;
            fn(i, o);
        }
    }

    // Map statements in module list
    public static mapStatementsInModuleList<T extends flatbuffers.Table, V>(list: Immutable.List<CoreBuffer<proto.tql.TQLModule>>, obj: T, fn: (i: number, o: T) => V): Array<V> {
        let i = 0;
        let r = new Array<V>();
        list.forEach(m => this.forEachStatement(m, obj, (_, o) => r.push(fn(i++, o))));
        return r;
    }
}

export default TQLInterpreter;
