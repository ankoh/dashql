import * as React from 'react';

import { FileDownloader } from './file_downloader.js';
import { WebFileDownloader } from './web_file_downloader.js';

const FILE_DOWNLOADER_CTX = React.createContext<FileDownloader | null>(null);

export const useFileDownloader = () => React.useContext(FILE_DOWNLOADER_CTX)!;

type Props = {
    children: React.ReactElement;
};

export const FileDownloaderProvider: React.FC<Props> = (props: Props) => {
    const downloader = React.useMemo<FileDownloader>(() => new WebFileDownloader(), []);
    return (
        <FILE_DOWNLOADER_CTX.Provider value={downloader}>
            {props.children}
        </FILE_DOWNLOADER_CTX.Provider>
    );
};
