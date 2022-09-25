import * as React from 'react';
import { TableSchema, collectTableSchema } from './table_schema';
import { useTableSchemaEpoch } from './epoch_contexts';
import { useWorkflowSession } from '../../backend/workflow_session';

interface Props {
    /// The children
    children: React.ReactElement | React.ReactElement[];
    /// The schema
    schema?: string;
    /// The name
    name: string;
}

interface State {
    /// The schema
    schema: string | null;
    /// The name
    name: string | null;
    /// The metadata
    metadata: TableSchema | null;
    /// The own epoch
    ownEpoch: number | null;
}

export const TABLE_METADATA = React.createContext<TableSchema | null>(null);
export const useTableSchema = (): TableSchema | null => React.useContext(TABLE_METADATA);

export const TableSchemaProvider: React.FC<Props> = (props: Props) => {
    const session = useWorkflowSession();
    const epoch = useTableSchemaEpoch();
    const [state, setState] = React.useState<State>({
        schema: null,
        name: null,
        ownEpoch: epoch,
        metadata: null,
    });
    const inFlight = React.useRef<boolean>(false);

    // Resolve the metadata
    React.useEffect(() => {
        if (!session || inFlight.current) {
            return;
        }
        inFlight.current = true;
        const resolve = async (schema: string, name: string, epoch: number | null) => {
            const metadata = await collectTableSchema(session!, {
                tableSchema: schema,
                tableName: name,
            });
            inFlight.current = false;
            setState({
                schema,
                name,
                ownEpoch: epoch,
                metadata,
            });
        };
        resolve(props.schema || 'main', props.name, epoch).catch(e => console.error(e));
    }, [session, props.schema, props.name, epoch]);

    return <TABLE_METADATA.Provider value={state.metadata}>{props.children}</TABLE_METADATA.Provider>;
};
