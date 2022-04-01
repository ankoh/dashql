// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_GRAMMAR_DSON_H_
#define INCLUDE_DASHQL_PARSER_GRAMMAR_DSON_H_

#include <charconv>

#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"

namespace dashql {
namespace parser {

class DSONDictionary {
    /// The text
    const std::string_view program_text_;
    /// The text
    const sx::ProgramT& program_;
    /// The key mapping
    const std::unordered_map<std::string_view, uint16_t> key_mapping_;

   public:
    /// Constructor
    DSONDictionary(std::string_view program_text, const sx::ProgramT& program);

    /// Get an attribute key from a string
    uint16_t keyFromString(std::string_view text) const;
    /// Get the string representation of a key
    std::string_view keyToString(uint16_t key) const;
    /// Get the string representation of a key for a script
    std::string_view keyToStringForScript(uint16_t key, std::string& tmp) const;
    /// Get the (camelCase) string representation of a key for JSON
    std::string_view keyToStringForJSON(uint16_t key, std::string& tmp) const;
};

}  // namespace parser
}  // namespace dashql

#endif
