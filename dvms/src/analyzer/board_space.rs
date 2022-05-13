const CELL_MASK_SHIFT: usize = 3;
const COLUMNS_PER_ROW: usize = 12;
const MAX_ROWS: usize = 100;
const MAX_HEIGHT: usize = 40;
const DEFAULT_WIDTH: usize = 12;
const DEFAULT_HEIGHT: usize = 4;

pub struct BoardPosition {
    pub width: u32,
    pub height: u32,
    pub row: u32,
    pub column: u32,
}

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
    pub fn allocate(pref: BoardPosition) -> BoardPosition {
        pref
    }
}
