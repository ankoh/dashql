//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/parser/tql/tql_parse_context.h"
#include "tigon/common/error.h"
#include "tigon/parser/tql/tql_parser.h"
#include <iostream>
#include <sstream>
#include <unordered_set>

using namespace tigon::tql;
using D = tigon::tql::DisplayStatement;

ParseContext::ParseContext(bool trace_scanning, bool trace_parsing)
    : trace_scanning(trace_scanning), trace_parsing(trace_parsing), statements() {}

ParseContext::~ParseContext() {}

Program ParseContext::Parse(std::string_view in) {
    beginScan(in);
    {
        tigon::tql::Parser parser(*this);
        parser.set_debug_level(trace_parsing);
        parser.parse();
    }
    endScan();
    return Program {
        std::move(statements)
    };
}

// Yield an error
void ParseContext::Error(const std::string &m) { throw TQLParseError(m); }

// Yield an error
void ParseContext::Error(uint32_t line, uint32_t column, const std::string &err) {
    std::stringstream ss;
    ss << "[" << line << ":" << column << "] " << err;
    throw TQLParseError(ss.str());
}

/// Define a statement
void ParseContext::DefineStatement(Statement statement) {
    statements.push_back(move(statement));
}
