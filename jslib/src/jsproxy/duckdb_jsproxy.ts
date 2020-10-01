import { DuckDBModule } from '../duckdb/duckdb_module';

/// A query result.
/// The user has to repeatedly call fetch to retrieve the results.
export class QueryResult {
    /// Fetch the next result chunk
    public async fetch(): Promise<void> {
    }

    /// Print the query result
    public toString(): string {
        return "";
    }
};

/// A query result iterator.
export class QueryResultIterator {

};

/// The proxy for either the browser- order node-based DuckDB API
export abstract class DuckDBProxy {
    /// The instance
    private instance: DuckDBModule | null = null;
    /// The loading promise
    private openPromise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private openPromiseResolver: () => void = () => {};

    /// Initialize the module
    protected abstract init(moduleOverrides: Partial<DuckDBModule>): Promise<DuckDBModule>;

    /// Open the database
    public async open() {
        // Already opened?
        if (this.instance != null)
            return;
        // Open in progress?
        if (this.openPromise != null)
            await this.openPromise;

        // Create a promise that we can await
        this.openPromise = new Promise(resolve => {
            this.openPromiseResolver = resolve;
        });

        // Initialize duckdb
        this.instance = await this.init({
            print: console.log.bind(console),
            printErr: console.log.bind(console),
            onRuntimeInitialized: this.openPromiseResolver,
        });

        // Wait for onRuntimeInitialized
        await this.openPromise;
    }

    /// Get the instance
    protected async getInstance(): Promise<DuckDBModule> {
        if (this.instance != null)
            return this.instance;
        if (this.openPromise != null) {
            await this.openPromise;
            if (this.instance == null)
                throw new Error('instance initialization failed');
            return this.instance;
        }
        throw new Error('instance not initialized');
    }

    // Call a core function with packed response buffer
    protected async callSRet(
        funcName: string,
        argTypes: Array<Emscripten.JSType>,
        args: Array<any>,
    ): Promise<[number, number, number, number]> {
        // Save the stack
        let instance = await this.getInstance();
        let stackPointer = instance.stackSave();

        // Allocate the packed response buffer
        let response = instance.allocate(4 * 8, 'i8', instance.ALLOC_STACK);
        argTypes.unshift('number');
        args.unshift(response);

        // Do the call
        instance.ccall(funcName, null, argTypes, args);

        // Read the response
        // XXX: wasm64 will break here.
        let status = instance.HEAPU32[(response >> 2) + 0];
        let error = instance.HEAPU32[(response >> 2) + 2];
        let data = instance.HEAPU32[(response >> 2) + 4];
        let dataSize = instance.HEAPU32[(response >> 2) + 6];

        // Restore the stack
        instance.stackRestore(stackPointer);
        return [status, error, data, dataSize];
    }

    /// Send a query and return the full result
    public async query(): Promise<QueryResult> {
        return Promise.resolve(new QueryResult());
    }

    /// Send a query and return a result stream
    public async sendQuery(): Promise<QueryResult> {
        return Promise.resolve(new QueryResult());
    }
};
