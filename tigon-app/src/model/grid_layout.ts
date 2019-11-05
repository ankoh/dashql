/// A length unit in the grid
export enum GridLengthUnit {
    FRACTIONAL,
    PIXEL,
    EM,
    AUTO,
    MIN_CONTENT,
    MAX_CONTENT,
    MIN_MAX
};

/// A grid length
export class GridLength {
    /// The value
    value: number;
    /// The unit
    unit: GridLengthUnit;

    /// Constructor
    constructor(value: number, unit: GridLengthUnit) {
        this.value = value;
        this.unit = unit;
    }
};

/// A grid element
export class GridElement {
    /// The column start
    columns: [number, number];
    /// The row start
    rows: [number, number];

    /// Constructor
    constructor(columns: [number, number], rows: [number, number]) {
        this.columns = columns;
        this.rows = rows;
    }
};

/// A grid layout
export class GridLayout {
    /// The columns
    columns: Array<GridLength>;
    /// The rows
    rows: Array<GridLength>;
    /// The gaps
    gaps: [GridLength, GridLength] | null;

    /// Constructor
    constructor() {
        this.columns = new Array();
        this.rows = new Array();
        this.gaps = null;
    }
};
