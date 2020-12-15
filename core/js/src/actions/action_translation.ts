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

import SetupActionType = proto.action.SetupActionType;
import ProgramActionType = proto.action.ProgramActionType;

/// Translate a setup action
export function translateSetupAction(a: proto.action.SetupAction, p: Program): SetupAction {
    switch (a.actionType()) {
        case SetupActionType.DROP_BLOB:
            return new DropBlobAction(a, p);
        case SetupActionType.DROP_TABLE:
            return new DropTableAction(a, p);
        case SetupActionType.DROP_VIEW:
            return new DropViewAction(a, p);
        case SetupActionType.DROP_VIZ:
            return new DropVizAction(a, p);
        case SetupActionType.IMPORT_BLOB:
            return new ImportBlobAction(a, p);
        case SetupActionType.IMPORT_TABLE:
            return new ImportTableAction(a, p);
        case SetupActionType.IMPORT_VIEW:
            return new ImportViewAction(a, p);
        case SetupActionType.IMPORT_VIZ:
            return new ImportVizAction(a, p);
    }
    return new SetupAction(a, p);
}

/// Translate a program action
export function translateProgramAction(a: proto.action.ProgramAction, p: Program): ProgramAction {
    const stmt = p.getStatement(a.originStatement());
    switch (a.actionType()) {
        case ProgramActionType.EXTRACT_CSV:
            return new ExtractCSVAction(a, p, stmt);
        case ProgramActionType.EXTRACT_JSON:
            return new ExtractJsonAction(a, p, stmt);
        case ProgramActionType.LOAD_FILE:
            return new LoadFileAction(a, p, stmt);
        case ProgramActionType.LOAD_HTTP:
            return new LoadHTTPAction(a, p, stmt);
        case ProgramActionType.PARAMETER:
            return new ParameterAction(a, p, stmt);
        case ProgramActionType.TABLE_CREATE:
            return new CreateTableAction(a, p, stmt);
        case ProgramActionType.TABLE_MODIFY:
            return new ModifyTableAction(a, p, stmt);
        case ProgramActionType.VIEW_CREATE:
            return new ViewCreateAction(a, p, stmt);
        case ProgramActionType.VIZ_CREATE:
            return new CreateVizAction(a, p, stmt);
        case ProgramActionType.VIZ_UPDATE:
            return new UpdateVizAction(a, p, stmt);
    }
    return new ProgramAction(a, p, stmt);
}
