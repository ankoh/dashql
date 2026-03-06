import * as React from 'react';

import { FileDownloader } from './file_downloader.js';
import { isNativePlatform } from './native_globals.js';
import { WebFileDownloader } from './web_file_downloader.js';

const FILE_DOWNLOADER_CTX = React.createContext<FileDownloader | null>(null);

export const useFileDownloader = () => React.useContext(FILE_DOWNLOADER_CTX)!;

type Props = {
    children: React.ReactElement;
};

export const FileDownloaderProvider: React.FC<Props> = (props: Props) => {
    const [downloader, setDownloader] = React.useState<FileDownloader>(() => new WebFileDownloader());
    React.useEffect(() => {
        if (isNativePlatform()) {
            import('./native_file_downloader.js').then((m) => setDownloader(new m.NativeFileDownloader()));
        }
    }, []);
    return (
        <FILE_DOWNLOADER_CTX.Provider value={downloader}>
            {props.children}
        </FILE_DOWNLOADER_CTX.Provider>
    );
};
