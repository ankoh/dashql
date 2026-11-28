import * as React from 'react';
import * as styles from './dashboard_arrange.module.css';

import { Button, ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, PlusIcon, SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { DASHBOARD_COLUMN_COUNT, type DashboardPlacement } from './dashboard_layout.js';

const ChevronLeftIcon = SymbolIcon('chevron_left_16');
const DashIcon = SymbolIcon('dash_16');

/// A card on the map of the board
export interface DashboardArrangeItem {
    placement: DashboardPlacement;
    /// The name of the script of the card
    name: string;
}

/// A section of the board, its cards on a grid of their own
export interface DashboardArrangeSection {
    label: string;
    items: DashboardArrangeItem[];
}

/// The new place and size of a card
export interface DashboardArrangeChange {
    row: number;
    column: number;
    width: number;
    height: number;
}

interface Props {
    sections: DashboardArrangeSection[];
    /// Move or resize a card, the board places the others around it like after a drag
    onChange: (id: number, change: DashboardArrangeChange) => void;
    /// Leave the map
    onDone: () => void;
}

/// The board as a map of its 12-column grid, scaled to the width of the window: a compact window reflows the cards in
/// one or two columns and has no room to drag them, the map arranges the same placements as the grid of a wide window
/// (docs/design/narrow_layouts.md). A tap picks a card, the panel below moves it and changes its size.
export function DashboardArrange(props: Props): React.ReactElement {
    const { sections, onChange } = props;
    const [selectedId, setSelectedId] = React.useState<number | null>(null);
    const selected = sections.flatMap(section => section.items).find(item => item.placement.id === selectedId) ?? null;
    const change = (placement: DashboardPlacement, next: Partial<DashboardArrangeChange>) => {
        const width = Math.min(DASHBOARD_COLUMN_COUNT, Math.max(1, next.width ?? placement.width));
        const column = Math.min(DASHBOARD_COLUMN_COUNT - width, Math.max(0, next.column ?? placement.column));
        const row = Math.max(0, next.row ?? placement.row);
        const height = Math.max(1, next.height ?? placement.height);
        if (row === placement.row && column === placement.column && width === placement.width && height === placement.height) return;
        onChange(placement.id, { row, column, width, height });
    };
    return (
        <div className={styles.arrange} data-testid="dashboard-arrange">
            <header className={styles.header}>
                <span className={styles.hint}>Tap a card to move it or change its size</span>
                <Button size={ButtonSize.Small} variant={ButtonVariant.Primary} onClick={props.onDone} data-testid="dashboard-arrange-done">Done</Button>
            </header>
            {sections.map(section => section.items.length > 0 && (
                <section key={section.label} className={styles.section} aria-label={section.label}>
                    <h3 className={styles.section_label}>{section.label}</h3>
                    <div className={styles.map} role="listbox" aria-label={`Cards of ${section.label}`}>
                        {section.items.map(({ placement, name }) => (
                            <button
                                key={placement.id}
                                type="button"
                                role="option"
                                aria-selected={placement.id === selectedId}
                                className={classNames(styles.card, placement.id === selectedId && styles.card_selected)}
                                style={{
                                    gridColumn: `${placement.column + 1} / span ${placement.width}`,
                                    gridRow: `${placement.row + 1} / span ${placement.height}`,
                                }}
                                data-testid="dashboard-arrange-card"
                                data-card={placement.id}
                                onClick={() => setSelectedId(placement.id === selectedId ? null : placement.id)}
                            >
                                <span className={styles.card_name}>{name}</span>
                                <span className={styles.card_size}>{placement.width} × {placement.height}</span>
                            </button>
                        ))}
                    </div>
                </section>
            ))}
            {selected != null && (
                <div className={styles.panel} role="group" aria-label={`Arrange ${selected.name}`} data-testid="dashboard-arrange-panel">
                    <div className={styles.panel_title}>
                        <strong>{selected.name}</strong>
                        <span>row {selected.placement.row + 1}, column {selected.placement.column + 1}</span>
                    </div>
                    <Stepper label="Width" value={selected.placement.width}
                        onStep={delta => change(selected.placement, { width: selected.placement.width + delta })} />
                    <Stepper label="Height" value={selected.placement.height}
                        onStep={delta => change(selected.placement, { height: selected.placement.height + delta })} />
                    <div className={styles.row}>
                        <span>Move</span>
                        <span className={styles.moves}>
                            <IconButton variant={ButtonVariant.Default} aria-label="Move left" data-testid="dashboard-arrange-left"
                                onClick={() => change(selected.placement, { column: selected.placement.column - 1 })}><ChevronLeftIcon size={16} /></IconButton>
                            <IconButton variant={ButtonVariant.Default} aria-label="Move up" data-testid="dashboard-arrange-up"
                                onClick={() => change(selected.placement, { row: selected.placement.row - 1 })}><ChevronUpIcon size={16} /></IconButton>
                            <IconButton variant={ButtonVariant.Default} aria-label="Move down" data-testid="dashboard-arrange-down"
                                onClick={() => change(selected.placement, { row: selected.placement.row + 1 })}><ChevronDownIcon size={16} /></IconButton>
                            <IconButton variant={ButtonVariant.Default} aria-label="Move right" data-testid="dashboard-arrange-right"
                                onClick={() => change(selected.placement, { column: selected.placement.column + 1 })}><ChevronRightIcon size={16} /></IconButton>
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

/// A size of the selected card with the buttons that change it by one
function Stepper(props: { label: string; value: number; onStep: (delta: number) => void }): React.ReactElement {
    return (
        <div className={styles.row}>
            <span>{props.label}</span>
            <span className={styles.stepper}>
                <IconButton variant={ButtonVariant.Default} aria-label={`Less ${props.label.toLowerCase()}`}
                    data-testid={`dashboard-arrange-${props.label.toLowerCase()}-less`} onClick={() => props.onStep(-1)}><DashIcon size={16} /></IconButton>
                <span className={styles.stepper_value}>{props.value}</span>
                <IconButton variant={ButtonVariant.Default} aria-label={`More ${props.label.toLowerCase()}`}
                    data-testid={`dashboard-arrange-${props.label.toLowerCase()}-more`} onClick={() => props.onStep(1)}><PlusIcon size={16} /></IconButton>
            </span>
        </div>
    );
}
