import * as React from 'react';
import { DuckDBSetupProvider } from './duckdb_connection_setup.js';

export const DuckDBConnector: React.FC<React.PropsWithChildren> = props => (
    <DuckDBSetupProvider>{props.children}</DuckDBSetupProvider>
);
