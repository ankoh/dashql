import * as React from 'react';

import { Logger } from './logger.js';
import { isNativePlatform } from './native_globals.js';
import { NativeLogger } from './native_logger.js';
import { WebLogger } from './web_logger.js';

const LOGGER_CTX = React.createContext<Logger | null>(null);
let GLOBAL_LOGGER: Logger | null;
export function getGlobalLogger(): Logger | null { return GLOBAL_LOGGER; }

export const useLogger = () => React.useContext(LOGGER_CTX)!;

type Props = {
    children: React.ReactElement | React.ReactElement[];
};

export const LoggerProvider: React.FC<Props> = (props: Props) => {
    const logger = React.useMemo<Logger>(() => {
        let logger: Logger = isNativePlatform() ? new NativeLogger() : new WebLogger();
        GLOBAL_LOGGER = logger;
        return logger;
    }, []);
    return (
        <LOGGER_CTX.Provider value={logger}>
            {props.children}
        </LOGGER_CTX.Provider>
    )
};

/// Poll the log version and translate into React state.
/// We deliberately do not use eager state updates from the log flusher.
export function pollLogVersion(interval: number = 100) {
    const logger = useLogger();
    const [logVersion, setLogVersion] = React.useState<number>(logger.buffer.version);
    React.useEffect(() => {
        const intervalId = setInterval(() => {
            if (logger.buffer.version !== logVersion) {
                setLogVersion(logger.buffer.version);
            }
        }, interval);
        return () => {
            clearInterval(intervalId);
        };
    }, []);
    return logVersion;
}
