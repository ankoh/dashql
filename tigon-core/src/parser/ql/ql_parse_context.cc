// ---------------------------------------------------------------------------------------------------
// Tigon
// ---------------------------------------------------------------------------------------------------
#include "tigon/parser/ql/ql_parse_context.h"
#include "./gen/ql_parser.h"
#include <sstream>
#include <unordered_set>
#include "tigon/infra/error.h"
// ---------------------------------------------------------------------------------------------------
using namespace tigon::ql;
// ---------------------------------------------------------------------------------------------------
Type Type::Integer()    { Type t; t.tclass = kInteger; return t; }
Type Type::Timestamp()  { Type t; t.tclass = kTimestamp; return t; }
Type Type::Numeric(unsigned length, unsigned precision) {
    Type t;
    t.tclass = kNumeric;
    t.length = length;
    t.precision = precision;
    return t;
}
Type Type::Char(unsigned length) {
    Type t;
    t.tclass = kChar;
    t.length = length;
    return t;
}
Type Type::Varchar(unsigned length) {
    Type t;
    t.tclass = kVarchar;
    t.length = length;
    return t;
}
// ---------------------------------------------------------------------------------------------------
const char *Type::Name() const {
    switch (tclass) {
        case kInteger:      return "Integer";
        case kTimestamp:    return "Timestamp";
        case kNumeric:      return "Numeric";
        case kChar:         return "Character";
        case kVarchar:      return "Varchar";
        default:            return "Unknown";
    }
}
// ---------------------------------------------------------------------------------------------------
// Constructor
ParseContext::ParseContext(bool trace_scanning, bool trace_parsing)
    : trace_scanning_(trace_scanning), trace_parsing_(trace_parsing) {}
// ---------------------------------------------------------------------------------------------------
// Destructor
ParseContext::~ParseContext() {}
// ---------------------------------------------------------------------------------------------------
// Parse a string
Schema ParseContext::Parse(std::istream &in) {
    beginScan(in);
    tigon::ql::Parser parser(*this);
    parser.set_debug_level(trace_parsing_);
    parser.parse();
    endScan();

    // TODO
    return {};
}
// ---------------------------------------------------------------------------------------------------
// Yield an error
void ParseContext::Error(const std::string& m) {
    throw TQLParseError(m);
}
// ---------------------------------------------------------------------------------------------------
// Yield an error
void ParseContext::Error(uint32_t line, uint32_t column, const std::string &err) {
    std::stringstream ss;
    ss << "[ l=" << line << " c=" << column << " ] " << err << std::endl;
    throw TQLParseError(ss.str());
}
// ---------------------------------------------------------------------------------------------------
// Define a table
void ParseContext::defineFoo(const std::string &id, const std::vector<SomeDeclaration> &declarations) {
    std::cout << "FOO " << id << std::endl;
    for (auto &decl : declarations) {
        std::cout << "    " << decl.id << " " << decl.type.Name() << std::endl;
    }
}
// ---------------------------------------------------------------------------------------------------


