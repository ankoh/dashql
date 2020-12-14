import * as proto from "@dashql/proto";
import { SetupAction, ProgramAction } from "./action";
import { Statement, Program } from "../model";

/// Translate a setup action
export function translateSetupAction(p: Program, a: proto.action.SetupAction): SetupAction {
    switch (a.actionType()) {
        case proto.action.SetupActionType.DROP_BLOB:
            break;
        case proto.action.SetupActionType.DROP_TABLE:
            break;
        case proto.action.SetupActionType.DROP_VIEW:
            break;
        case proto.action.SetupActionType.DROP_VIZ:
            break;
        case proto.action.SetupActionType.IMPORT_BLOB:
            break;
        case proto.action.SetupActionType.IMPORT_TABLE:
            break;
        case proto.action.SetupActionType.IMPORT_VIEW:
            break;
        case proto.action.SetupActionType.IMPORT_VIZ:
            break;
    }
    return new SetupAction(p);
}

/// Translate a program action
export function translateProgramAction(p: Program, a: proto.action.ProgramAction): ProgramAction {
    switch (a.actionType()) {
        case proto.action.ProgramActionType.EXTRACT_CSV:
            break;
        case proto.action.ProgramActionType.EXTRACT_JSON:
            break;
        case proto.action.ProgramActionType.LOAD_FILE:
            break;
        case proto.action.ProgramActionType.LOAD_HTTP:
            break;
        case proto.action.ProgramActionType.PARAMETER:
            break;
        case proto.action.ProgramActionType.TABLE_CREATE:
            break;
        case proto.action.ProgramActionType.TABLE_MODIFY:
            break;
        case proto.action.ProgramActionType.VIEW_CREATE:
            break;
        case proto.action.ProgramActionType.VIZ_CREATE:
            break;
        case proto.action.ProgramActionType.VIZ_UPDATE:
            break;
    }
    const stmt = p.getStatement(a.originStatement());
    return new ProgramAction(p, stmt);
}
