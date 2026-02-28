#pragma once

#include "dashql/buffers/index_generated.h"
#include "gtest/gtest.h"
#include "pugixml.hpp"

namespace dashql::testing {

/// Make sure the xml nodes match
::testing::AssertionResult Matches(const pugi::xml_node& have, const pugi::xml_node& expected);
/// Encode a location
void EncodeLocation(pugi::xml_node n, buffers::parser::Location loc, std::string_view text, const char* loc_key = "loc",
                    const char* text_key = "text");
/// Encode a location
void WriteLocation(pugi::xml_node n, buffers::parser::Location loc, std::string_view text);
/// Encode an error
void EncodeError(pugi::xml_node n, const buffers::parser::ErrorT& err, std::string_view text);
/// Indent text (leading/trailing newline + N*4 spaces after each inner newline)
std::string IndentXMLTextValue(size_t level, const std::string& text);
/// Unindent text (trim surrounding newlines, strip one level of 4-space indent after newlines)
std::string UnindentXMLTextValue(std::string text);
/// Unindent text by level (inverse of IndentXMLTextValue(level, text))
std::string UnindentXMLTextValue(std::string text, size_t level);

}  // namespace dashql::testing
