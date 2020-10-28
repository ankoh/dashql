// Copyright (c) 2020 The DashQL Authors

#include <iostream>
#include <sstream>
#include <unordered_set>
#include "dashql/parser/common/error.h"
#include "dashql/parser/common/variant.h"
#include "dashql/parser/parse_context.h"
#include "dashql/parser/parser.h"


namespace dashql {
namespace parser {

ParseContext::ParseContext(bool trace_scanning, bool trace_parsing)
    : ModuleBuilder(), _trace_scanning(trace_scanning), _trace_parsing(trace_parsing) {}

ParseContext::~ParseContext() {}

void ParseContext::Parse(std::string_view in) {
    _input = in;
    beginScan(_input);
    {
        dashql::parser::Parser parser(*this);
        parser.set_debug_level(_trace_parsing);
        parser.parse();
    }
    endScan();
}

}
}
