//---------------------------------------------------------------------------
// DashQL
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include <iostream>
#include <sstream>
#include <unordered_set>
#include "dashql/common/error.h"
#include "dashql/common/variant.h"
#include "dashql/parser/tql/tql_parse_context.h"
#include "dashql/parser/tql/tql_parser.h"

using namespace dashql::tql;

ParseContext::ParseContext(bool trace_scanning, bool trace_parsing): trace_scanning(trace_scanning), trace_parsing(trace_parsing), statements() {}

ParseContext::~ParseContext() {}

Module ParseContext::Parse(std::string_view in) {
    beginScan(in);
    {
        dashql::tql::Parser parser(*this);
        parser.set_debug_level(trace_parsing);
        parser.parse();
    }
    endScan();
    return Module{std::move(statements), std::move(errors)};
}

// Yield an error
void ParseContext::RaiseError(Location location, const std::string& message) {
    errors.push_back({location, message});
}

/// Define a statement
void ParseContext::DefineStatement(Statement statement, Location location) {
    std::visit(overload{// Parameter declaration
                        [&](tql::ParameterDeclaration& parameter) { parameter.location = location; },
                        // Load statement
                        [&](tql::LoadStatement& load) { load.location = location; },
                        // Extract statement
                        [&](tql::ExtractStatement& extract) { extract.location = location; },
                        // SQL statement
                        [&](tql::QueryStatement& query) { query.location = location; },
                        // Viz statement
                        [&](tql::VizStatement& viz) { viz.location = location; }},
               statement);

    statements.push_back(std::move(statement));
}
