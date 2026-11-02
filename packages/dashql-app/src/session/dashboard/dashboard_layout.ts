export const DASHBOARD_COLUMN_COUNT = 12;
/// A row is a single line, as high as a collapsed card
export const DASHBOARD_ROW_HEIGHT = 40;
export const DASHBOARD_GRID_GAP = 12;
export const DASHBOARD_DEFAULT_WIDTH = 6;
export const DASHBOARD_DEFAULT_HEIGHT = 6;
/// A script without a visualization only offers its renderers, a third of the board is enough
export const DASHBOARD_COLLAPSED_WIDTH = 4;

export interface DashboardLayoutHint {
    row?: number | null;
    column?: number | null;
    width?: number | null;
    height?: number | null;
}

/// The board stacks its sections: the scripts without a renderer on top, the visualizations below.
/// Every section is a grid of its own, rows and columns count from its top left corner.
export type DashboardSection = 'scripts' | 'visualizations';

export interface DashboardLayoutItem extends DashboardLayoutHint {
    id: number;
    /// Defaults to the visualizations
    section?: DashboardSection;
}

export interface DashboardPlacement {
    id: number;
    section: DashboardSection;
    row: number;
    column: number;
    width: number;
    height: number;
}

function clampInteger(value: number | null | undefined, fallback: number, minimum: number, maximum: number): number {
    if (value == null || !Number.isFinite(value)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function normalize(item: DashboardLayoutItem): DashboardPlacement {
    const width = clampInteger(item.width, DASHBOARD_DEFAULT_WIDTH, 1, DASHBOARD_COLUMN_COUNT);
    return {
        id: item.id,
        section: item.section ?? 'visualizations',
        row: clampInteger(item.row, 0, 0, Number.MAX_SAFE_INTEGER),
        column: clampInteger(item.column, 0, 0, DASHBOARD_COLUMN_COUNT - width),
        width,
        height: clampInteger(item.height, DASHBOARD_DEFAULT_HEIGHT, 1, Number.MAX_SAFE_INTEGER),
    };
}

export function dashboardPlacementsIntersect(a: DashboardPlacement, b: DashboardPlacement): boolean {
    return a.column < b.column + b.width
        && a.column + a.width > b.column
        && a.row < b.row + b.height
        && a.row + a.height > b.row;
}

function findOpenPlacement(item: DashboardPlacement, placed: readonly DashboardPlacement[]): DashboardPlacement {
    let row = item.row;
    let column = item.column;
    while (true) {
        const candidate = { ...item, row, column };
        if (!placed.some(other => dashboardPlacementsIntersect(candidate, other))) return candidate;
        column += 1;
        if (column + item.width > DASHBOARD_COLUMN_COUNT) {
            column = 0;
            row += 1;
        }
    }
}

/** Place items deterministically, every section on its own. `ownerId` is placed first and therefore owns its requested cells. */
export function placeDashboardItems(
    items: readonly DashboardLayoutItem[],
    ownerId: number | null = null,
): DashboardPlacement[] {
    const normalized = items.map(normalize);
    const ordered = ownerId == null
        ? normalized
        : [
            ...normalized.filter(item => item.id === ownerId),
            ...normalized.filter(item => item.id !== ownerId),
        ];
    const placed: DashboardPlacement[] = [];
    for (const item of ordered) {
        placed.push(findOpenPlacement(item, placed.filter(other => other.section === item.section)));
    }
    const byId = new Map(placed.map(item => [item.id, item]));
    return items.map(item => byId.get(item.id)!);
}

export function moveDashboardItem(
    items: readonly DashboardPlacement[],
    ownerId: number,
    row: number,
    column: number,
): DashboardPlacement[] {
    return placeDashboardItems(items.map(item => item.id === ownerId ? { ...item, row, column } : item), ownerId);
}

export function resizeDashboardItem(
    items: readonly DashboardPlacement[],
    ownerId: number,
    width: number,
    height: number,
): DashboardPlacement[] {
    return placeDashboardItems(items.map(item => item.id === ownerId ? { ...item, width, height } : item), ownerId);
}

/// The number of rows of a section
export function dashboardSectionRows(items: readonly DashboardPlacement[], section: DashboardSection): number {
    return items.reduce((max, item) => item.section === section ? Math.max(max, item.row + item.height) : max, 0);
}

/// The height of a card in pixels, with the gaps between its rows
export function dashboardCardHeight(rows: number): number {
    return rows * DASHBOARD_ROW_HEIGHT + Math.max(0, rows - 1) * DASHBOARD_GRID_GAP;
}
