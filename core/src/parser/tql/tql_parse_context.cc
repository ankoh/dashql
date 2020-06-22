//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include <iostream>
#include <sstream>
#include <unordered_set>
#include "tigon/common/error.h"
#include "tigon/parser/tql/tql_parse_context.h"
#include "tigon/parser/tql/tql_parser.h"

using namespace tigon::tql;

ParseContext::ParseContext(bool trace_scanning, bool trace_parsing): trace_scanning(trace_scanning), trace_parsing(trace_parsing), statements() {}

ParseContext::~ParseContext() {}

Module ParseContext::Parse(std::string_view in) {
    beginScan(in);
    {
        tigon::tql::Parser parser(*this);
        parser.set_debug_level(trace_parsing);
        parser.parse();
    }
    endScan();
    return Module{std::move(statements), std::move(errors)};
}

// Yield an error
void ParseContext::Error(const std::string& message) {
    throw TQLParseError(message);
}

// Yield an error
void ParseContext::Error(Location location, const std::string& message) {
    errors.push_back({location, message});
}

/// Define a statement
void ParseContext::DefineStatement(Statement statement) {
    statements.push_back(std::move(statement));
}
