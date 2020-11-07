// Copyright (c) 2020 The DashQL Authors

#include <iostream>
#include <sstream>
#include <unordered_set>
#include <unordered_map>
#include "dashql/parser/common/error.h"
#include "dashql/parser/common/variant.h"
#include "dashql/parser/parser.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/scanner.h"

namespace dashql {
namespace parser {

std::ostream& operator<<(std::ostream& out, const Location& loc) {
    out << "[" << loc.offset() << "," << (loc.offset() + loc.length()) << "[";
    return out;
}

ParserDriver::ParserDriver(Scanner& scanner)
    : ModuleBuilder(), _scanner(scanner) {}

ParserDriver::~ParserDriver() {}

flatbuffers::Offset<sx::Module> ParserDriver::Parse(flatbuffers::FlatBufferBuilder& builder, std::string_view in, bool trace_scanning, bool trace_parsing) {

    // XXX shortcut until tests are migrated
    std::vector<char> padded_buffer{in.begin(), in.end()};
    padded_buffer.push_back(0);
    padded_buffer.push_back(0);

    Scanner scanner{padded_buffer};
    ParserDriver driver{scanner};

    dashql::parser::Parser parser(scanner.state(), driver);
    parser.parse();

    return driver.Write(builder);
}

}
}
