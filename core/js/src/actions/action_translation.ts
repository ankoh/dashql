import * as proto from "@dashql/proto";
import { SetupAction, ProgramAction } from "./action";
import { Statement } from "../model";

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
export function translateSetupAction(a: proto.action.SetupAction): SetupAction {
    switch (a.actionType()) {
        case SetupActionType.DROP_BLOB:
            return new DropBlobAction(a);
        case SetupActionType.DROP_TABLE:
            return new DropTableAction(a);
        case SetupActionType.DROP_VIEW:
            return new DropViewAction(a);
        case SetupActionType.DROP_VIZ:
            return new DropVizAction(a);
        case SetupActionType.IMPORT_BLOB:
            return new ImportBlobAction(a);
        case SetupActionType.IMPORT_TABLE:
            return new ImportTableAction(a);
        case SetupActionType.IMPORT_VIEW:
            return new ImportViewAction(a);
        case SetupActionType.IMPORT_VIZ:
            return new ImportVizAction(a);
    }
    return new SetupAction(a);
}

/// Translate a program action
export function translateProgramAction(a: proto.action.ProgramAction, s: Statement): ProgramAction {
    switch (a.actionType()) {
        case ProgramActionType.EXTRACT_CSV:
            return new ExtractCSVAction(a, s);
        case ProgramActionType.EXTRACT_JSON:
            return new ExtractJsonAction(a, s);
        case ProgramActionType.LOAD_FILE:
            return new LoadFileAction(a, s);
        case ProgramActionType.LOAD_HTTP:
            return new LoadHTTPAction(a, s);
        case ProgramActionType.PARAMETER:
            return new ParameterAction(a, s);
        case ProgramActionType.TABLE_CREATE:
            return new CreateTableAction(a, s);
        case ProgramActionType.TABLE_MODIFY:
            return new ModifyTableAction(a, s);
        case ProgramActionType.VIEW_CREATE:
            return new ViewCreateAction(a, s);
        case ProgramActionType.VIZ_CREATE:
            return new CreateVizAction(a, s);
        case ProgramActionType.VIZ_UPDATE:
            return new UpdateVizAction(a, s);
    }
    return new ProgramAction(a, s);
}
