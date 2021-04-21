import * as model from '../model';
import { Logger } from './log_manager';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import axios from 'axios';

type HTTPProgressHandler = (progress: ProgressEvent) => void;

export interface HTTPData {
    /// The request
    request: AxiosRequestConfig;
    /// The response
    response: AxiosResponse<ArrayBuffer>;
}

export class HTTPManager {
    /// The redux store
    _store: model.DerivedReduxStore;
    /// The logger
    _logger: Logger;

    /// Constructor
    constructor(store: model.DerivedReduxStore, logger: Logger) {
        this._store = store;
        this._logger = logger;
    }

    /// Init the http manager
    public async init(): Promise<void> {}

    /// Send a HTTP request
    public async request(
        req: AxiosRequestConfig,
        onProgress: HTTPProgressHandler = (event: ProgressEvent) => {},
    ): Promise<HTTPData> {
        // Send HTTP request
        req.onDownloadProgress = (event: ProgressEvent) => onProgress(event);
        try {
            const res = await axios.request<ArrayBuffer>(req);
            this._logger.log({
                timestamp: new Date(),
                level: model.LogLevel.INFO,
                origin: model.LogOrigin.HTTP_MANAGER,
                topic: model.LogTopic.REQUEST,
                event: model.LogEvent.OK,
                value: `Buffer of size: ${res.data.byteLength}`,
            });
            return {
                request: req,
                response: res,
            };
        } catch (e) {
            this._logger.log({
                timestamp: new Date(),
                level: model.LogLevel.ERROR,
                origin: model.LogOrigin.HTTP_MANAGER,
                topic: model.LogTopic.REQUEST,
                event: model.LogEvent.ERROR,
                value: e,
            });
            throw e;
        }
    }
}
