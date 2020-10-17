// Copyright (c) 2020 The DashQL Authors

#include <iostream>
#include <sstream>
#include <unordered_set>
#include "dashql/parser/common/error.h"
#include "dashql/parser/common/variant.h"
#include "dashql/parser/parse_context.h"
#include "dashql/parser/parser.h"

using namespace dashql::parser;

ParseContext::ParseContext(bool trace_scanning, bool trace_parsing): trace_scanning(trace_scanning), trace_parsing(trace_parsing), statements() {}

ParseContext::~ParseContext() {}

Module ParseContext::Parse(std::string_view in) {
    beginScan(in);
    {
        dashql::parser::Parser parser(*this);
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
                        [&](ParameterDeclaration& parameter) { parameter.location = location; },
                        // Load statement
                        [&](LoadStatement& load) { load.location = location; },
                        // Extract statement
                        [&](ExtractStatement& extract) { extract.location = location; },
                        // SQL statement
                        [&](QueryStatement& query) { query.location = location; },
                        // Viz statement
                        [&](VizStatement& viz) { viz.location = location; }},
               statement);

    statements.push_back(std::move(statement));
}
