
// A data column
export class Column {
    name: string;
    loadStringFunc: (index: number) => string;

    constructor(name: string, loadStringFunc: (index: number) => string) {
        this.name = name;
        this.loadStringFunc = loadStringFunc;
    }

    public getName(): string {
        return this.name;
    }

    public getRowAsString(index: number): string {
        return this.loadStringFunc(index);
    }
};

// The data source for the table
export class DataSource {
    columns: Array<Column>;
    rowCount: number;
    timestamp: number;

    constructor() {
        this.columns = new Array<Column>();
        this.rowCount = 0;
        this.timestamp = Date.now();
    }

    public getColumn(index: number): Column {
        return this.columns[index];
    }

    public getColumnCount(): number {
        return this.columns.length;
    }

    public getRowCount(): number {
        return this.rowCount;
    }
};

export class InlineAnyRows extends DataSource {
    data: Array<any>;

    constructor(columns: Array<string>, data: Array<any>) {
        super();
        this.data = data;
        this.rowCount = data.length / columns.length;

        for (let column = 0; column < columns.length; ++column) {
            this.columns.push(
                new Column(columns[column], function (row: number): string {
                    return data[row * columns.length + column]
                })
            );
        }
    }
}
