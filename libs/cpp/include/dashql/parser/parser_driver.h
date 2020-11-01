// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
#define INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_

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
#include "dashql/parser/proto/syntax_dashql_generated.h"
#include "dashql/parser/proto/syntax_generated.h"
#include "dashql/parser/proto/syntax_sql_generated.h"

namespace dashql {
namespace parser {

namespace sx = dashql::proto::syntax;
namespace sxd = dashql::proto::syntax_dashql;
using Location = sx::Location;

/// Return the location
std::ostream& operator<<(std::ostream& out, const Location& loc);

// Schema parser driver
class ParserDriver: public ModuleBuilder {
    friend class Parser;

    protected:
    /// The input (if any)
    std::string_view _input;
    /// Trace the scanning
    bool _trace_scanning;
    /// Trace the parsing
    bool _trace_parsing;

    public:
    /// Constructor
    explicit ParserDriver(std::string_view text, bool trace_scanning = false, bool trace_parsing = false);
    /// Destructor
    ~ParserDriver();

    /// Trace scanning
    auto trace_scanning() const { return _trace_scanning; }
    /// Trace parsing?
    auto trace_parsing() const { return _trace_parsing; }

    /// Begin a scan
    void BeginScan();
    /// End a scan
    void EndScan();

    /// Get the text at location
    inline std::string_view TextAt(Location loc) { return _input.substr(loc.offset(), loc.length()); }



    /// Parse a module
    static flatbuffers::Offset<sx::Module> Parse(flatbuffers::FlatBufferBuilder& builder, std::string_view in, bool trace_scanning = false, bool trace_parsing = false);
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
