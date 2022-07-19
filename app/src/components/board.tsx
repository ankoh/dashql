import * as model from '../model';
import * as React from 'react';
import ReactGrid from 'react-grid-layout';
import { useBackend } from '../backend/backend_provider';
import { useWorkflowData, useWorkflowSession } from '../backend/workflow_data_provider';

import './board.module.css';

type Props = {
    className?: string;
    width: number;
    editable?: boolean;
    columnCount: number;
    rowHeight: number;
    containerPadding: [number, number];
    elementMargin: [number, number];
};

interface LayoutElement {
    card: any; // TODO
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export const Board: React.FC<Props> = (props: Props) => {
    const backend = useBackend();
    const session = useWorkflowSession();
    const data = useWorkflowData();

    // Memoize the grid layout
    const layout = React.useMemo(() => {
        const els: LayoutElement[] = [];
        data.cards.forEach(card => {
            els.push({
                card: card,
                i: card.objectId.toString(),
                x: card.position.column,
                y: card.position.row,
                w: card.position.width || 12,
                h: card.position.height || 4,
            });
        });
        return els;
    }, [data.cards]);

    const userExpectation = React.useRef<boolean>();
    const onLayoutChanged = React.useCallback(
        (newLayout: ReactGrid.Layout[]) => {
            if (backend == null || session == null) return;
            if (!userExpectation.current) return;
            userExpectation.current = false;

            // Build mapping
            const mapping = new Map<string, LayoutElement>();
            layout.forEach(l => mapping.set(l.i, l));

            // Build card updates
            const updates: model.EditOperationVariant[] = newLayout.map(l => {
                return {
                    statementID: mapping.get(l.i).card.statementID,
                    type: model.EditOperationType.UPDATE_CARD_POSITION,
                    data: {
                        position: {
                            row: l.y,
                            column: l.x,
                            width: l.w,
                            height: l.h,
                        },
                    },
                };
            });

            // Edit program
            backend.value.workflow.editProgram(session, updates);
        },
        [backend],
    );

    // Build card renderers
    const els: React.ReactElement[] = [];
    for (const l of layout) {
        els.push(<div key={l.card.objectId}>TODO CardRenderer</div>);
    }
    return (
        <ReactGrid
            className={props.className}
            resizeHandles={['se']}
            width={props.width}
            cols={props.columnCount}
            rowHeight={props.rowHeight}
            compactType={null}
            isDraggable={!!props.editable}
            isResizable={!!props.editable}
            onLayoutChange={onLayoutChanged}
            onDragStart={() => (userExpectation.current = true)}
            onResizeStart={() => (userExpectation.current = true)}
            layout={layout}
            containerPadding={props.containerPadding}
            margin={props.elementMargin}
        >
            {els}
        </ReactGrid>
    );
};
