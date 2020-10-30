// Copyright (c) 2020 The DashQL Authors

#include <iostream>
#include <sstream>
#include <unordered_set>
#include "dashql/parser/common/error.h"
#include "dashql/parser/common/variant.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/parser.h"


namespace dashql {
namespace parser {

/// Return the location
std::ostream& operator<<(std::ostream& out, const Location& loc) {
    out << "[" << loc.offset() << "," << (loc.offset() + loc.length()) << "[";
    return out;
}

ParserDriver::ParserDriver(std::string_view text, bool trace_scanning, bool trace_parsing)
    : ModuleBuilder(), _input(text), _trace_scanning(trace_scanning), _trace_parsing(trace_parsing) {}

ParserDriver::~ParserDriver() {}

flatbuffers::Offset<sx::Module> ParserDriver::Parse(flatbuffers::FlatBufferBuilder& builder, std::string_view in, bool trace_scanning, bool trace_parsing) {
    ParserDriver ctx{in, trace_scanning, trace_parsing};
    ctx.BeginScan();
    {
        dashql::parser::Parser parser(ctx);
        parser.set_debug_level(ctx.trace_parsing());
        parser.parse();
    }
    ctx.EndScan();
    return ctx.Write(builder);
}

}
}
