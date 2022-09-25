import * as React from 'react';
import { useWorkflowSession } from '../../backend/workflow_session';
import { TABLE_DATA_EPOCH, useTableDataEpoch } from './epoch_contexts';
import { TableSchema, getQualifiedName } from './table_schema';

export const TABLE_CARDINALITY = React.createContext<number | null>(null);

interface Props {
    /// The table
    table: TableSchema;
    /// The children
    children: React.ReactElement[] | React.ReactElement;
}

interface State {
    /// The own epoch
    ownEpoch: number | null;
    /// The cardinality
    cardinality: number | null;
}

export const TableCardinalityProvider: React.FC<Props> = (props: Props) => {
    const session = useWorkflowSession();
    const [state, setState] = React.useState<State>({
        ownEpoch: null,
        cardinality: null,
    });
    const dataEpoch = useTableDataEpoch();
    const inFlight = React.useRef<boolean>(false);

    const isMounted = React.useRef(true);
    React.useEffect(() => {
        return () => void (isMounted.current = false);
    }, []);

    const updateCardinality = async (e: number | null) => {
        const result = await session!.runQuery(`SELECT COUNT(*)::INTEGER FROM ${getQualifiedName(props.table)}`);
        const cardinality = result.getChildAt(0)?.get(0) || null;
        if (!isMounted.current) return;

        inFlight.current = false;
        setState({
            ownEpoch: e,
            cardinality,
        });
    };

    React.useEffect(() => {
        if (!session || inFlight.current) {
            return;
        }
        if (state.ownEpoch != dataEpoch) {
            inFlight.current = true;
            updateCardinality(dataEpoch).catch(e => console.error(e));
        }
    }, [session, props.table, dataEpoch, state]);

    return (
        <TABLE_DATA_EPOCH.Provider value={state.ownEpoch}>
            <TABLE_CARDINALITY.Provider value={state.cardinality}>{props.children}</TABLE_CARDINALITY.Provider>
        </TABLE_DATA_EPOCH.Provider>
    );
};
