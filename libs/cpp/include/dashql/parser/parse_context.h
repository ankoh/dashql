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

using Location = syntax::Location;

/// Return the location
std::ostream& operator<<(std::ostream& out, const Location& loc);

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
    inline std::string_view TextAt(Location loc) { return _input.substr(loc.offset(), loc.length()); }

    /// Parse an istream
    void Parse(std::string_view in);
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSE_CONTEXT_H_
