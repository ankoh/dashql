import * as React from 'react';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';

import { Button, ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, SymbolIcon, XIcon, type Icon } from '../../../../ui/foundations/symbol_icon.js';
import { TextInput } from '../../../../ui/foundations/text_input.js';
import { classNames } from '../../../../utils/classnames.js';
import type { ChartColumn } from './chart_columns.js';
import { ChartSelect, type ChartSelectOption } from './chart_select.js';
import {
    AGGREGATES,
    CHANNELS,
    DEFAULT_CHANNELS,
    FIELD_TYPES,
    FIELD_TYPE_SHORT,
    PRIMARY_MARKS,
    SECONDARY_MARKS,
    SORTS,
    TIME_UNITS,
    addColumnLayer,
    addLayer,
    channelSummary,
    clearChannelField,
    encodedChannels,
    getChannel,
    getLayer,
    getMarkType,
    isBuilderEditable,
    isCountChannel,
    isCustomChannel,
    layerCount,
    newLayerView,
    patchChannel,
    removeChannel,
    removeLayer,
    setChannelCount,
    setChannelField,
    setChannelType,
    setLayer,
    setMarkType,
    setTopLevel,
    type ChartSpec,
    type FieldType,
} from './chart_spec_paths.js';
import * as styles from './chart_builder.module.css';

const MoreIcon: Icon = SymbolIcon('kebab_horizontal');
const TrashIcon: Icon = SymbolIcon('trash_16');

/// The value of the count option of a field dropdown, no column can have this name
const COUNT_OPTION = '\u001fcount';
const NONE_OPTION = '\u001fnone';

/// The marks with a monochrome example icon each
const MARKS: { mark: string; icon: Icon }[] = [...PRIMARY_MARKS, ...SECONDARY_MARKS].map(mark => ({ mark, icon: SymbolIcon(`mark_${mark}_16`) }));
const MARK_ICONS = new Map(MARKS.map(({ mark, icon }) => [mark, icon]));
const TYPE_OPTIONS: ChartSelectOption[] = FIELD_TYPES.map(type => ({ value: type, label: FIELD_TYPE_SHORT[type], description: type }));
const AGGREGATE_OPTIONS: ChartSelectOption[] = [{ value: NONE_OPTION, label: 'none' }, ...AGGREGATES.map(a => ({ value: a, label: a }))];
const TIME_UNIT_OPTIONS: ChartSelectOption[] = [{ value: NONE_OPTION, label: 'none' }, ...TIME_UNITS.map(u => ({ value: u, label: u }))];
const SORT_OPTIONS: ChartSelectOption[] = [{ value: NONE_OPTION, label: 'none' }, ...SORTS.map(s => ({ value: s, label: s }))];
const STACK_OPTIONS: ChartSelectOption[] = [
    { value: NONE_OPTION, label: 'default' },
    { value: 'zero', label: 'zero' },
    { value: 'normalize', label: 'normalize' },
    { value: 'center', label: 'center' },
    { value: 'null', label: 'off' },
];

/// The prefixes of the drag and drop ids
const COLUMN_DRAG_PREFIX = 'column:';
const CHANNEL_DROP_PREFIX = 'channel:';
const LAYER_DROP_ID = 'layer:new';

interface Props {
    spec: ChartSpec;
    columns: readonly ChartColumn[];
    onChange: (spec: ChartSpec) => void;
    /// Switch to the JSON, for specs that the builder cannot edit
    onEditJson: () => void;
}

/// The visual editor of a Vega-Lite spec: the view, the columns of the result, and the layers of the chart with a mark
/// and a row per encoding channel each. The columns can be dragged onto a channel, or picked in the dropdown of the
/// channel. Dropping a column onto the layers adds a layer that shows the column.
export function ChartSpecBuilder(props: Props): React.ReactElement {
    const { spec, onChange } = props;
    // The layer that the mark and the encoding edit, a single view is one layer
    const [layerIndex, setLayerIndex] = React.useState(0);
    const layers = layerCount(spec);
    const selectedLayer = Math.min(layerIndex, layers - 1);
    const view = getLayer(spec, selectedLayer);
    const onViewChange = React.useCallback(
        (next: ChartSpec) => onChange(setLayer(spec, selectedLayer, next)),
        [spec, selectedLayer, onChange],
    );
    // Channels that the user added to the selected layer and that have no field yet
    const [addedChannels, setAddedChannels] = React.useState<string[]>([]);
    const selectLayer = React.useCallback((index: number) => {
        setLayerIndex(index);
        setAddedChannels([]);
    }, []);
    const appendLayer = React.useCallback((next: ChartSpec) => {
        onChange(next);
        selectLayer(layerCount(next) - 1);
    }, [onChange, selectLayer]);
    const [dragColumn, setDragColumn] = React.useState<ChartColumn | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor),
    );

    const visibleChannels = React.useMemo(() => {
        const visible = new Set<string>([...DEFAULT_CHANNELS, ...encodedChannels(view), ...addedChannels]);
        const known: string[] = CHANNELS.filter(channel => visible.has(channel));
        // Channels that the builder does not list, e.g. `fill`, are shown after the known ones
        const unknown = [...visible].filter(channel => !(CHANNELS as readonly string[]).includes(channel));
        return [...known, ...unknown];
    }, [view, addedChannels]);
    const addableChannels = React.useMemo<ChartSelectOption[]>(
        () => CHANNELS.filter(channel => !visibleChannels.includes(channel)).map(channel => ({ value: channel, label: channel })),
        [visibleChannels],
    );

    const onDragStart = React.useCallback((event: DragStartEvent) => {
        setDragColumn((event.active.data.current?.column as ChartColumn | undefined) ?? null);
    }, []);
    const onDragEnd = React.useCallback((event: DragEndEvent) => {
        setDragColumn(null);
        const column = event.active.data.current?.column as ChartColumn | undefined;
        const target = event.over?.id;
        if (column == null || typeof target !== 'string') return;
        if (target === LAYER_DROP_ID) {
            appendLayer(addColumnLayer(spec, selectedLayer, { field: column.name, type: column.type }));
        } else if (target.startsWith(CHANNEL_DROP_PREFIX)) {
            onViewChange(setChannelField(view, target.slice(CHANNEL_DROP_PREFIX.length), column.name, column.type));
        }
    }, [spec, view, selectedLayer, appendLayer, onViewChange]);

    if (!isBuilderEditable(spec)) {
        return (
            <div className={styles.builder_unsupported} data-testid="chart-builder-unsupported">
                <p>This spec composes several views. The builder edits single views and their layers only.</p>
                <Button size={ButtonSize.Small} onClick={props.onEditJson}>Edit the JSON</Button>
            </div>
        );
    }

    const markType = getMarkType(view);
    return (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragColumn(null)}>
            <div className={styles.builder} data-testid="chart-builder">
                {/* The view is shared by the layers */}
                <ViewSection spec={spec} onChange={onChange} />
                <section className={styles.builder_section} aria-labelledby="chart-builder-columns">
                    <h3 id="chart-builder-columns" className={styles.builder_heading}>Columns</h3>
                    {props.columns.length === 0 ? (
                        <p className={styles.builder_hint}>Run the query to list its columns.</p>
                    ) : (
                        <ul className={styles.column_list} aria-label="Result columns">
                            {props.columns.map(column => <DraggableColumn key={column.name} column={column} />)}
                        </ul>
                    )}
                </section>
                <LayerBar
                    spec={spec}
                    selected={selectedLayer}
                    onSelect={selectLayer}
                    onAdd={() => appendLayer(addLayer(spec, newLayerView(view)))}
                    onRemove={() => {
                        onChange(removeLayer(spec, selectedLayer));
                        selectLayer(Math.max(0, selectedLayer - 1));
                    }}
                />
                <div className={styles.layer_panel} data-testid="chart-layer-panel">
                    <section className={styles.builder_section} aria-labelledby="chart-builder-mark">
                        <h3 id="chart-builder-mark" className={styles.builder_heading}>Mark</h3>
                        <div className={styles.mark_list} role="group" aria-labelledby="chart-builder-mark" data-testid="chart-mark">
                            {MARKS.map(({ mark, icon: MarkIcon }) => (
                                <IconButton
                                    key={mark}
                                    className={styles.mark_button}
                                    variant={mark === markType ? ButtonVariant.Default : ButtonVariant.Invisible}
                                    size={ButtonSize.Small}
                                    aria-label={mark}
                                    aria-pressed={mark === markType}
                                    data-testid={`chart-mark-${mark}`}
                                    onClick={() => { if (mark !== markType) onViewChange(setMarkType(view, mark)); }}
                                >
                                    <MarkIcon size={16} />
                                </IconButton>
                            ))}
                        </div>
                    </section>
                    <section className={styles.builder_section} aria-labelledby="chart-builder-encoding">
                        <div className={styles.builder_heading_row}>
                            <h3 id="chart-builder-encoding" className={styles.builder_heading}>Encoding</h3>
                            {addableChannels.length > 0 && (
                                <ChartSelect
                                    aria-label="Add channel"
                                    data-testid="chart-add-channel"
                                    variant={ButtonVariant.Invisible}
                                    value={null}
                                    placeholder="Add channel"
                                    options={addableChannels}
                                    onChange={channel => setAddedChannels(current => [...current, channel])}
                                />
                            )}
                        </div>
                        <div className={styles.channel_list}>
                            {visibleChannels.map(channel => (
                                <ChannelRow
                                    key={`${selectedLayer}:${channel}`}
                                    channel={channel}
                                    spec={view}
                                    columns={props.columns}
                                    onChange={onViewChange}
                                    onRemove={() => {
                                        setAddedChannels(current => current.filter(c => c !== channel));
                                        onViewChange(removeChannel(view, channel));
                                    }}
                                />
                            ))}
                        </div>
                    </section>
                </div>
            </div>
            <DragOverlay dropAnimation={null}>
                {dragColumn != null ? <ColumnChip column={dragColumn} dragging /> : null}
            </DragOverlay>
        </DndContext>
    );
}

interface LayerBarProps {
    spec: ChartSpec;
    selected: number;
    onSelect: (index: number) => void;
    onAdd: () => void;
    onRemove: () => void;
}

/// The layers of the chart, one button per layer and a target that adds a layer for a dropped column
function LayerBar(props: LayerBarProps) {
    const count = layerCount(props.spec);
    return (
        <section className={styles.builder_section} aria-labelledby="chart-builder-layers">
            <h3 id="chart-builder-layers" className={styles.builder_heading}>Layers</h3>
            <div className={styles.layer_bar}>
                <div className={styles.layer_list} role="group" aria-labelledby="chart-builder-layers" data-testid="chart-layers">
                    {Array.from({ length: count }, (_, index) => {
                        const mark = getMarkType(getLayer(props.spec, index));
                        const MarkIcon = mark != null ? MARK_ICONS.get(mark) : undefined;
                        return (
                            <button
                                key={index}
                                type="button"
                                className={styles.layer_button}
                                aria-pressed={index === props.selected}
                                aria-label={`Layer ${index + 1}: ${mark ?? 'no mark'}`}
                                data-testid={`chart-layer-${index}`}
                                onClick={() => props.onSelect(index)}
                            >
                                {MarkIcon != null && <MarkIcon size={16} aria-hidden="true" />}
                                <span className={styles.layer_name}>{mark ?? 'layer'}</span>
                            </button>
                        );
                    })}
                    <AddLayerTarget onAdd={props.onAdd} />
                </div>
                {count > 1 && (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={`Remove layer ${props.selected + 1}`}
                        data-testid="chart-layer-remove"
                        onClick={props.onRemove}
                    >
                        <TrashIcon size={16} />
                    </IconButton>
                )}
            </div>
        </section>
    );
}

/// Add a layer on click, or a layer that shows a column dropped onto it
function AddLayerTarget(props: { onAdd: () => void }) {
    const { setNodeRef, isOver, active } = useDroppable({ id: LAYER_DROP_ID });
    return (
        <button
            ref={setNodeRef}
            type="button"
            className={styles.layer_add}
            data-dragging={active != null || undefined}
            data-over={isOver || undefined}
            aria-label="Add a layer"
            title="Add a layer, or drop a column to show it in a new layer"
            data-testid="chart-layer-add"
            onClick={props.onAdd}
        >
            <PlusIcon size={16} aria-hidden="true" />
            {active != null && <span>Drop to add a layer</span>}
        </button>
    );
}

function ColumnChip(props: { column: ChartColumn; dragging?: boolean }) {
    return (
        <span
            className={classNames(styles.column_chip, { [styles.column_chip_dragging]: props.dragging, [styles.column_chip_missing]: props.column.missing })}
            title={props.column.missing ? `${props.column.name} is no column of the result` : props.column.name}
        >
            <span className={styles.type_badge} data-type={props.column.type}>{FIELD_TYPE_SHORT[props.column.type]}</span>
            <span className={styles.column_name}>{props.column.name}</span>
        </span>
    );
}

function DraggableColumn(props: { column: ChartColumn }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `${COLUMN_DRAG_PREFIX}${props.column.name}`,
        data: { column: props.column },
    });
    return (
        <li
            ref={setNodeRef}
            className={classNames(styles.column_item, { [styles.column_item_source]: isDragging })}
            data-testid="chart-column"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${props.column.name} onto a channel`}
        >
            <ColumnChip column={props.column} />
        </li>
    );
}

interface ChannelRowProps {
    channel: string;
    spec: ChartSpec;
    columns: readonly ChartColumn[];
    onChange: (spec: ChartSpec) => void;
    onRemove: () => void;
}

function ChannelRow(props: ChannelRowProps) {
    const { channel, spec, onChange } = props;
    const [expanded, setExpanded] = React.useState(false);
    const { setNodeRef, isOver, active } = useDroppable({ id: `${CHANNEL_DROP_PREFIX}${channel}` });
    const def = getChannel(spec, channel);
    const custom = isCustomChannel(def);
    const count = isCountChannel(def);
    const fieldDef = def != null && !custom ? def as Record<string, unknown> : null;
    const field = typeof fieldDef?.field === 'string' ? fieldDef.field : null;
    const type = typeof fieldDef?.type === 'string' && (FIELD_TYPES as readonly string[]).includes(fieldDef.type) ? fieldDef.type as FieldType : null;
    const encoded = field != null || count;

    const fieldOptions = React.useMemo<ChartSelectOption[]>(() => {
        const options: ChartSelectOption[] = props.columns.map(column => ({
            value: column.name,
            label: column.name,
            description: column.missing ? 'not in the result' : column.type,
        }));
        if (field != null && !props.columns.some(column => column.name === field)) {
            options.push({ value: field, label: field });
        }
        options.push({ value: COUNT_OPTION, label: 'count()', description: 'the number of rows' });
        return options;
    }, [props.columns, field]);

    const pickField = (value: string) => {
        if (value === COUNT_OPTION) {
            onChange(setChannelCount(spec, channel));
            return;
        }
        const column = props.columns.find(c => c.name === value);
        onChange(setChannelField(spec, channel, value, type ?? column?.type ?? 'nominal'));
    };

    return (
        <div
            ref={setNodeRef}
            className={classNames(styles.channel_row, { [styles.channel_row_drop]: active != null, [styles.channel_row_over]: isOver })}
            data-testid={`chart-channel-${channel}`}
        >
            <div className={styles.channel_main}>
                <span className={styles.channel_label}>{channel}</span>
                {custom ? (
                    <span className={styles.custom_pill} title="Edit this channel in the JSON">custom</span>
                ) : (
                    <>
                        <ChartSelect
                            aria-label={`Field of ${channel}`}
                            data-testid={`chart-channel-${channel}-field`}
                            className={styles.field_select}
                            value={count ? COUNT_OPTION : field}
                            triggerLabel={channelSummary(def) ?? undefined}
                            placeholder="Drop or pick a field"
                            options={fieldOptions}
                            onChange={pickField}
                        />
                        <ChartSelect
                            aria-label={`Type of ${channel}`}
                            data-testid={`chart-channel-${channel}-type`}
                            className={styles.type_select}
                            value={type}
                            placeholder="–"
                            options={TYPE_OPTIONS}
                            disabled={!encoded || count}
                            onChange={value => onChange(setChannelType(spec, channel, value as FieldType))}
                        />
                    </>
                )}
                <IconButton
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label={`${expanded ? 'Hide' : 'Show'} the options of ${channel}`}
                    aria-expanded={expanded}
                    disabled={!encoded || custom}
                    onClick={() => setExpanded(e => !e)}
                >
                    <MoreIcon size={16} />
                </IconButton>
                <IconButton
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label={`Remove ${channel}`}
                    data-testid={`chart-channel-${channel}-remove`}
                    disabled={def == null && (DEFAULT_CHANNELS as readonly string[]).includes(channel)}
                    onClick={() => {
                        // A default channel keeps its row, the other channels disappear with their field
                        if (encoded && !custom) {
                            onChange(clearChannelField(spec, channel));
                        } else {
                            props.onRemove();
                        }
                    }}
                >
                    <XIcon size={16} />
                </IconButton>
            </div>
            {expanded && encoded && !custom && fieldDef != null && (
                <ChannelOptions channel={channel} def={fieldDef} type={type} count={count} spec={spec} onChange={onChange} />
            )}
        </div>
    );
}

interface ChannelOptionsProps {
    channel: string;
    def: Record<string, unknown>;
    type: FieldType | null;
    count: boolean;
    spec: ChartSpec;
    onChange: (spec: ChartSpec) => void;
}

function ChannelOptions(props: ChannelOptionsProps) {
    const { channel, def, spec, onChange } = props;
    const patch = (values: Record<string, unknown>) => onChange(patchChannel(spec, channel, values));
    const optionValue = (value: unknown) => typeof value === 'string' ? value : NONE_OPTION;
    const sort = typeof def.sort === 'string' ? def.sort : null;
    const stack = def.stack === null ? 'null' : typeof def.stack === 'string' ? def.stack : NONE_OPTION;
    return (
        <div className={styles.channel_options} data-testid={`chart-channel-${channel}-options`}>
            {!props.count && (
                <div className={styles.option_row}>
                    <span className={styles.option_label}>Aggregate</span>
                    <ChartSelect
                        aria-label={`Aggregate of ${channel}`}
                        className={styles.select_block}
                        value={optionValue(def.aggregate)}
                        placeholder="none"
                        options={AGGREGATE_OPTIONS}
                        onChange={value => patch({ aggregate: value === NONE_OPTION ? undefined : value })}
                    />
                </div>
            )}
            {props.type === 'quantitative' && !props.count && (
                <label className={styles.option_row}>
                    <span className={styles.option_label}>Bin</span>
                    <input
                        type="checkbox"
                        aria-label={`Bin ${channel}`}
                        checked={def.bin === true || (def.bin != null && typeof def.bin === 'object')}
                        onChange={event => patch({ bin: event.target.checked ? true : undefined })}
                    />
                </label>
            )}
            {props.type === 'temporal' && (
                <div className={styles.option_row}>
                    <span className={styles.option_label}>Time unit</span>
                    <ChartSelect
                        aria-label={`Time unit of ${channel}`}
                        className={styles.select_block}
                        value={optionValue(def.timeUnit)}
                        placeholder="none"
                        options={TIME_UNIT_OPTIONS}
                        onChange={value => patch({ timeUnit: value === NONE_OPTION ? undefined : value })}
                    />
                </div>
            )}
            {(sort != null || def.sort == null) && (
                <div className={styles.option_row}>
                    <span className={styles.option_label}>Sort</span>
                    <ChartSelect
                        aria-label={`Sort of ${channel}`}
                        className={styles.select_block}
                        value={sort ?? NONE_OPTION}
                        placeholder="none"
                        options={SORT_OPTIONS}
                        onChange={value => patch({ sort: value === NONE_OPTION ? undefined : value })}
                    />
                </div>
            )}
            {(channel === 'x' || channel === 'y' || channel === 'theta') && (
                <div className={styles.option_row}>
                    <span className={styles.option_label}>Stack</span>
                    <ChartSelect
                        aria-label={`Stack of ${channel}`}
                        className={styles.select_block}
                        value={stack}
                        placeholder="default"
                        options={STACK_OPTIONS}
                        onChange={value => patch({ stack: value === NONE_OPTION ? undefined : value === 'null' ? null : value })}
                    />
                </div>
            )}
            <div className={styles.option_row}>
                <span className={styles.option_label}>Title</span>
                <SpecTextInput
                    aria-label={`Title of ${channel}`}
                    value={typeof def.title === 'string' ? def.title : ''}
                    onCommit={text => patch({ title: text.length === 0 ? undefined : text })}
                />
            </div>
        </div>
    );
}

/// The title of the chart, a string or the text of a title object
function chartTitle(spec: ChartSpec): string {
    const title = spec.title;
    if (typeof title === 'string') return title;
    if (title != null && typeof title === 'object' && typeof (title as Record<string, unknown>).text === 'string') {
        return (title as Record<string, unknown>).text as string;
    }
    return '';
}

/// The settings of the whole chart, collapsed until the user opens them. Collapsed, the heading shows the title.
function ViewSection(props: { spec: ChartSpec; onChange: (spec: ChartSpec) => void }) {
    const [open, setOpen] = React.useState(false);
    const title = chartTitle(props.spec);
    return (
        <section className={styles.builder_section} aria-labelledby="chart-builder-view">
            <h3 className={styles.builder_heading_toggle}>
                <button
                    type="button"
                    id="chart-builder-view"
                    className={styles.section_toggle}
                    aria-expanded={open}
                    aria-controls="chart-builder-view-settings"
                    data-testid="chart-view-toggle"
                    onClick={() => setOpen(o => !o)}
                >
                    <span className={styles.builder_heading}>View</span>
                    {!open && title.length > 0 && <span className={styles.section_summary}>{title}</span>}
                    {open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                </button>
            </h3>
            {open && (
                <div id="chart-builder-view-settings">
                    <ViewSettings spec={props.spec} onChange={props.onChange} />
                </div>
            )}
        </section>
    );
}

/// A size of the view: a number of pixels or `container`
function parseViewSize(text: string): number | 'container' | undefined | null {
    const trimmed = text.trim();
    if (trimmed.length === 0) return undefined;
    if (trimmed === 'container') return 'container';
    const value = Number(trimmed);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function ViewSettings(props: { spec: ChartSpec; onChange: (spec: ChartSpec) => void }) {
    const { spec, onChange } = props;
    const title = spec.title;
    const titleText = chartTitle(spec);
    const setTitle = (text: string) => {
        if (title != null && typeof title === 'object' && !Array.isArray(title)) {
            onChange(setTopLevel(spec, 'title', { ...(title as Record<string, unknown>), text }));
        } else {
            onChange(setTopLevel(spec, 'title', text.length === 0 ? undefined : text));
        }
    };
    const sizeInput = (key: 'width' | 'height') => (
        <div className={styles.option_row}>
            <span className={styles.option_label}>{key === 'width' ? 'Width' : 'Height'}</span>
            <SpecTextInput
                aria-label={`${key === 'width' ? 'Width' : 'Height'} of the chart`}
                placeholder="auto"
                value={spec[key] == null ? '' : String(spec[key])}
                onCommit={text => {
                    const size = parseViewSize(text);
                    if (size !== null) onChange(setTopLevel(spec, key, size));
                }}
            />
        </div>
    );
    return (
        <div className={styles.view_settings}>
            <div className={styles.option_row}>
                <span className={styles.option_label}>Title</span>
                <SpecTextInput aria-label="Title of the chart" value={titleText} onCommit={setTitle} data-testid="chart-title" />
            </div>
            {sizeInput('width')}
            {sizeInput('height')}
        </div>
    );
}

interface SpecTextInputProps {
    'aria-label': string;
    'data-testid'?: string;
    value: string;
    placeholder?: string;
    /// Every edit of the text, the caller ignores text that is no valid value
    onCommit: (text: string) => void;
}

/// A text input that keeps the typed text while the spec holds another representation, e.g. a partly typed size
function SpecTextInput(props: SpecTextInputProps) {
    const [text, setText] = React.useState(props.value);
    const lastValue = React.useRef(props.value);
    if (lastValue.current !== props.value) {
        lastValue.current = props.value;
        if (text !== props.value) setText(props.value);
    }
    return (
        <TextInput
            className={styles.text_input}
            aria-label={props['aria-label']}
            data-testid={props['data-testid']}
            placeholder={props.placeholder}
            value={text}
            onChange={event => {
                setText(event.target.value);
                props.onCommit(event.target.value);
            }}
        />
    );
}
