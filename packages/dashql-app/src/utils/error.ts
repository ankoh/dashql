import { HyperErrorInfo } from "../connection/hyper/hyper_error_info.js";

export interface DetailedError {
    /// The error message
    message: string;
    /// The error data
    data?: Record<string, string>;
    /// The decoded Hyper rich error model, if this error came from Hyper
    hyperErrorInfo?: HyperErrorInfo;
}
