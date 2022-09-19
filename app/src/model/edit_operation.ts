import { CardPosition } from './card';

export type EditOperation<T, P> = {
    readonly statementID: number;
    readonly type: T;
    readonly data: P;
};

export enum EditOperationType {
    UPDATE_CARD_POSITION = 'UPDATE_CARD_POSITION',
}

export interface CardPositionUpdate {
    position: CardPosition;
}

export type EditOperationVariant = EditOperation<EditOperationType.UPDATE_CARD_POSITION, CardPositionUpdate>;
