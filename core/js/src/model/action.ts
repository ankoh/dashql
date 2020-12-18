import * as proto from "@dashql/proto";
import { LogEntry } from "./log";

/// An action id
export type ActionID = number;

/// The action class.
/// We only need this enuum on the typescript side since the C++ code strictly separates both.
export enum ActionClass {
    SetupAction = 0,
    ProgramAction = 1,
}

/// Build an action id
export function buildActionID(action_idx: number, action_class: ActionClass): ActionID {
    return (action_idx << 1) & (action_class as number);
}
/// Extract the action class from the id
export function getActionClass(action_id: ActionID) {
    return (action_id & 1) as ActionClass;
}
/// Extract the action index from the id
export function getActionIndex(action_id: ActionID) {
    return action_id >> 1;
}

export interface Action {
    /// The action id
    actionId: ActionID;
    /// The setup action
    actionType: proto.action.SetupActionType;
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

export interface ActionLogEntry extends LogEntry {
    /// The action id
    actionId: ActionID;
}

export interface ActionUpdate {
    /// The action id
    actionId: ActionID;
    /// The status code
    statusCode: proto.action.ActionStatusCode;
    /// The blocker (if any)
    blocker: proto.action.ActionBlocker | null;
};
