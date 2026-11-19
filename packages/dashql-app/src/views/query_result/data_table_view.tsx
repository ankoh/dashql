import * as React from 'react';

import type { ComputationView } from '@akohn/dashql';
import { DataTable, TableColumnHeader, type DataTableProps } from '@akohn/dashql-react/components/data_table/data_table';
import { useComputationModel } from '@akohn/dashql-react/models/computation_model';

import { useAppConfig } from '../../config/app_config.js';
import { CellDetailOverlay } from './cell_detail_overlay.js';

type Props = Omit<DataTableProps, 'model' | 'cellDetail'> & {
    /// The computation of the table in the runtime
    table: ComputationView;
};

/// The data table of a computation of the runtime (`DataTable` of @akohn/dashql-react): its model, the column plots
/// that the settings turn on, and the detail of a cell in the overlay of the app with its SQL and plan views
export function DataTableView({ table, ...props }: Props) {
    const config = useAppConfig();
    const model = useComputationModel(table);
    if (model == null) return null;
    const columnHeader = props.columnHeader ?? ((config?.settings?.enableTableColumnPlots ?? false)
        ? TableColumnHeader.WithColumnPlots
        : TableColumnHeader.OnlyColumnName);
    return <DataTable {...props} model={model} columnHeader={columnHeader} cellDetail={CellDetailOverlay} />;
}
