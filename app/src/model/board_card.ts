export interface BoardPosition {
    row: number;
    column: number;
    width: number;
    height: number;
}

export interface Card {
    title: string;
    position: BoardPosition;
}
