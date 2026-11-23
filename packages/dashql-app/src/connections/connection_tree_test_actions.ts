import { vi } from 'vitest';

import type { ConnectionTreeActions } from './connection_tree.js';

/// The commands on the connections of a test of the connection tree, as spies. No workbook uses a connection, there is
/// nothing to merge and nothing that replaces a connection, unless the test says otherwise.
export function testConnectionTreeActions(overrides: Partial<ConnectionTreeActions> = {}): ConnectionTreeActions {
    return {
        describeUsage: vi.fn(() => ({ workbookCount: 0, blockingWorkbookCount: 0, usedHere: false })),
        openSettings: vi.fn(),
        openOverview: vi.fn(),
        rename: vi.fn(),
        refreshCatalog: vi.fn(),
        delete: vi.fn(),
        mergeCandidateCount: vi.fn(() => 0),
        merge: vi.fn(),
        replaceBlocker: vi.fn(() => null),
        replaceCandidates: vi.fn(() => ({ sameConnector: [], otherConnectors: [] })),
        replace: vi.fn(),
        setCloud: vi.fn(),
        ...overrides,
    };
}
