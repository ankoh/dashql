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
    auto column_candidates = std::min(COLUMNS_PER_ROW - pref.width + 1, COLUMNS_PER_ROW);
    auto required_rows = pref.row + pref.height;
    auto row_count = (cells.size() << CELL_MASK_SHIFT) / COLUMNS_PER_ROW;
    if (row_count < required_rows) {
        cells.resize(((required_rows * COLUMNS_PER_ROW) >> CELL_MASK_SHIFT) + 1, 0);
        row_count = required_rows;
    }

    // Brute-force space allocation.
    // We could be smarter here but it's very likely not necessary.
    uint32_t row = 0, col = 0;
    while (true) {
        // Naively check every origin candidate
        for (row = pref.row; row < (row_count - pref.height); ++row) {
            for (col = (row == pref.row) ? pref.column : 0; col < column_candidates; ++col) {
                // Check if all cells are free
                bool qualifies = true;
                for (auto r = row; r < (row + pref.height); ++r) {
                    for (auto c = col; c < (col + pref.width); ++c) {
                        qualifies &= !isSet(cells, r, c);
                    }
                }
                // Does not qualify?
                if (!qualifies) continue;
                // Mark the cells as occupied
                for (size_t r = row; r < (row + pref.height); ++r) {
                    for (size_t c = col; c < (col + pref.width); ++c) {
                        set(cells, r, c);
                    }
                }
                // Return the position
                return {
                    .width = pref.width,
                    .height = pref.height,
                    .row = row,
                    .column = col,
                };
            }
        }
        // Could not allocate the block?
        // Resize the buffer.
        row_count += pref.height;
        cells.resize(((row_count * COLUMNS_PER_ROW) >> CELL_MASK_SHIFT) + 1, 0);
    }
}

}  // namespace dashql
