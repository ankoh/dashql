export interface Script {
    /// The program text
    text: string;
    /// Has been modified?
    modified: boolean;
    /// The line count
    lineCount?: number;
    /// The file size
    bytes?: number;
    /// The file name
    fileName?: string;
}