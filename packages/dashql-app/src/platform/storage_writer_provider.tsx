import * as React from 'react';

import { StorageWriter } from './storage_writer.js';

const STORAGE_WRITER_CTX = React.createContext<StorageWriter | null>(null);

export const useStorageWriter = () => React.useContext(STORAGE_WRITER_CTX)!;

type Props = {
    children: React.ReactElement;
};

export const StorageWriterProvider: React.FC<Props> = (props: Props) => {
    const writer = React.useMemo<StorageWriter>(() => new StorageWriter(), []);
    return (
        <STORAGE_WRITER_CTX.Provider value={writer}>
            {props.children}
        </STORAGE_WRITER_CTX.Provider>
    )
};
