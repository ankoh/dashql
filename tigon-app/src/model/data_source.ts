
export class Column {
    key: string;
    name: string;

    constructor(key: string, name: string) {
        this.key = key;
        this.name = name;
    }
};

// The data source for the table
export class DataSource {
    columns: Array<Column>;
    inline_data: Array<any>;
    timestamp: number;

    constructor(inline_data: Array<any>) {
        this.columns = new Array<Column>();
        this.inline_data = inline_data;
        this.timestamp = Date.now();
    }

    public getData(): Array<any> {
        return this.inline_data;
    }
};
