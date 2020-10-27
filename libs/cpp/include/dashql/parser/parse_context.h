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
    size_t offset;
    size_t length;

    /// Encode the location
    auto encode() const {
        return proto::syntax::Location(offset, length);
    }
    /// Return the location
    friend std::ostream& operator<<(std::ostream& out, const Location& loc) {
        out << "[" << loc.offset << "," << (loc.offset + loc.length) << "[";
        return out;
    }
};

// Schema parse context
class ParseContext {
    friend class Parser;

    protected:
    /// Trace the scanning
    bool _trace_scanning;
    /// Trace the parsing
    bool _trace_parsing;
    /// The statements
    ModuleBuilder _module;
    /// The input (if any)
    std::string_view _input;

    /// Begin a scan
    void beginScan(std::string_view in);
    /// End a scan
    void endScan();
    /// Get the text at location
    inline std::string_view textAt(Location loc) { return _input.substr(loc.offset, loc.length); }

    public:
    /// Constructor
    explicit ParseContext(bool trace_scanning = false, bool trace_parsing = false);
    /// Destructor
    virtual ~ParseContext();

    /// Return the module
    auto& module() { return _module; }

    /// Add a string
    inline auto AddString(Location loc) { return _module.sections().Add(loc.encode(), textAt(loc)); }
    /// Add an error
    inline auto AddError(Location loc, std::string message) { _module.AddError(loc.encode(), message); }
    /// Add a statement
    void AddStatement(uint32_t object);

    /// Parse an istream
    ModuleBuilder Parse(std::string_view in);
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSE_CONTEXT_H_
