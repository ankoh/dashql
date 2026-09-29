export type BrowserTestStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped';

export interface SerializedTestError {
    message: string;
    name: string;
    stack: string | null;
}

export interface BrowserTestCase {
    id: string;
    title: string;
    titlePath: string[];
    status: BrowserTestStatus;
    duration: number | null;
    error: SerializedTestError | null;
}

export interface BrowserTestFileResult {
    file: string;
    status: BrowserTestStatus;
    tests: BrowserTestCase[];
    duration: number;
    error: SerializedTestError | null;
}

export type BrowserTestFrameEvent =
    | { type: 'run-end' }
    | { type: 'file-start'; file: string }
    | { type: 'file-end'; result: BrowserTestFileResult };

export interface BrowserTestSummary {
    status: 'idle' | 'running' | 'passed' | 'failed';
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
    files: BrowserTestFileResult[];
}

export const BROWSER_TEST_MESSAGE_SOURCE = 'dashql-browser-tests';
