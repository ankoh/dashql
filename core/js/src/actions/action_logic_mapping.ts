import * as proto from "@dashql/proto";
import { ActionID, SetupActionLogic, ProgramActionLogic } from "./action_logic";
import { Statement } from "../model";

import { DropBlobActionLogic } from "./drop_blob_logic";
import { DropTableActionLogic } from "./drop_table_logic";
import { DropViewActionLogic } from "./drop_view_logic";
import { DropVizActionLogic } from "./drop_viz_logic";
import { ImportBlobActionLogic } from "./import_blob_logic";
import { ImportTableActionLogic } from "./import_table_logic";
import { ImportViewActionLogic } from "./import_view_logic";
import { ImportVizActionLogic } from "./import_viz_logic";

import { ExtractCSVActionLogic } from "./extract_csv_logic";
import { ExtractJsonActionLogic } from "./extract_json_logic";
import { LoadFileActionLogic } from "./load_file_logic";
import { LoadHTTPActionLogic } from "./load_http_logic";
import { ParameterActionLogic } from "./parameter_logic";
import { CreateTableActionLogic } from "./table_create_logic";
import { ModifyTableActionLogic } from "./table_modify_logic";
import { ViewCreateActionLogic } from "./view_create_logic";
import { CreateVizActionLogic } from "./viz_create_logic";
import { UpdateVizActionLogic } from "./viz_update_logic";

import SetupActionType = proto.action.SetupActionType;
import ProgramActionType = proto.action.ProgramActionType;

/// Translate a setup action
export function resolveSetupActionLogic(id: ActionID, a: proto.action.SetupAction): SetupActionLogic | null {
    switch (a.actionType()) {
        case SetupActionType.DROP_BLOB:
            return new DropBlobActionLogic(id, a);
        case SetupActionType.DROP_TABLE:
            return new DropTableActionLogic(id, a);
        case SetupActionType.DROP_VIEW:
            return new DropViewActionLogic(id, a);
        case SetupActionType.DROP_VIZ:
            return new DropVizActionLogic(id, a);
        case SetupActionType.IMPORT_BLOB:
            return new ImportBlobActionLogic(id, a);
        case SetupActionType.IMPORT_TABLE:
            return new ImportTableActionLogic(id, a);
        case SetupActionType.IMPORT_VIEW:
            return new ImportViewActionLogic(id, a);
        case SetupActionType.IMPORT_VIZ:
            return new ImportVizActionLogic(id, a);
    }
    return null;
}

/// Translate a program action
export function resolveProgramActionLogic(id: ActionID, a: proto.action.ProgramAction, s: Statement): ProgramActionLogic | null {
    switch (a.actionType()) {
        case ProgramActionType.EXTRACT_CSV:
            return new ExtractCSVActionLogic(id, a, s);
        case ProgramActionType.EXTRACT_JSON:
            return new ExtractJsonActionLogic(id, a, s);
        case ProgramActionType.LOAD_FILE:
            return new LoadFileActionLogic(id, a, s);
        case ProgramActionType.LOAD_HTTP:
            return new LoadHTTPActionLogic(id, a, s);
        case ProgramActionType.PARAMETER:
            return new ParameterActionLogic(id, a, s);
        case ProgramActionType.TABLE_CREATE:
            return new CreateTableActionLogic(id, a, s);
        case ProgramActionType.TABLE_MODIFY:
            return new ModifyTableActionLogic(id, a, s);
        case ProgramActionType.VIEW_CREATE:
            return new ViewCreateActionLogic(id, a, s);
        case ProgramActionType.VIZ_CREATE:
            return new CreateVizActionLogic(id, a, s);
        case ProgramActionType.VIZ_UPDATE:
            return new UpdateVizActionLogic(id, a, s);
    }
    return null;
}
