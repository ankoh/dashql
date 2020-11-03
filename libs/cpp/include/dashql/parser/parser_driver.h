// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
#define INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_

#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>
#include <iostream>
#include "dashql/parser/module_builder.h"
#include "dashql/parser/proto/syntax_dashql_generated.h"
#include "dashql/parser/proto/syntax_generated.h"
#include "dashql/parser/proto/syntax_sql_generated.h"

namespace dashql {
namespace parser {

namespace sx = dashql::proto::syntax;
namespace sxd = dashql::proto::syntax_dashql;

using Location = sx::Location;

/// Return the location
std::ostream& operator<<(std::ostream& out, const Location& loc);

// Schema parser driver
class ParserDriver: public ModuleBuilder {
    friend class Parser;

    protected:
    /// The input (if any)
    std::string_view _input;
    /// Trace the scanning
    bool _trace_scanning;
    /// Trace the parsing
    bool _trace_parsing;

    public:
    /// Constructor
    explicit ParserDriver(std::string_view text, bool trace_scanning = false, bool trace_parsing = false);
    /// Destructor
    ~ParserDriver();

    /// Trace scanning
    auto trace_scanning() const { return _trace_scanning; }
    /// Trace parsing?
    auto trace_parsing() const { return _trace_parsing; }

    /// Begin a scan
    void BeginScan();
    /// End a scan
    void EndScan();

    /// Get the text at location
    inline std::string_view TextAt(Location loc) { return _input.substr(loc.offset(), loc.length()); }


    /// Create an integer constant
    inline sx::Value CreateIntConst(sx::Location loc, int64_t v) {
        return AddObject(loc, sx::ObjectType::SQL_ACONST, {
            {sx::AttributeKey::SQL_ACONST_TYPE, CreateEnum(loc, sxs::AConstType::INTEGER)},
            {sx::AttributeKey::SQL_ACONST_VALUE, sx::Value{loc, sx::ValueType::I64, v}},
        });
    }

    /// Create a constant
    inline sx::Value CreateConst(sx::Location loc, sxs::AConstType type) {
        return AddObject(loc, sx::ObjectType::SQL_ACONST, {
            {sx::AttributeKey::SQL_ACONST_TYPE, CreateEnum(loc, type)},
        });
    }

    /// Create indirection
    inline sx::Value CreateIndirection(sx::Location loc, std::optional<sx::Value> lower_bound) {
        return AddObject(loc, sx::ObjectType::SQL_INDIRECTION, {
            {sx::AttributeKey::SQL_INDIRECTION_INDEX, lower_bound},
        });
    }

    /// Create indirection
    inline sx::Value CreateIndirection(sx::Location loc, std::optional<sx::Value> lower_bound, std::optional<sx::Value> upper_bound) {
        return AddObject(loc, sx::ObjectType::SQL_INDIRECTION, {
            {sx::AttributeKey::SQL_INDIRECTION_LOWER_BOUND, lower_bound},
            {sx::AttributeKey::SQL_INDIRECTION_UPPER_BOUND, upper_bound},
        });
    }

    /// Create relation expression
    inline sx::Value CreateRelationExpr(sx::Location loc, sx::Value name, sx::Value inherit) {
        return AddObject(loc, sx::ObjectType::SQL_RELATION_EXPR, {
            {sx::AttributeKey::SQL_RELATION_EXPR_NAME, name},
            {sx::AttributeKey::SQL_RELATION_EXPR_INHERIT, inherit},
        });
    }

    /// Parse a module
    static flatbuffers::Offset<sx::Module> Parse(flatbuffers::FlatBufferBuilder& builder, std::string_view in, bool trace_scanning = false, bool trace_parsing = false);
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
