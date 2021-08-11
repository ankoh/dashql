import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import { proto } from '@dashql/core';
import { SystemCard } from './system_card';
import { TaskStatusIndicator } from './status';
import styles from './task_list.module.css';

function getSetupTaskTypeLabel(type: proto.task.SetupTaskType) {
    switch (type) {
        case proto.task.SetupTaskType.DROP_BLOB:
            return 'DROP BLOB';
        case proto.task.SetupTaskType.DROP_TABLE:
            return 'DROP TABLE';
        case proto.task.SetupTaskType.DROP_VIEW:
            return 'DROP VIEW';
        case proto.task.SetupTaskType.DROP_VIZ:
            return 'DROP VIZ';
        case proto.task.SetupTaskType.IMPORT_BLOB:
            return 'IMPORT BLOB';
        case proto.task.SetupTaskType.IMPORT_TABLE:
            return 'IMPORT TABLE';
        case proto.task.SetupTaskType.IMPORT_VIEW:
            return 'IMPORT VIEW';
        case proto.task.SetupTaskType.IMPORT_VIZ:
            return 'IMPORT VIZ';
        default:
            return '?';
    }
}

function getProgramTaskTypeLabel(type: proto.task.ProgramTaskType) {
    switch (type) {
        case proto.task.ProgramTaskType.LOAD:
            return 'LOAD';
        case proto.task.ProgramTaskType.FETCH:
            return 'FETCH';
        case proto.task.ProgramTaskType.INPUT:
            return 'INPUT';
        case proto.task.ProgramTaskType.CREATE_TABLE:
            return 'CREATE TABLE';
        case proto.task.ProgramTaskType.MODIFY_TABLE:
            return 'MODIFY TABLE';
        case proto.task.ProgramTaskType.CREATE_VIEW:
            return 'CREATE VIEW';
        case proto.task.ProgramTaskType.CREATE_VIZ:
            return 'CREATE VIZ';
        case proto.task.ProgramTaskType.UPDATE_VIZ:
            return 'UPDATE VIZ';
        default:
            return '?';
    }
}

interface Props {
    className?: string;
    onClose: () => void;
}

const renderTasks = (plan: core.model.Plan, planTasks: Immutable.Map<core.model.TaskHandle, core.model.Task>) => {
    const setup_tasks: JSX.Element[] = [];
    const program_tasks: JSX.Element[] = [];
    plan.iterateSetupTasksReverse((i: number, o: proto.task.SetupTask) => {
        const taskId = core.model.buildTaskHandle(i, proto.task.TaskClass.SETUP_TASK);
        const taskInfo = planTasks.get(taskId);
        const status = taskInfo?.statusCode || proto.task.TaskStatusCode.PENDING;
        setup_tasks.push(
            <div key={i} className={styles.task}>
                <div className={styles.task_status}>
                    <TaskStatusIndicator width="12px" height="12px" status={status} />
                </div>
                <div className={styles.task_type}>{getSetupTaskTypeLabel(o.taskType())}</div>
                <div className={styles.task_duration}>0 ms</div>
            </div>,
        );
    });
    plan.iterateProgramTasks((i: number, o: proto.task.ProgramTask) => {
        const taskId = core.model.buildTaskHandle(i, proto.task.TaskClass.PROGRAM_TASK);
        const taskInfo = planTasks.get(taskId);
        const status = taskInfo?.statusCode || proto.task.TaskStatusCode.PENDING;
        program_tasks.push(
            <div key={i} className={styles.task}>
                <div className={styles.task_status}>
                    <TaskStatusIndicator width="12px" height="12px" status={status} />
                </div>
                <div className={styles.task_type}>{getProgramTaskTypeLabel(o.taskType())}</div>
                <div className={styles.task_duration}>0 ms</div>
            </div>,
        );
    });
    return (
        <div className={styles.tasks}>
            {setup_tasks.length > 0 && <div className={styles.setup_tasks}>{setup_tasks}</div>}
            <div className={styles.program_tasks}>{program_tasks}</div>
        </div>
    );
};

export const TaskList: React.FC<Props> = (props: Props) => {
    const { plan, tasks } = core.model.usePlanContext();
    return (
        <SystemCard title="Task" onClose={props.onClose} className={props.className}>
            {plan && renderTasks(plan, tasks)}
        </SystemCard>
    );
};
