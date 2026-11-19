import * as React from 'react';

import type { Logger } from '@akohn/dashql/platform/logger/logger';

/// The logger of the components, e.g. of a copy to the clipboard. The host provides it, the app with its
/// `LoggerProvider`.
export const LoggerContext = React.createContext<Logger | null>(null);

/// The logger of the host. A component outside of a provider gets none and must not log.
export function useLogger(): Logger {
    return React.useContext(LoggerContext)!;
}
