// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
#define INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_

#include <string_view>
#include "dashql/parser/proto/syntax_generated.h"
#include "dashql/parser/proto/syntax_dashql_generated.h"
#include "dashql/parser/proto/syntax_sql_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace parser {

namespace sx = proto::syntax;
namespace sxd = proto::syntax_dashql;
namespace sxs = proto::syntax_sql;

/// A document builder
class DocumentBuilder {
    public: 
    using OptionalAttribute = std::tuple<sx::Location, sx::AttributeKey, std::optional<sx::Value>>;

    protected:
    std::vector<sx::Object> _objects = {};
    std::vector<sx::Attribute> _attributes = {};
    std::vector<sx::Array> _arrays = {};
    std::vector<int32_t> _values_i32 = {};
    std::vector<sx::Location> _values_string = {};

    /// A null entry
    inline auto null() {
        assert(false);
        return sx::Value(sx::Location(), sx::ValueType::NONE, 0);
    }

    public:
    /// Constructor
    DocumentBuilder() = default;

    /// Add an object
    sx::Value AddObject(sx::Location loc, sx::Object object);
    /// Add an array
    sx::Value AddArray(sx::Location loc, const std::vector<sx::Location>& strings);
    /// Add an array
    sx::Value AddArray(sx::Location loc, const std::vector<sx::Object>& objects);
    /// Add node attributes
    sx::Span AddAttributes(std::initializer_list<OptionalAttribute> attrs);
    /// Add node attributes
    sx::Span AddAttributes(const std::vector<sx::Attribute>& attrs);

    /// Write as flatbuffer
    flatbuffers::Offset<sx::Document> Write(flatbuffers::FlatBufferBuilder& builder);
};

class ModuleBuilder {
    protected:
    /// The document
    DocumentBuilder _document;
    /// The statements
    std::vector<sx::Object> _statements;
    /// The errors
    std::vector<std::pair<sx::Location, std::string>> _errors;
    /// The line breaks
    std::vector<sx::Location> _line_breaks;
    /// The comments
    std::vector<sx::Location> _comments;

    public:
    /// Constructor
    ModuleBuilder();

    /// Get the sections
    auto& document() { return _document; }
    /// Get the statements
    auto& statements() { return _statements; }
    /// Get the errors
    auto& errors() { return _errors; }

    /// Add a statement
    inline void AddStatement(sx::Object object) { _statements.push_back(object); }
    /// Add a line break
    inline void AddLineBreak(sx::Location loc) { _line_breaks.push_back(loc); }
    /// Add a comment
    inline void AddComment(sx::Location loc) { _comments.push_back(loc); }
    /// Add an error
    inline void AddError(sx::Location loc, const std::string& message) { _errors.push_back({loc, message}); }

    /// Add a string vector
    inline sx::Value AddArray(sx::Location loc, const std::vector<sx::Location>& strings) { return _document.AddArray(loc, strings); }
    /// Add a string vector
    inline sx::Value AddObject(sx::Location loc, sx::Object object) { return _document.AddObject(loc, object); }
    /// Create an enum
    template <typename Enum>
    inline sx::Value CreateEnum(sx::Location loc, Enum e) const { return sx::Value(loc, sx::ValueType::I32, static_cast<int32_t>(e)); }

    /// Add an object
    sx::Object CreateObject(sx::Location loc, sx::ObjectType type, std::initializer_list<DocumentBuilder::OptionalAttribute> attrs);
    /// Add an object
    sx::Object CreateObject(sx::Location loc, sx::ObjectType type, const std::vector<sx::Attribute>& attrs);
    /// Add an object
    sx::Value AddObject(sx::Location loc, sx::ObjectType type, std::initializer_list<DocumentBuilder::OptionalAttribute> attrs);
    /// Add an object
    sx::Value AddObject(sx::Location loc, sx::ObjectType type, const std::vector<sx::Attribute>& attrs);

    /// Collect viz attributes
    std::vector<sx::Attribute> CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<std::vector<sx::Attribute>>> attributes);

    /// Write as flatbuffer
    flatbuffers::Offset<sx::Module> Write(flatbuffers::FlatBufferBuilder& builder);
};

}
}

#endif // INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
