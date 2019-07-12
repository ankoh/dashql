import * as proto from '../proto';
import { flatbuffers } from 'flatbuffers';
import { CoreAPI, QueryResult } from './core_api';

/// The core controller
export class CoreController {
    /// The api
    api: CoreAPI;

    /// Constructor
    constructor() {
        this.api = new CoreAPI();
    }

    /// Initialize the core controller
    public init() {
        this.api.init();
    }

    /// Run a query
    public runQuery(text: string): QueryResult {
        return this.api.runQuery(text);
    }
};
