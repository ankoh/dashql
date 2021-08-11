// Copyright (c) 2021 The DashQL Authors

import React from 'react';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { ProviderProps, Log, LogLevel, LogEvent, LogOrigin, LogTopic, useLog } from './model';
import axios from 'axios';

type HTTPProgressHandler = (progress: ProgressEvent) => void;

export interface HTTPData {
    /// The request
    request: AxiosRequestConfig;
    /// The response
    response: AxiosResponse<ArrayBuffer>;
}

export class HTTPClient {
    /// The logger
    _log: Log;

    /// Constructor
    constructor(log: Log) {
        this._log = log;
    }

    /// Send a HTTP request
    public async request(
        req: AxiosRequestConfig,
        onProgress: HTTPProgressHandler = (event: ProgressEvent) => {},
    ): Promise<HTTPData> {
        // Send HTTP request
        req.onDownloadProgress = (event: ProgressEvent) => onProgress(event);
        try {
            const res = await axios.request<ArrayBuffer>({
                ...req,
                responseType: 'arraybuffer',
            });
            this._log.pushBack({
                timestamp: new Date(),
                level: LogLevel.INFO,
                origin: LogOrigin.HTTP_MANAGER,
                topic: LogTopic.REQUEST,
                event: LogEvent.OK,
                value: `${res.statusText}`,
            });
            return {
                request: req,
                response: res,
            };
        } catch (e) {
            this._log.pushBack({
                timestamp: new Date(),
                level: LogLevel.ERROR,
                origin: LogOrigin.HTTP_MANAGER,
                topic: LogTopic.REQUEST,
                event: LogEvent.ERROR,
                value: e,
            });
            throw e;
        }
    }
}

const ctx = React.createContext<HTTPClient | null>(null);

export const HTTPClientProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const log = useLog();
    const proxy = React.useRef<HTTPClient>(new HTTPClient(log));
    return <ctx.Provider value={proxy.current}>{props.children}</ctx.Provider>;
};

export const useHTTPClient = (): HTTPClient => React.useContext(ctx);
