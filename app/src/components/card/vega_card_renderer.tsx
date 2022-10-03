import * as React from 'react';
import * as access from '../../access';
import * as vl from 'vega-lite';
import { useWorkflowSession, useWorkflowSessionState } from '../../backend/workflow_session';
import { SizeObserver, useObservedSize } from '../../utils/size_observer';
import { Vega } from 'react-vega';
import { CardFrame, CardFrameCommand } from './card_frame';
import { VegaLiteRendererData as VegaRendererData } from '../../model';
import { Result, Ok, Err } from '../../utils';
import { useQueryResult } from '../../access';

import styles from './vega_card_renderer.module.css';

const SamplingVegaRenderer: React.FC<VegaCardRendererProps> = (props: VegaCardRendererProps) => {
    const size = useObservedSize();
    const [compiled, setCompiled] = React.useState<Result<any, Error>>(Ok(null));

    React.useEffect(() => {
        const compile = async () => {
            try {
                const compiled = await vl.compile(props.data.v.spec);
                setCompiled(Ok(compiled.spec));
            } catch (e) {
                setCompiled(Err(e));
            }
        };
        compile();
    }, [props.data]);

    if (!compiled.ok) {
        return <div className={styles.error}>{compiled.value.toString()}</div>;
    }

    const table = props.data.v.table;
    const sampling = props.data.v.sampling;
    if (sampling?.t === 'AM4') {
        const am4 = sampling.v;
        return (
            <access.AM4Provider
                table={table}
                x={am4.attribute_x}
                y={am4.attribute_y}
                domainX={am4.domain_x}
                width={size?.width ?? 1000}
            >
                <VegaSpecRenderer vega={compiled.value} />
            </access.AM4Provider>
        );
    } else if (sampling?.t === 'Reservoir') {
        return (
            <access.ReservoirProvider table={table} sampleSize={sampling.v}>
                <VegaSpecRenderer vega={compiled.value} />
            </access.ReservoirProvider>
        );
    }
    return (
        <access.QueryProvider query={{ data: `select * from ${table.table_name}` }}>
            <VegaSpecRenderer vega={compiled.value} />
        </access.QueryProvider>
    );
};

interface InnerVegaRendererProps {
    vega: any | null;
}
const VegaSpecRenderer: React.FC<InnerVegaRendererProps> = (props: InnerVegaRendererProps) => {
    const size = useObservedSize();
    const table = useQueryResult();
    const rows = React.useMemo(() => (table == null ? null : access.tableToJSON(table)), [table]);
    if (rows == null || size == null || props.vega == null) {
        return <div />;
    }
    return (
        <Vega
            style={{
                width: size.width,
                height: size.height,
            }}
            spec={props.vega as any}
            data={{ source: rows }}
            width={size.width}
            height={size.height}
            actions={false}
        />
    );
};

interface VegaCardRendererProps {
    statementId: number;
    data: VegaRendererData;
    editable?: boolean;
}
export const VegaCardRenderer: React.FC<VegaCardRendererProps> = (props: VegaCardRendererProps) => {
    const session = useWorkflowSession();
    const sessionState = useWorkflowSessionState();
    const commands = React.useMemo(() => {
        let cmds: CardFrameCommand[] = [];
        if (!props.editable) {
            return cmds;
        }
        cmds.push({
            title: 'Expand Statement',
            action: () => {
                const card = sessionState.programAnalysis.cards[props.statementId];
                const full = props.data.v.spec as any;
                const reduced = {
                    title: card.title,
                    position: card.position,
                    ...full.layer[0],
                } as any;
                session.editProgram([
                    {
                        statement_id: props.statementId,
                        operation: {
                            t: 'SetVizSpec',
                            v: JSON.stringify(reduced),
                        },
                    },
                ]);
            },
        });
        return cmds;
    }, [props.statementId, props.data, props.editable, sessionState]);
    return (
        <CardFrame title={props.data.v.table.table_name} commands={commands}>
            <SizeObserver>
                <SamplingVegaRenderer statementId={props.statementId} data={props.data} />
            </SizeObserver>
        </CardFrame>
    );
};
