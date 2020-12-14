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

import { ExtractCSVAction } from "./extract_csv";
import { ExtractJsonAction } from "./extract_json";
import { LoadFileAction } from "./load_file";
import { LoadHTTPAction } from "./load_http";
import { ParameterAction } from "./parameter";
import { CreateTableAction } from "./table_create";
import { ModifyTableAction } from "./table_modify";
import { ViewCreateAction } from "./view_create";
import { CreateVizAction } from "./viz_create";
import { UpdateVizAction } from "./viz_update";

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
    const stmt = p.getStatement(a.originStatement());
    switch (a.actionType()) {
        case proto.action.ProgramActionType.EXTRACT_CSV:
            return new ExtractCSVAction(p, stmt);
        case proto.action.ProgramActionType.EXTRACT_JSON:
            return new ExtractJsonAction(p, stmt);
        case proto.action.ProgramActionType.LOAD_FILE:
            return new LoadFileAction(p, stmt);
        case proto.action.ProgramActionType.LOAD_HTTP:
            return new LoadHTTPAction(p, stmt);
        case proto.action.ProgramActionType.PARAMETER:
            return new ParameterAction(p, stmt);
        case proto.action.ProgramActionType.TABLE_CREATE:
            return new CreateTableAction(p, stmt);
        case proto.action.ProgramActionType.TABLE_MODIFY:
            return new ModifyTableAction(p, stmt);
        case proto.action.ProgramActionType.VIEW_CREATE:
            return new ViewCreateAction(p, stmt);
        case proto.action.ProgramActionType.VIZ_CREATE:
            return new CreateVizAction(p, stmt);
        case proto.action.ProgramActionType.VIZ_UPDATE:
            return new UpdateVizAction(p, stmt);
    }
    return new ProgramAction(p, stmt);
}
