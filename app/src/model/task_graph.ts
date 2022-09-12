export enum TaskType {
    None = 0,
    CreateAs = 1,
    CreateTable = 2,
    CreateView = 3,
    CreateViz = 4,
    Declare = 5,
    DropBlob = 6,
    DropInput = 7,
    DropTable = 8,
    DropView = 9,
    DropViz = 10,
    Import = 11,
    Load = 12,
    ModifyTable = 13,
    Set = 14,
    Unset = 15,
    UpdateViz = 16,
}

export interface Task {
    task_type: TaskType;
    task_status: number;
    depends_on: number[];
    required_for: number[];
    origin_statement: number | undefined;
    state_id: number;
}

export interface TaskGraph {
    instance_id: number;
    next_state_id: number;
    tasks: Task[];
    task_by_statement: number[];
}
