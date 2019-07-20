//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/parser/tql/tql_parse_context.h"
#include "./gen/tql_parser.h"
#include "tigon/infra/error.h"
#include <iostream>
#include <sstream>
#include <unordered_set>

using namespace tigon::tql;
using D = tigon::tql::DisplayStatement;

ParseContext::ParseContext(bool trace_scanning, bool trace_parsing)
    : trace_scanning(trace_scanning), trace_parsing(trace_parsing), display(std::make_unique<DisplayStatement>()) {}

ParseContext::~ParseContext() {}

Program ParseContext::Parse(std::istream &in) {
    beginScan(in);
    tigon::tql::Parser parser(*this);
    parser.set_debug_level(trace_parsing);
    parser.parse();
    endScan();

    // TODO
    return {};
}

// Yield an error
void ParseContext::Error(const std::string &m) { throw TQLParseError(m); }

// Yield an error
void ParseContext::Error(uint32_t line, uint32_t column, const std::string &err) {
    std::stringstream ss;
    ss << "[ l=" << line << " c=" << column << " ] " << err << std::endl;
    throw TQLParseError(ss.str());
}
