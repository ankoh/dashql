/// A grid element
export default class GridElement {
    /// The column start
    columns: [number, number];
    /// The row start
    rows: [number, number];

    /// Constructor
    constructor(columns: [number, number], rows: [number, number]) {
        this.columns = columns;
        this.rows = rows;
    }

    get cssColumnsBegin() {
        return this.columns[0] + 1;
    }

    get cssColumnsEnd() {
        return this.columns[1] + 1;
    }

    get cssRowsBegin() {
        return this.rows[0] + 1;
    }

    get cssRowsEnd() {
        return this.rows[1] + 1;
    }

    get cssArea(): string {
        return (
            this.cssRowsBegin +
            ' / ' +
            this.cssColumnsBegin +
            ' / ' +
            this.cssRowsEnd +
            ' / ' +
            this.cssColumnsEnd
        );
    }
}
