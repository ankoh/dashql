export interface CardPosition {
    readonly row: number;
    readonly column: number;
    readonly width: number;
    readonly height: number;
}

export interface CardSpecification {
    readonly position: CardPosition;
}
