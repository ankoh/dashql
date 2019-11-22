import * as Immutable from 'immutable';
import * as proto from 'tigon-proto';
import { LogController } from './log_ctrl';
import { TaskID, Task, TaskQueue } from './task_queue';
import * as jspb from 'google-protobuf';

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
    public async evalStatement(_module: proto.tql.Module, _statement: number) {
    }

    // Evaluate a program
    public async eval(_module: proto.tql.Module) {
    }

    // Filter a statement list
    public static filterStatements(list: Immutable.List<proto.tql.Statement>, t: proto.tql.Statement.StatementCase, fn: (i: number, m: jspb.Message) => void) {
        let i = 0;
        list.forEach(s => {
            if (s.getStatementCase() != t) {
                return;
            }
            switch (s.getStatementCase()) {
                case proto.tql.Statement.StatementCase.EXTRACT:
                    fn(i++, s.getExtract()!);
                    break;
                case proto.tql.Statement.StatementCase.LOAD:
                    fn(i++, s.getLoad()!);
                    break;
                case proto.tql.Statement.StatementCase.PARAMETER:
                    fn(i++, s.getParameter()!);
                    break;
                case proto.tql.Statement.StatementCase.QUERY:
                    fn(i++, s.getQuery()!);
                    break;
                case proto.tql.Statement.StatementCase.VIZ:
                    fn(i++, s.getViz()!);
                    break;
            }
        });
    }

    // Map a statement list
    public static mapStatements<T extends jspb.Message, V>(list: Immutable.List<proto.tql.Statement>, t: proto.tql.Statement.StatementCase, fn: (i: number, s: T) => V): Array<V> {
        let r = new Array<V>();
        TQLInterpreter.filterStatements(list, t, (i: number, m: jspb.Message) => {
            r.push(fn(i, m as T));
        });
        return r;
    }
}

export default TQLInterpreter;
