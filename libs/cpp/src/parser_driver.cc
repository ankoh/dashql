// Copyright (c) 2020 The DashQL Authors

#include <iostream>
#include <sstream>
#include <unordered_set>
#include <unordered_map>
#include "dashql/parser/common/error.h"
#include "dashql/parser/common/variant.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/parser.h"


namespace dashql {
namespace parser {

namespace {

/// A keyword category
enum class KeywordCategory {
    DASHQL,
    SQL_COLUMN_NAME,
    SQL_RESERVED,
    SQL_TYPE_FUNC,
    SQL_UNRESERVED
};

/// A keyword
struct Keyword {
    /// The name
    std::string_view name;
    /// The token
    Parser::token::token_kind_type token;
    /// The category
    KeywordCategory category;
};

/// The keyword map
static const std::unordered_map<std::string_view, Keyword> keywords = {
#define X(CATEGORY, NAME, TOKEN) { NAME, Keyword{ NAME, Parser::token::DQL_##TOKEN, KeywordCategory::CATEGORY } },
#include "./grammar/keywords/dashql_keywords.list"
#include "./grammar/keywords/sql_column_name_keywords.list"
#include "./grammar/keywords/sql_reserved_keywords.list"
#include "./grammar/keywords/sql_type_func_keywords.list"
#include "./grammar/keywords/sql_unreserved_keywords.list"
#undef X
};

}

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
