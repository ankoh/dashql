import * as proto from "@dashql/proto";
import { SetupAction, ProgramAction } from "./action";
import { Statement, Program } from "../model";
import { DropBlobAction } from "./drop_blob";
import { DropTableAction } from "./drop_table";
import { DropViewAction } from "./drop_view";
import { DropVizAction } from "./drop_viz";
import { ImportBlobAction } from "./import_blob";
import { ImportTableAction } from "./import_table";
import { ImportViewAction } from "./import_view";
import { ImportVizAction } from "./import_viz";

/// Translate a setup action
export function translateSetupAction(p: Program, a: proto.action.SetupAction): SetupAction {
    switch (a.actionType()) {
        case proto.action.SetupActionType.DROP_BLOB:
            return new DropBlobAction(p);
        case proto.action.SetupActionType.DROP_TABLE:
            return new DropTableAction(p);
        case proto.action.SetupActionType.DROP_VIEW:
            return new DropViewAction(p);
        case proto.action.SetupActionType.DROP_VIZ:
            return new DropVizAction(p);
        case proto.action.SetupActionType.IMPORT_BLOB:
            return new ImportBlobAction(p);
        case proto.action.SetupActionType.IMPORT_TABLE:
            return new ImportTableAction(p);
        case proto.action.SetupActionType.IMPORT_VIEW:
            return new ImportViewAction(p);
        case proto.action.SetupActionType.IMPORT_VIZ:
            return new ImportVizAction(p);
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
