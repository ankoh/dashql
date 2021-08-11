// Copyright (c) 2020 The DashQL Authors

import * as proto from '@dashql/proto';
import * as model from '../model';
import * as flatbuffers from 'flatbuffers';

export type EditOperation<T, P> = {
    readonly statementID: number;
    readonly type: T;
    readonly data: P;
};

export enum EditOperationType {
    UPDATE_CARD_POSITION = 'UPDATE_CARD_POSITION',
}

export interface CardPositionUpdate {
    position: model.CardPosition;
}

export type EditOperationVariant = EditOperation<EditOperationType.UPDATE_CARD_POSITION, CardPositionUpdate>;

export function packProgramEdit(builder: flatbuffers.Builder, edits: EditOperationVariant[]): flatbuffers.Offset {
    const editOffsets: flatbuffers.Offset[] = [];
    for (const e of edits) {
        let ofs: flatbuffers.Offset;
        let op: proto.edit.EditOperationVariant;
        const stmt = e.statementID;
        switch (e.type) {
            case EditOperationType.UPDATE_CARD_POSITION: {
                const pos = e.data.position;
                const posOfs = proto.analyzer.CardPosition.createCardPosition(
                    builder,
                    pos.row,
                    pos.column,
                    pos.width,
                    pos.height,
                );
                ofs = proto.edit.CardPositionUpdate.createCardPositionUpdate(builder, posOfs);
                op = proto.edit.EditOperationVariant.CardPositionUpdate;
                break;
            }
        }
        editOffsets.push(proto.edit.EditOperation.createEditOperation(builder, stmt, op, ofs));
    }
    const editsVec = proto.edit.ProgramEdit.createEditsVector(builder, editOffsets);

    proto.edit.ProgramEdit.startProgramEdit(builder);
    proto.edit.ProgramEdit.addEdits(builder, editsVec);
    return proto.edit.ProgramEdit.endProgramEdit(builder);
}
