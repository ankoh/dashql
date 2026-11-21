import * as React from 'react';

import { createWorkbookResultFiles, type WorkbookResultFiles } from '@akohn/dashql/platform/workbook/workbook_result_files';

const RESULTS_CTX = React.createContext<WorkbookResultFiles | null>(null);

/// The stored results of the scripts of the workbooks, null without a provider (docs/design/workbook_results.md)
export function useWorkbookResults(): WorkbookResultFiles | null {
    return React.useContext(RESULTS_CTX);
}

/// Provide the stored results of the workbooks, by default the ones in the origin private file system
export function WorkbookResultsProvider(props: { results?: WorkbookResultFiles; children: React.ReactElement }) {
    const results = React.useMemo(() => props.results ?? createWorkbookResultFiles(), [props.results]);
    return <RESULTS_CTX.Provider value={results}>{props.children}</RESULTS_CTX.Provider>;
}
