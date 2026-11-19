import type * as dashql from '@akohn/dashql';

// What a host hands the components besides models: its core module and the files it saves for the user

/// Set up the core module of the host, e.g. to lay out a plan or to format a SQL text
export type CoreSetup = (context: string) => Promise<dashql.DashQL>;
/// Save bytes as a file of the user, resolves once the host took the file
export type DownloadFile = (bytes: Uint8Array, fileName: string) => Promise<void>;
