import * as React from 'react';

import { StorageReader } from './storage_reader.js';
import { StorageWriter } from './storage_writer.js';
import { useLogger } from '../platform/logger_provider.js';

const STORAGE_CTX = React.createContext<[StorageReader, StorageWriter] | null>(null);

export const useStorageWriter = () => React.useContext(STORAGE_CTX)![1];
export const useStorageReader = () => React.useContext(STORAGE_CTX)![0];
export const useStorage = () => React.useContext(STORAGE_CTX)!;

type Props = {
    children: React.ReactElement;
};

export const StorageProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const readerWriter = React.useMemo<[StorageReader, StorageWriter]>(() => ([
        new StorageReader(logger),
        new StorageWriter(logger),
    ]), []);
    return (
        <STORAGE_CTX.Provider value={readerWriter}>
            {props.children}
        </STORAGE_CTX.Provider>
    )
};
