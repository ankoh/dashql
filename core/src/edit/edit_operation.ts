// Copyright (c) 2020 The DashQL Authors

import { flatbuffers } from 'flatbuffers';
import * as proto from '@dashql/proto';

import VizChangePos = proto.edit.VizChangePosition;

export type EditOperation<T, P> = {
    readonly type: T;
    readonly data: P;
};

export enum EditOperationType {
    VIZ_CHANGE_POSITION = 'VIZ_CHANGE_POSITION',
}

interface VizChangeOperation {
    statement_id: number;
    row: number;
    column: number;
    width: number;
    height: number;
}

export type EditOperationVariant =
    | EditOperation<EditOperationType.VIZ_CHANGE_POSITION, VizChangeOperation>
    ;

export function packProgramEdit(builder: flatbuffers.Builder, edits: EditOperationVariant[]): flatbuffers.Offset {
    let editOffsets: flatbuffers.Offset[] = [];
    for (const e of edits) {
        let ofs: flatbuffers.Offset;
        let op: proto.edit.EditOperationVariant;
        switch (e.type) {
            case EditOperationType.VIZ_CHANGE_POSITION: {
                const pos = proto.viz.Position.create(builder, e.data.row, e.data.column, e.data.width, e.data.height);
                VizChangePos.start(builder);
                VizChangePos.addStatementId(builder, e.data.statement_id);
                VizChangePos.addPosition(builder, pos);
                ofs = VizChangePos.end(builder);
                op = proto.edit.EditOperationVariant.VizChangePosition;
                break;
            }
        }
        editOffsets.push(proto.edit.EditOperation.create(builder, op, ofs));
    }
    let editsVec = proto.edit.ProgramEdit.createEditsVector(builder, editOffsets);

    proto.edit.ProgramEdit.start(builder);
    proto.edit.ProgramEdit.addEdits(builder, editsVec);
    return proto.edit.ProgramEdit.end(builder);
    
}
