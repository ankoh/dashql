import * as proto from 'tigon-proto';
import { CoreBuffer } from './core_buffer';
import { LogController } from './log_ctrl';
import TaskQueue from './task_queue';

export class TQLInterpreter {
    protected log: LogController;
    protected taskQueue: TaskQueue;
    protected program: CoreBuffer<proto.tql.TQLProgram> | null;

    // Constructor
    constructor(log: LogController) {
        this.log = log;
        this.program = null;
        this.taskQueue = new TaskQueue();
    }

    // Evaluate a single statement
    public async evalStatement(program: CoreBuffer<proto.tql.TQLProgram>, statement: number) {
    }

    // Evaluate a program
    public async eval(program: CoreBuffer<proto.tql.TQLProgram>) {
    }

}

export default TQLInterpreter;
