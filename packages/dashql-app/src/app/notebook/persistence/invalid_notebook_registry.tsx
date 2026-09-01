import * as React from 'react';

import type { InvalidNotebook } from './notebook_validation.js';

interface InvalidNotebookRegistryValue {
    invalidNotebooks: ReadonlyMap<string, InvalidNotebook>;
    deleteInvalidNotebook: (notebookId: string) => Promise<void>;
}

const InvalidNotebookRegistryContext = React.createContext<InvalidNotebookRegistryValue>({
    invalidNotebooks: new Map(),
    deleteInvalidNotebook: async () => {},
});

export const InvalidNotebookRegistryProvider = InvalidNotebookRegistryContext.Provider;

export function useInvalidNotebookRegistry(): InvalidNotebookRegistryValue {
    return React.useContext(InvalidNotebookRegistryContext);
}
