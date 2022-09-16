import * as model from '../model';
import * as React from 'react';
import ReactGrid from 'react-grid-layout';
import { useWorkflowSession, useWorkflowSessionState } from '../backend/workflow_session';

import './board.module.css';
import { CardStatus } from './card/card_status';

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
    statementId: number;
    card: any; // TODO
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export const Board: React.FC<Props> = (props: Props) => {
    const session = useWorkflowSession();
    const sessionState = useWorkflowSessionState();

    // Memoize the grid layout
    const layout = React.useMemo(() => {
        const els: LayoutElement[] = [];
        const cards = sessionState.programAnalysis?.cards;
        if (cards === undefined) {
            return els;
        }
        console.log(cards);
        for (const stmtId in cards) {
            const card = cards[stmtId];
            els.push({
                statementId: parseInt(stmtId),
                card: card,
                i: stmtId.toString(),
                x: card.position.column,
                y: card.position.row,
                w: card.position.width ?? 12,
                h: card.position.height ?? 4,
            });
        }
        return els;
    }, [sessionState.programAnalysis?.cards]);

    const userExpectation = React.useRef<boolean>();
    const onLayoutChanged = React.useCallback(
        (newLayout: ReactGrid.Layout[]) => {
            if (session == null) return;
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
            session.editProgram(updates);
        },
        [session],
    );

    // Build card renderers
    const els: React.ReactElement[] = [];
    for (let i = 0; i < layout.length; ++i) {
        let statementId = layout[i].statementId;
        els.push(<CardStatus key={statementId.toString()} statementId={statementId} />);
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
