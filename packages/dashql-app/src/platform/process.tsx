import * as React from 'react';
import { Logger } from './logger/logger.js';
import { useLogger } from './logger/logger_provider.js';

export interface ProcessApi {
    relaunch(): Promise<void>;
}

class WebProcess implements ProcessApi {
    logger: Logger;
    constructor(logger: Logger) {
        this.logger = logger;
    }
    async relaunch(): Promise<void> {
        this.logger.info("Relaunching", {});
        if (globalThis.dashqlElectron !== undefined) {
            await globalThis.dashqlElectron.updates.install();
            return;
        }
        window.location.reload();
    }
}

const PROCESS_CTX = React.createContext<ProcessApi | null>(null);
export const useProcess = () => React.useContext(PROCESS_CTX)!;

interface ProcessProviderProps {
    children: React.ReactElement;
}

export const ProcessProvider: React.FC<ProcessProviderProps> = (props: ProcessProviderProps) => {
    const logger = useLogger();
    const process = new WebProcess(logger);
    return (
        <PROCESS_CTX.Provider value={process}>
            {props.children}
        </PROCESS_CTX.Provider>
    );
};
