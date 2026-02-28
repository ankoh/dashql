#pragma once

#include "dashql/buffers/index_generated.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql::testing {

/// Compare two YAML subtrees by emitting to string (order and format may matter).
::testing::AssertionResult Matches(c4::yml::ConstNodeRef have, c4::yml::ConstNodeRef expected);

/// Compare have with the content of expected_keymap (ignores the key; compares with the map's children).
::testing::AssertionResult MatchesContent(c4::yml::ConstNodeRef have, c4::yml::ConstNodeRef expected_keymap);

/// Encode a location into a YAML map node (adds loc_key and text_key children).
void EncodeLocation(c4::yml::NodeRef n, buffers::parser::Location loc, std::string_view text,
                    const char* loc_key = "loc", const char* text_key = "text");

/// Encode an error (message + location).
void EncodeError(c4::yml::NodeRef n, const buffers::parser::ErrorT& err, std::string_view text);

}  // namespace dashql::testing
