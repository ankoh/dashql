//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/parser/rpath/rpath_parse_context.h"
#include "tigon/parser/rpath/rpath_parser.h"
#include "tigon/infra/error.h"
#include <iostream>
#include <sstream>
#include <unordered_set>

using namespace tigon::rpath;

ParseContext::ParseContext(bool trace_scanning, bool trace_parsing)
    : trace_scanning(trace_scanning), trace_parsing(trace_parsing) {}

ParseContext::~ParseContext() {}

RecordPath ParseContext::Parse(std::istream &in) {
    beginScan(in);
    tigon::rpath::Parser parser(*this);
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
    ss << "[" << line << ":" << column << "] " << err;
    throw TQLParseError(ss.str());
}
