import * as React from 'react';

import { Logger } from '@akohn/dashql/platform/logger/logger';

/// The logger of a host without a provider: it drops the records
class DroppingLogger extends Logger {
    public destroy(): void { }

    protected flushPendingRecords(): void {
        this.pendingRecords = [];
    }
}

/// The logger of the components, e.g. of a copy to the clipboard. The host provides it, the app with its
/// `LoggerProvider`. Without a provider the components log into nothing.
export const LoggerContext = React.createContext<Logger>(new DroppingLogger());

/// The logger of the host
export function useLogger(): Logger {
    return React.useContext(LoggerContext);
}
