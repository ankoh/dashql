import { platform, model } from '../../src/index_node';
import { mock, instance } from 'ts-mockito';

export class PlatformMock {
    /// The global application state
    public readonly state: model.DerivedReduxStore;
    /// The core wasm api
    public readonly coreWasm: platform.CoreWasmAPI;
    /// The database manager
    public readonly databaseManager: platform.DatabaseManager;
    /// The file manager
    public readonly fileManager: platform.FileManager;
    /// The HTTP manager
    public readonly httpManager: platform.HTTPManager;

    constructor(store: model.DerivedReduxStore = model.createStore()) {
        this.state = store;
        this.coreWasm = mock({} as platform.CoreWasmAPI);
        this.databaseManager = new platform.DatabaseManager();
        this.fileManager = new platform.FileManager(store);
        this.httpManager = new platform.HTTPManager(store);
    }

    getInstance(): platform.Platform {
        return new platform.Platform(
            this.state,
            instance(this.coreWasm),
            this.databaseManager,
            this.fileManager,
            this.httpManager
        );
    }
}
