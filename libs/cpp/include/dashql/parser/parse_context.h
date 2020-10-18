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
#include "dashql/parser/syntax.h"

namespace dashql {
namespace parser {

// Schema parse context
class ParseContext {
    friend class Parser;

    protected:
    /// Trace the scanning
    bool trace_scanning;
    /// Trace the parsing
    bool trace_parsing;
    /// The statements
    std::vector<Statement> statements;
    /// The errors
    std::vector<Error> errors;

    /// Begin a scan
    void beginScan(std::string_view in);
    /// End a scan
    void endScan();

    public:
    /// Constructor
    explicit ParseContext(bool trace_scanning = false, bool trace_parsing = false);
    /// Destructor
    virtual ~ParseContext();

    /// Parse an istream
    Program Parse(std::string_view in);
    /// Throw an error
    void RaiseError(Location location, const std::string& message);
    /// Define a statement
    void DefineStatement(Statement statement, Location location);
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSE_CONTEXT_H_
