import * as model from '../model';
import * as React from 'react';
import ReactGrid from 'react-grid-layout';
import { useWorkflowSession, useWorkflowSessionState } from '../backend/workflow_session';

import './board.module.css';
import { CardRenderer } from './card';

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
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export const Board: React.FC<Props> = (props: Props) => {
    const session = useWorkflowSession();
    const sessionState = useWorkflowSessionState();

    const layout = React.useMemo(() => {
        const els: LayoutElement[] = [];
        const cards = sessionState.programAnalysis?.cards;
        if (cards === undefined) {
            return els;
        }
        for (const stmtId in cards) {
            const card = cards[stmtId];
            els.push({
                statementId: parseInt(stmtId),
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
            const edits: model.StatementEditOperation[] = newLayout.map(l => {
                return {
                    statement_id: mapping.get(l.i).statementId,
                    operation: {
                        t: 'SetBoardPosition',
                        v: {
                            row: l.y,
                            column: l.x,
                            width: l.w,
                            height: l.h,
                        },
                    },
                };
            });
            session.editProgram(edits);
        },
        [session],
    );

    const els: React.ReactElement[] = [];
    for (const l of layout) {
        els.push(
            <div key={l.i}>
                <CardRenderer statementId={l.statementId} editable={props.editable} />
            </div>,
        );
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
