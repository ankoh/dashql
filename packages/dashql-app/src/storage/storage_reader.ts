import { Logger } from '../platform/logger.js';

export class StorageReader {
    /// The logger
    logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /// Wait until the initial state was restored
    async waitForInitialRestore() {
    }
}
