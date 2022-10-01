import { BoardPosition } from './board_card';

export type StatementEditOperation = {
    readonly statement_id: number;
    readonly operation: EditOperation;
};

export type EditOperation = SetBoardPosition | SetVegaSpec;

export interface SetBoardPosition {
    t: 'SetBoardPosition';
    v: BoardPosition;
}

export interface SetVegaSpec {
    t: 'SetVegaSpec';
    v: string;
}
