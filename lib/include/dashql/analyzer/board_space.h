// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_BOARD_SPACE_H_
#define INCLUDE_DASHQL_ANALYZER_BOARD_SPACE_H_

#include <cstdint>
#include <vector>

namespace dashql {

struct BoardPosition {
    uint32_t width;
    uint32_t height;
    uint32_t row;
    uint32_t column;
};

struct BoardSpace {
    /// The cell bitmask. 1 = occupied, 0 = free.
    std::vector<uint8_t> cells;

    /// Constructor
    BoardSpace();
    /// Allocate space
    BoardPosition Allocate(BoardPosition pref);
};

}  // namespace dashql

#endif
