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

    /// Create a constant
    inline sx::Node AddConst(sx::Location loc, sxs::AConstType type) {
        return Add(loc, sx::NodeType::SQL_ACONST, {
            sx::AttributeKey::SQL_ACONST_TYPE << RefEnum(loc, type),
        });
    }
    /// Create indirection
    inline sx::Node AddIndirection(sx::Location loc, sx::Node index) {
        return Add(loc, sx::NodeType::SQL_INDIRECTION, {
            sx::AttributeKey::SQL_INDIRECTION_INDEX << index,
        });
    }
    /// Create indirection
    inline sx::Node AddIndirection(sx::Location loc, sx::Node lower_bound, sx::Node upper_bound) {
        return Add(loc, sx::NodeType::SQL_INDIRECTION, {
            sx::AttributeKey::SQL_INDIRECTION_LOWER_BOUND << lower_bound,
            sx::AttributeKey::SQL_INDIRECTION_UPPER_BOUND << upper_bound,
        });
    }
    /// Create relation expression
    inline sx::Node AddAlias(sx::Location loc, sx::Node name, sx::Node columns) {
        return Add(loc, sx::NodeType::SQL_ALIAS, {
            sx::AttributeKey::SQL_ALIAS_NAME << name,
            sx::AttributeKey::SQL_ALIAS_COLUMNS << columns,
        });
    }
    /// Create a temp table name
    inline sx::Node AddInto(sx::Location loc, sx::Node type, sx::Node name) {
        return Add(loc, sx::NodeType::SQL_INTO, {
            sx::AttributeKey::SQL_TEMP_TYPE << type,
            sx::AttributeKey::SQL_TEMP_NAME << name,
        });
    }
    /// Create a column ref
    inline sx::Node AddColumnRef(sx::Location loc, NodeVector&& path) {
        return Add(loc, sx::NodeType::SQL_COLUMN_REF, {
            sx::AttributeKey::SQL_COLUMN_REF_PATH << Add(loc, move(path)),
        });
    }

    /// Parse a module
    static flatbuffers::Offset<sx::Module> Parse(flatbuffers::FlatBufferBuilder& builder, std::string_view in, bool trace_scanning = false, bool trace_parsing = false);
};

} // namespace parser
} // namespace dashql

#endif // INCLUDE_DASHQL_PARSER_PARSER_DRIVER_H_
