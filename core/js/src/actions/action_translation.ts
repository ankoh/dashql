import * as proto from "@dashql/proto";
import { ActionID, SetupAction, ProgramAction } from "./action";
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
export function translateSetupAction(id: ActionID, a: proto.action.SetupAction): SetupAction | null {
    switch (a.actionType()) {
        case SetupActionType.DROP_BLOB:
            return new DropBlobAction(id, a);
        case SetupActionType.DROP_TABLE:
            return new DropTableAction(id, a);
        case SetupActionType.DROP_VIEW:
            return new DropViewAction(id, a);
        case SetupActionType.DROP_VIZ:
            return new DropVizAction(id, a);
        case SetupActionType.IMPORT_BLOB:
            return new ImportBlobAction(id, a);
        case SetupActionType.IMPORT_TABLE:
            return new ImportTableAction(id, a);
        case SetupActionType.IMPORT_VIEW:
            return new ImportViewAction(id, a);
        case SetupActionType.IMPORT_VIZ:
            return new ImportVizAction(id, a);
    }
    return null;
}

/// Translate a program action
export function translateProgramAction(id: ActionID, a: proto.action.ProgramAction, s: Statement): ProgramAction | null {
    switch (a.actionType()) {
        case ProgramActionType.EXTRACT_CSV:
            return new ExtractCSVAction(id, a, s);
        case ProgramActionType.EXTRACT_JSON:
            return new ExtractJsonAction(id, a, s);
        case ProgramActionType.LOAD_FILE:
            return new LoadFileAction(id, a, s);
        case ProgramActionType.LOAD_HTTP:
            return new LoadHTTPAction(id, a, s);
        case ProgramActionType.PARAMETER:
            return new ParameterAction(id, a, s);
        case ProgramActionType.TABLE_CREATE:
            return new CreateTableAction(id, a, s);
        case ProgramActionType.TABLE_MODIFY:
            return new ModifyTableAction(id, a, s);
        case ProgramActionType.VIEW_CREATE:
            return new ViewCreateAction(id, a, s);
        case ProgramActionType.VIZ_CREATE:
            return new CreateVizAction(id, a, s);
        case ProgramActionType.VIZ_UPDATE:
            return new UpdateVizAction(id, a, s);
    }
    return null;
}
