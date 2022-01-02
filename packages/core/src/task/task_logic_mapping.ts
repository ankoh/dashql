// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import { SetupTaskLogic, ProgramTaskLogic } from './task_logic';
import { TaskHandle, Statement } from '../model';

import { DropBlobTaskLogic } from './blob_logic';
import { LoadTaskLogic } from './load_logic';
import { FetchTaskLogic } from './fetch_logic';
import { TransformTaskLogic } from './transform_logic';
import { InputTaskLogic, DropInputTaskLogic } from './input_logic';
import { CreateTableTaskLogic, DropTableTaskLogic, ModifyTableTaskLogic } from './table_logic';
import { ViewCreateTaskLogic, DropViewTaskLogic } from './view_logic';
import { CreateVizTaskLogic, UpdateVizTaskLogic, DropVizTaskLogic } from './viz_logic';

import SetupTaskType = proto.task.SetupTaskType;
import ProgramTaskType = proto.task.ProgramTaskType;

/// Translate a setup task
export function resolveSetupTaskLogic(id: TaskHandle, a: proto.task.SetupTask): SetupTaskLogic | null {
    switch (a.taskType()) {
        case SetupTaskType.DROP_INPUT:
            return new DropInputTaskLogic(id, a);
        case SetupTaskType.DROP_BLOB:
            return new DropBlobTaskLogic(id, a);
        case SetupTaskType.DROP_TABLE:
            return new DropTableTaskLogic(id, a);
        case SetupTaskType.DROP_VIEW:
            return new DropViewTaskLogic(id, a);
        case SetupTaskType.DROP_VIZ:
            return new DropVizTaskLogic(id, a);
    }
    console.error('unknown setup task type');
    return null;
}

/// Translate a program task
export function resolveProgramTaskLogic(
    id: TaskHandle,
    a: proto.task.ProgramTask,
    s: Statement,
): ProgramTaskLogic | null {
    switch (a.taskType()) {
        case ProgramTaskType.LOAD:
            return new LoadTaskLogic(id, a, s);
        case ProgramTaskType.FETCH:
            return new FetchTaskLogic(id, a, s);
        case ProgramTaskType.TRANSFORM:
            return new TransformTaskLogic(id, a, s);
        case ProgramTaskType.INPUT:
            return new InputTaskLogic(id, a, s);
        case ProgramTaskType.CREATE_TABLE:
            return new CreateTableTaskLogic(id, a, s);
        case ProgramTaskType.MODIFY_TABLE:
            return new ModifyTableTaskLogic(id, a, s);
        case ProgramTaskType.CREATE_VIEW:
            return new ViewCreateTaskLogic(id, a, s);
        case ProgramTaskType.CREATE_VIZ:
            return new CreateVizTaskLogic(id, a, s);
        case ProgramTaskType.UPDATE_VIZ:
            return new UpdateVizTaskLogic(id, a, s);
    }
    console.error(a.taskType());
    console.error('unknown program task type');
    return null;
}
