import * as proto from "@dashql/proto";

export interface Action {
    /// The setup action
    actionType: proto.action.SetupActionType;
    /// The status code
    statusCode: proto.action.ActionStatusCode;
    /// The blocker
    blocker: proto.action.ActionBlocker;

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
    /// The time when completed
    timeCompleted: Date | null;
}
