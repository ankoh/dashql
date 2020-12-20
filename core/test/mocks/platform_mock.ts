import { platform, model } from '../../src/index_node';
import { mock, instance } from 'ts-mockito';

export class PlatformMock {
    /// The global application state
    public state: model.DerivedReduxStore;
    /// The core wasm api
    public coreWasm: platform.CoreWasmAPI;
    /// The database manager
    public databaseManager: platform.DatabaseManager;
    /// The file manager
    public fileManager: platform.FileManager;
    /// The HTTP manager
    public httpManager: platform.HTTPManager;

    constructor(store: model.DerivedReduxStore) {
        this.state = store;
        this.coreWasm = mock({} as platform.CoreWasmAPI);
        this.databaseManager = mock(platform.DatabaseManager);
        this.fileManager = mock(platform.FileManager);
        this.httpManager = mock(platform.HTTPManager);
    }

    getInstance(): platform.Platform {
        return new platform.Platform(
            this.state,
            instance(this.coreWasm),
            instance(this.databaseManager),
            instance(this.fileManager),
            instance(this.httpManager)
        );
    }
}
