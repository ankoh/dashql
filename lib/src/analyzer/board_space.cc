// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/board_space.h"

#include <iostream>

static constexpr uint32_t CELL_MASK_SHIFT = 3;
static constexpr uint32_t COLUMNS_PER_ROW = 12;
static constexpr uint32_t MAX_ROWS = 100;
static constexpr uint32_t MAX_HEIGHT = 40;
static constexpr uint32_t DEFAULT_WIDTH = 12;
static constexpr uint32_t DEFAULT_HEIGHT = 4;

namespace dashql {

namespace {

inline bool isSet(const std::vector<uint8_t>& cells, size_t row, size_t col) {
    auto i = row * COLUMNS_PER_ROW + col;
    auto& block = cells[i >> CELL_MASK_SHIFT];
    auto local = i & ((1 << CELL_MASK_SHIFT) - 1);
    return (block & (1 << local)) != 0;
}

inline void set(std::vector<uint8_t>& cells, size_t row, size_t col) {
    auto i = row * COLUMNS_PER_ROW + col;
    auto& block = cells[i >> CELL_MASK_SHIFT];
    auto local = i & ((1 << CELL_MASK_SHIFT) - 1);
    block |= (1 << local);
}

inline void unset(std::vector<uint8_t>& cells, size_t row, size_t col) {
    auto i = row * COLUMNS_PER_ROW + col;
    auto& block = cells[i >> CELL_MASK_SHIFT];
    auto local = i & ((1 << CELL_MASK_SHIFT) - 1);
    block &= ~(1 << local);
};

}  // namespace

/// Constructor
BoardSpace::BoardSpace() : cells() {}

/// Allocate a position
BoardPosition BoardSpace::Allocate(BoardPosition pref) {
    // Make sure that at least pref.row + pref.height rows are allocated
    pref.width = std::min(pref.width, COLUMNS_PER_ROW);
    pref.height = std::min(pref.height, MAX_HEIGHT);
    pref.width = pref.width == 0 ? DEFAULT_WIDTH : pref.width;
    pref.height = pref.height == 0 ? DEFAULT_HEIGHT : pref.height;
    pref.row = std::min(pref.row, MAX_ROWS - pref.height);
    pref.column = std::min(pref.column, COLUMNS_PER_ROW - pref.width);

    // Resize the block mask
    auto max_columns = std::min(COLUMNS_PER_ROW - pref.width + 1, COLUMNS_PER_ROW);
    auto max_rows = pref.row + pref.height;
    auto current_rows = (cells.size() << CELL_MASK_SHIFT) / COLUMNS_PER_ROW;
    if (current_rows < max_rows) {
        cells.resize(((max_rows * COLUMNS_PER_ROW) >> CELL_MASK_SHIFT) + 1, 0);
    }

    // Naive brute-force space allocation.
    // We could be smarter here but it's very likely not necessary.
    uint32_t row = 0, col = 0;
    for (row = pref.row; row < max_rows; ++row) {
        for (col = (row == pref.row) ? pref.column : 0; col < max_columns; ++col) {
            bool qualifies = true;
            for (auto r = row; r < (row + pref.height); ++r) {
                for (auto c = col; c < (col + pref.width); ++c) {
                    qualifies &= !isSet(cells, r, c);
                }
            }
            if (qualifies) {
                goto found_space;
            }
        }
    }

    // Could not allocate the block?
    // Resize the buffer.
    max_rows = row + pref.height;
    cells.resize(((max_rows * COLUMNS_PER_ROW) >> CELL_MASK_SHIFT) + 1, 0);

found_space:
    // Mark the bits as occupied
    for (size_t r = row; r < (row + pref.height); ++r) {
        for (size_t c = col; c < (col + pref.width); ++c) {
            set(cells, r, c);
        }
    }

    // Return position
    return {
        .width = pref.width,
        .height = pref.height,
        .row = row,
        .column = col,
    };
}

}  // namespace dashql
