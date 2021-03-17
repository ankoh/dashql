export interface Script {
    /// The program text
    text: string;
    /// Has been modified?
    modified: boolean;
    /// The file name
    uri?: string;
    /// The line count
    lineCount?: number;
    /// The file size
    bytes?: number;
}