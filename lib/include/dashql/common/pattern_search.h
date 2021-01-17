// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_PATTERN_SEARCH_H_
#define INCLUDE_DASHQL_COMMON_PATTERN_SEARCH_H_

#include <array>
#include <string>

#include "dashql/proto_generated.h"

namespace dashql {

/// The shifts array allows for linear searching of multi-byte values. For each position, it determines the next
/// position given that we encounter a byte with the given value.
///
///     For example, if we have a std::string "ABAC", the shifts array will have the following values:
///     [0] --> ['A'] = 1, all others = 0
///     [1] --> ['B'] = 2, ['A'] = 1, all others = 0
///     [2] --> ['A'] = 3, all others = 0
///     [3] --> ['C'] = 4 (match), 'B' = 2, 'A' = 1, all others = 0
///
///     Suppose we then search in the following std::string "ABABAC", our progression will be as follows:
///     'A' -> [1], 'B' -> [2], 'A' -> [3], 'B' -> [2], 'A' -> [3], 'C' -> [4] (match!)
///
/// Adopted from the buffered csv reader of DuckDB.
///
struct PatternShiftArray {
    /// The length of the pattern
    size_t length;
    /// The shifts
    std::unique_ptr<uint8_t[]> shifts;

    /// Constructor
    PatternShiftArray();
    /// Constructor
    PatternShiftArray(std::string pattern);

    inline bool Match(uint8_t &position, uint8_t byte_value) {
        if (position >= length) {
            return false;
        }
        position = shifts[position * 255 + byte_value];
        return position == length;
    }
};

}  // namespace dashql

#endif
