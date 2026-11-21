import * as React from 'react';

import { DataTable, TableColumnHeader, type DataTableProps } from '@akohn/dashql-react/components/data_table/data_table';

import { useAppConfig } from '../config/app_config.js';
import { CellDetailOverlay } from './cell_detail_overlay.js';

type Props = Omit<DataTableProps, 'cellDetail' | 'debugMode'>;

/// The data table of a computation model (`DataTable` of @akohn/dashql-react): the column plots and the system columns
/// (the table debug mode) that the settings turn on, and the detail of a cell in the overlay of the app with its SQL and
/// plan views
export function DataTableView(props: Props) {
    const config = useAppConfig();
    const columnHeader = props.columnHeader ?? ((config?.settings?.enableTableColumnPlots ?? false)
        ? TableColumnHeader.WithColumnPlots
        : TableColumnHeader.OnlyColumnName);
    const debugMode = config?.settings?.tableDebugMode ?? false;
    return <DataTable {...props} columnHeader={columnHeader} debugMode={debugMode} cellDetail={CellDetailOverlay} />;
}
