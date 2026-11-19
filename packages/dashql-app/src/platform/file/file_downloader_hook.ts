import type { DownloadFile } from '@akohn/dashql-react/host';
import { FileDownloader } from './file_downloader.js';
import { WebFileDownloader } from './web_file_downloader.js';

/// The desktop app downloads files through the browser download handling of Electron
const FILE_DOWNLOADER: FileDownloader = new WebFileDownloader();

export const useFileDownloader = (): FileDownloader => FILE_DOWNLOADER;

/// Save a file of the user, for the components of @akohn/dashql-react
const DOWNLOAD_FILE: DownloadFile = (bytes, fileName) => FILE_DOWNLOADER.downloadBufferAsFile(bytes, fileName);

export const useDownloadFile = (): DownloadFile => DOWNLOAD_FILE;
