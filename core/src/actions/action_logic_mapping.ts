import * as proto from '@dashql/proto';
import { SetupActionLogic, ProgramActionLogic } from './action_logic';
import { ActionHandle, Statement } from '../model';

import { ImportBlobActionLogic, DropBlobActionLogic } from './blob_logic';
import { ExtractCSVActionLogic } from './extract_csv_logic';
import { ExtractJsonActionLogic } from './extract_json_logic';
import { LoadFileActionLogic } from './load_file_logic';
import { LoadHTTPActionLogic } from './load_http_logic';
import { ParameterActionLogic } from './parameter_logic';
import {
    CreateTableActionLogic,
    DropTableActionLogic,
    ModifyTableActionLogic,
    ImportTableActionLogic,
} from './table_logic';
import { UnnamedSelectLogic } from './unnamed_select_logic';
import { ViewCreateActionLogic, ImportViewActionLogic, DropViewActionLogic } from './view_logic';
import { CreateVizActionLogic, DropVizActionLogic, ImportVizActionLogic } from './viz_logic';

import SetupActionType = proto.action.SetupActionType;
import ProgramActionType = proto.action.ProgramActionType;

/// Translate a setup action
export function resolveSetupActionLogic(id: ActionHandle, a: proto.action.SetupAction): SetupActionLogic | null {
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
export function resolveProgramActionLogic(
    id: ActionHandle,
    a: proto.action.ProgramAction,
    s: Statement,
): ProgramActionLogic | null {
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
        case ProgramActionType.CREATE_TABLE:
            return new CreateTableActionLogic(id, a, s);
        case ProgramActionType.MODIFY_TABLE:
            return new ModifyTableActionLogic(id, a, s);
        case ProgramActionType.UNNAMED_SELECT:
            return new UnnamedSelectLogic(id, a, s);
        case ProgramActionType.CREATE_VIEW:
            return new ViewCreateActionLogic(id, a, s);
        case ProgramActionType.CREATE_VIZ:
        case ProgramActionType.UPDATE_VIZ:
            return new CreateVizActionLogic(id, a, s);
    }
    return null;
}
