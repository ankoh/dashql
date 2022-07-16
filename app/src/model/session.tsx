import * as proto from '@dashql/dashql-proto';
import { TaskGraph } from './task_graph';
import * as imm from 'immutable';
import { TaskStatus } from './task_status';

export type TaskId = number;

export interface SessionStore {
    sessionId: number | null;
    programText: string | null;
    program: proto.Program | null;
    taskGraph: TaskGraph | null;
    taskStatusById: imm.Map<TaskId, TaskStatus>;
}
