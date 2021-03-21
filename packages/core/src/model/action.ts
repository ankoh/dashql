import * as proto from '@dashql/proto';
import { LogEntry } from './log';

/// An action id
export type ActionHandle = number;

/// The scheduler status
export enum ActionSchedulerStatus {
    Idle = 0,
    Working = 1,
}

/// Build an action id
export function buildActionHandle(action_idx: number, action_class: proto.action.ActionClass): ActionHandle {
    return (action_idx << 1) | (action_class as number);
}
/// Extract the action class from the id
export function getActionClass(action_id: ActionHandle) {
    return (action_id & 1) as proto.action.ActionClass;
}
/// Extract the action index from the id
export function getActionIndex(action_id: ActionHandle) {
    return action_id >> 1;
}

export interface Action {
    /// The action id
    actionId: ActionHandle;
    /// The setup action
    actionType: proto.action.SetupActionType | proto.action.ProgramActionType;
    /// The status code
    statusCode: proto.action.ActionStatusCode;
    /// The blocker
    blocker: proto.action.ActionBlocker | null;

    /// The dependencies
    dependsOn: Uint32Array;
    /// The dependencies
    requiredFor: Uint32Array;

    /// The origin statement
    originStatement: number | null;
    /// The object id
    objectId: number | null;
    /// The qualified target name
    targetNameQualified: string;
    /// The short target name
    targetNameShort: string;
    /// The script (if any)
    script: string | null;

    /// The time when the action was created
    timeCreated: Date | null;
    /// The time of the first schedule
    timeScheduled: Date | null;
    /// The time of the last update
    timeLastUpdate: Date | null;
}

export interface ActionUpdate {
    /// The action id
    actionId: ActionHandle;
    /// The status code
    statusCode: proto.action.ActionStatusCode;
    /// The blocker (if any)
    blocker: proto.action.ActionBlocker | null;
}
