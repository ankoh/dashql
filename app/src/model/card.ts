import { CardRenderer } from './card_renderer';

export interface CardPosition {
    row: number;
    column: number;
    width: number;
    height: number;
}

export interface Card {
    title: string;
    position: CardPosition;
    renderer?: CardRenderer;
}
