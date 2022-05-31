const CELL_MASK_SHIFT: usize = 3;
const COLUMNS_PER_ROW: usize = 12;
const MAX_ROWS: usize = 100;
const MAX_HEIGHT: usize = 40;
const DEFAULT_WIDTH: usize = 12;
const DEFAULT_HEIGHT: usize = 4;

#[derive(Default)]
pub struct BoardPosition {
    pub row: usize,
    pub column: usize,
    pub width: usize,
    pub height: usize,
}

#[derive(Default)]
pub struct BoardSpace {
    /// The cell bitmask. 1 = occupied, 0 = free.
    pub cells: Vec<u8>,
}

impl BoardSpace {
    pub fn is_set(&self, row: usize, col: usize) -> bool {
        let i = row * COLUMNS_PER_ROW + col;
        let block = &self.cells[i >> CELL_MASK_SHIFT];
        let local = i & ((1 << CELL_MASK_SHIFT) - 1);
        return (block & (1 << local)) != 0;
    }

    pub fn set(&mut self, row: usize, col: usize) {
        let i = row * COLUMNS_PER_ROW + col;
        let local = i & ((1 << CELL_MASK_SHIFT) - 1);
        self.cells[i >> CELL_MASK_SHIFT] |= (1 << local) as u8;
    }

    pub fn unset(&mut self, row: usize, col: usize) {
        let i = row * COLUMNS_PER_ROW + col;
        let local = i & ((1 << CELL_MASK_SHIFT) - 1);
        self.cells[i >> CELL_MASK_SHIFT] &= !(1 << local) as u8;
    }

    /// Allocate a board position
    pub fn allocate(&mut self, mut pref: BoardPosition) -> BoardPosition {
        // Make sure that at least pref.row + pref.height rows are allocated
        pref.width = pref.width.min(COLUMNS_PER_ROW);
        pref.height = pref.height.min(MAX_HEIGHT);
        pref.width = if pref.width == 0 { DEFAULT_WIDTH } else { pref.width };
        pref.height = if pref.height == 0 { DEFAULT_HEIGHT } else { pref.height };
        pref.row = pref.row.min(MAX_ROWS - pref.height);
        pref.column = pref.column.min(COLUMNS_PER_ROW - pref.width);

        // Resize the block mask
        let column_candidates = COLUMNS_PER_ROW.min(COLUMNS_PER_ROW - pref.width + 1);
        let required_rows = pref.row + pref.height;
        let mut row_count = (self.cells.len() << CELL_MASK_SHIFT) / COLUMNS_PER_ROW;
        if row_count < required_rows {
            self.cells
                .resize(((required_rows * COLUMNS_PER_ROW) >> CELL_MASK_SHIFT) + 1, 0);
            row_count = required_rows;
        }

        // Brute-force space allocation.
        // We could be smarter here but it's very likely not necessary.
        loop {
            // Naively check every origin candidate
            for row in pref.row..(row_count - pref.height) {
                for col in (if row == pref.row { pref.column } else { 0 })..column_candidates {
                    // Check if all cells are free
                    let mut qualifies = true;
                    for r in row..(row + pref.height) {
                        for c in col..(col + pref.width) {
                            qualifies &= !self.is_set(r, c);
                        }
                    }
                    // Does not qualify?
                    if !qualifies {
                        continue;
                    }
                    // Mark the cells as occupied
                    for r in row..(row + pref.height) {
                        for c in col..(col + pref.width) {
                            self.set(r, c);
                        }
                    }
                    // Return the position
                    return BoardPosition {
                        row,
                        column: col,
                        width: pref.width,
                        height: pref.height,
                    };
                }
            }
            // Could not allocate the block?
            // Resize the buffer.
            row_count += pref.height;
            self.cells
                .resize(((row_count * COLUMNS_PER_ROW) >> CELL_MASK_SHIFT) + 1, 0)
        }
    }
}
