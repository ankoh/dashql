// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_SCRIPT_OPTIONS_H_
#define INCLUDE_DASHQL_PARSER_SCRIPT_OPTIONS_H_

#include <string_view>

namespace dashql {
namespace parser {

struct ScriptOptions {
    /// The global namespace name
    std::string_view global_namespace;

    /// Constructor
    ScriptOptions();
};

}  // namespace parser
}  // namespace dashql

#endif
