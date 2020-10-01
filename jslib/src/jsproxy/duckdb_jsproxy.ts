export abstract class DuckDBProxy {
    /// The instance
    private instance: EmscriptenModule | null = null;
    /// The loading promise
    private openPromise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private openPromiseResolver: () => void = () => {};

    /// Initialize the module
    protected abstract init(moduleOverrides: Partial<EmscriptenModule>): Promise<EmscriptenModule>;

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
};
