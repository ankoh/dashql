// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_PARSE_CONTEXT_H_
#define INCLUDE_DASHQL_PARSER_PARSE_CONTEXT_H_

#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>
#include <iostream>
#include "dashql/parser/module_builder.h"

namespace dashql {
namespace parser {

// The location type
struct Location {
    /// The offset
    size_t offset;
    /// The length
    size_t length;

    /// Constructor
    Location()
        : offset(0), length(0) {}
    /// Constructor
    Location(size_t offset, size_t length)
        : offset(offset), length(length) {}

    /// Encode the location
    auto encode() const { return proto::syntax::Location(offset, length); }
    /// Merge two locations
    Location operator+(const Location& other) {
        return {offset, std::max(offset + length, other.offset + other.length) - offset};
    }
    /// Return the location
    friend std::ostream& operator<<(std::ostream& out, const Location& loc) {
        out << "[" << loc.offset << "," << (loc.offset + loc.length) << "[";
        return out;
    }
};

// Schema parse context
class ParseContext: public ModuleBuilder {
    friend class Parser;

    protected:
    /// Trace the scanning
    bool _trace_scanning;
    /// Trace the parsing
    bool _trace_parsing;
    /// The input (if any)
    std::string_view _input;

    /// Begin a scan
    void beginScan(std::string_view in);
    /// End a scan
    void endScan();

    public:
    /// Constructor
    explicit ParseContext(bool trace_scanning = false, bool trace_parsing = false);
    /// Destructor
    virtual ~ParseContext();

    /// Get the text at location
    inline std::string_view TextAt(Location loc) { return _input.substr(loc.offset, loc.length); }

    /// Parse an istream
    void Parse(std::string_view in);
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSE_CONTEXT_H_
