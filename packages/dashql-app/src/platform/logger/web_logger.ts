import { Logger } from '@ankoh/dashql-platform/platform/logger/logger';

export class WebLogger extends Logger {
    constructor() {
        super();
    }

    /// Destroy the logger
    public async destroy(): Promise<void> { }

    /// Helper to flush pending records
    protected flushPendingRecords(): void {
        if (this.pendingRecords.length == 0) {
            return;
        }
        const pending = this.pendingRecords;
        this.pendingRecords = [];
        for (let i = 0; i < pending.length; ++i) {
            const record = pending[i];
            this.outputBuffer.push(record);
        }
    }
};
