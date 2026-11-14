import * as React from 'react';

import { CatalogLoaderProvider } from '../../connections/catalog/catalog_loader.js';
import { useConnectionScriptsDispatch } from './workbook_scripts_registry.js';
import { CATALOG_DID_UPDATE } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';

/// The catalog loader of the app, re-analyzes the scripts of every workbook that uses a connection
/// whose catalog changed.
export function WorkbookCatalogLoaderProvider(props: { children?: React.ReactElement }) {
    const connScriptsDispatch = useConnectionScriptsDispatch();
    const onCatalogDidUpdate = React.useCallback((connectionId: string) => {
        void connScriptsDispatch(connectionId, { type: CATALOG_DID_UPDATE, value: connectionId });
    }, [connScriptsDispatch]);
    return (
        <CatalogLoaderProvider onCatalogDidUpdate={onCatalogDidUpdate}>
            {props.children}
        </CatalogLoaderProvider>
    );
}
