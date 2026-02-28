#pragma once

#include <string>

#include "dashql/buffers/index_generated.h"
#include "gtest/gtest.h"
#include "ryml.hpp"

namespace dashql::testing {

/// Compare two YAML subtrees by emitting to string (order and format may matter).
::testing::AssertionResult Matches(c4::yml::ConstNodeRef have, c4::yml::ConstNodeRef expected);

/// Compare have with the content of expected_keymap (ignores the key; compares with the map's children).
::testing::AssertionResult MatchesContent(c4::yml::ConstNodeRef have, c4::yml::ConstNodeRef expected_keymap);

/// Encode a location into a YAML map node
void EncodeLocationText(c4::yml::NodeRef n, buffers::parser::Location loc, std::string_view text,
                        const char* text_key = "text");
/// Encode a location into a YAML map node
void EncodeLocationRange(c4::yml::NodeRef n, buffers::parser::Location loc, std::string_view text,
                         const char* loc_key = "text");

/// Encode an error (message + location).
void EncodeError(c4::yml::NodeRef n, const buffers::parser::ErrorT& err, std::string_view text);

/// Insert a blank line before each top-level sequence element (lines starting with "  - ").
/// rapidyaml has no native option for this; improves readability of emitted YAML.
void InjectBlankLinesInSnapshot(std::string& yaml);

}  // namespace dashql::testing
