import * as proto from 'tigon-proto';
import { CoreBuffer } from './core_buffer';
import { LogController } from './log_ctrl';
import { TaskID, Task, TaskQueue } from './task_queue';

class LoadFile extends Task {
};

class LoadHTTP extends Task {
};

class ExtractCSV extends Task {
};

class ExtractJSON extends Task {
};

class RunQuery extends Task {
}


export class TQLInterpreter {
    protected log: LogController;
    protected program: CoreBuffer<proto.tql.TQLProgram> | null;

    protected queuedTasks: TaskQueue;
    protected activeTasks: Array<Task>;
    protected requiredFor: Map<TaskID, Array<TaskID>>;

    // Constructor
    constructor(log: LogController) {
        this.log = log;
        this.program = null;
        this.queuedTasks = new TaskQueue();
        this.activeTasks = new Array();
        this.requiredFor = new Map();
    }

    // Evaluate a single statement
    public async evalStatement(program: CoreBuffer<proto.tql.TQLProgram>, statement: number) {
    }

    // Evaluate a program
    public async eval(program: CoreBuffer<proto.tql.TQLProgram>) {
    }

}

export default TQLInterpreter;
