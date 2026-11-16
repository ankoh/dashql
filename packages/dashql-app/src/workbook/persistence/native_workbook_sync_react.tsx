import * as React from 'react';
import type * as core from '@ankoh/dashql';

import { useRuntime, useView, useWorkbooks } from '../../runtime/runtime_hooks.js';
import { isDesktopHost } from '../../platform/native_globals.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '@ankoh/dashql/platform/logger/logger';
import { useAppFlavor } from '../../config/flavor_provider.js';

const LOG_CTX = 'native_workbook_sync';

/// Ask the user whether to reload a workbook that changed on disk
async function confirmExternalReload(appName: string, hasPendingWrites: boolean): Promise<boolean> {
    const message = hasPendingWrites
        ? `This workbook changed on disk while ${appName} still has local changes waiting to be saved. Reload from disk and discard those pending local changes?`
        : `This workbook changed outside ${appName}. Reload it from disk?`;
    return await globalThis.dashqlElectron!.confirm({ message, title: 'Workbook changed on disk' });
}

/// Native-only synchronization boundary. Workbook folders are not watched, the runtime checks them
/// (`checkWorkbookFolders`) when the window gets the focus, when the storage writer holds a write because a script
/// changed outside the app, and once for every workbook that enters the list. When the scripts on disk
/// differ from the app, the `storage` view asks the question: the component shows it and answers it.
export const NativeWorkbookSync: React.FC = () => {
    const logger = useLogger();
    const appName = useAppFlavor().displayName;
    const runtime = useRuntime();
    const workbooks = useWorkbooks();
    const storage = useView('storage', 'root');
    // The workbooks whose writes a change outside the app holds, as a stable key of their ids
    const heldKey = (storage?.holds ?? [])
        .filter(hold => hold.reason === 'externalChange' && hold.workbookId != null)
        .map(hold => hold.workbookId!)
        .join('\n');
    const externalChanges = storage?.externalChanges;
    const workbooksRef = React.useRef(workbooks);
    workbooksRef.current = workbooks;
    /// The workbooks whose first check was requested
    const firstCheckRequestedRef = React.useRef(new Set<string>());
    /// The questions that were shown, by their numbers
    const askedRef = React.useRef(new Set<number>());
    const changesRef = React.useRef(externalChanges);
    changesRef.current = externalChanges;

    const check = React.useEffectEvent((workbookIds: string[]) => {
        if (workbookIds.length > 0) runtime.module.checkWorkbookFolders(workbookIds);
    });

    const ask = React.useEffectEvent(async (change: core.ExternalChangeView) => {
        let reload: boolean | null = null;
        try {
            reload = await confirmExternalReload(appName, change.pendingWrites);
        } catch (error) {
            // Without an answer the version of the app stays, the next check asks again
            logger.warn('failed to ask about a workbook that changed on disk', {
                workbookId: change.workbookId,
                error: stringifyError(error),
            }, LOG_CTX);
        }
        runtime.module.answerExternalChange(change.workbookId, change.prompt, reload);
    });

    // Effect events must not be dependencies, they change with every render
    React.useEffect(() => {
        if (!isDesktopHost()) {
            return;
        }
        const onFocus = () => check([...workbooksRef.current.keys()]);
        window.addEventListener('focus', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    // The writer holds the writes of a workbook whose script changed outside the app, a check answers it
    React.useEffect(() => {
        if (!isDesktopHost()) {
            return;
        }
        check(heldKey.length > 0 ? heldKey.split('\n') : []);
    }, [heldKey]);

    // The first check of a workbook compares the folder with what the restore read, e.g. a file edited in between
    React.useEffect(() => {
        if (!isDesktopHost()) {
            return;
        }
        const first = [...workbooks.keys()].filter(workbookId => !firstCheckRequestedRef.current.has(workbookId));
        for (const workbookId of first) firstCheckRequestedRef.current.add(workbookId);
        check(first);
    }, [workbooks]);

    // The questions of the runtime, each is shown once
    React.useEffect(() => {
        if (!isDesktopHost()) {
            return;
        }
        for (const change of externalChanges ?? []) {
            if (askedRef.current.has(change.prompt)) continue;
            askedRef.current.add(change.prompt);
            void ask(change);
        }
    }, [externalChanges]);

    // A question that was never shown ends without an answer, the check lets the writes of its workbook go
    React.useEffect(() => () => {
        for (const change of changesRef.current ?? []) {
            if (!askedRef.current.has(change.prompt)) runtime.module.answerExternalChange(change.workbookId, change.prompt, null);
        }
    }, [runtime]);

    return null;
};
