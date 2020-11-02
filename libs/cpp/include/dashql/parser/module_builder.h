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
using AttributeVector = std::vector<sx::Attribute>;
using ValueVector = std::vector<sx::Value>;

/// A document builder
class DocumentBuilder {
    public: 
    using OptionalAttribute = std::pair<sx::AttributeKey, std::optional<sx::Value>>;

    protected:
    std::vector<sx::Value> _entries = {};
    std::vector<sx::Object> _objects = {};
    std::vector<sx::Attribute> _attributes = {};
    std::vector<sx::Array> _arrays = {};
    std::vector<sx::Value> _array_values = {};

    /// A null entry
    inline auto null() {
        assert(false);
        return sx::Value(sx::Location(), sx::ValueType::NONE, 0);
    }

    public:
    /// Constructor
    DocumentBuilder() = default;

    /// Get entries
    auto& entries() const { return _entries; }

    /// Add an entry
    void AddEntry(sx::Value object);
    /// Add an object
    sx::Value AddObject(sx::Location loc, sx::Object object);
    /// Add an array
    sx::Value AddArray(sx::Location loc, ValueVector&& values);
    /// Add node attributes
    sx::Span AddAttributes(std::initializer_list<OptionalAttribute> attrs);
    /// Add node attributes
    sx::Span AddAttributes(AttributeVector&& attrs);

    /// Write as flatbuffer
    flatbuffers::Offset<sx::Document> Write(flatbuffers::FlatBufferBuilder& builder);
};

class ModuleBuilder {
    public:
    /// An object builder
    class PartialObject {
        protected:
        /// The context
        ModuleBuilder& builder;
        /// The object type
        sx::ObjectType type;
        /// The attributes
        AttributeVector attributes;

        public:
        /// Constructor
        PartialObject(ModuleBuilder& builder, sx::ObjectType type, std::initializer_list<sx::Attribute> attrs);
        /// Constructor
        PartialObject(ModuleBuilder& builder, sx::ObjectType type, AttributeVector&& attrs);

        /// Add a single attribute 
        PartialObject& AddAttribute(sx::Attribute attr);
        /// Add attributes
        PartialObject& AddAttributes(std::initializer_list<sx::Attribute> attrs);
        /// Add attributes
        PartialObject& AddAttributes(AttributeVector&& attrs);

        /// Finish the object
        sx::Value Finish(sx::Location loc);
    };

    protected:
    /// The document
    DocumentBuilder _statements;
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
    auto& statements() { return _statements; }
    /// Get the errors
    auto& errors() { return _errors; }

    /// Add a statement
    inline void AddStatement(sx::Value value) { _statements.AddEntry(value); }
    /// Add a line break
    inline void AddLineBreak(sx::Location loc) { _line_breaks.push_back(loc); }
    /// Add a comment
    inline void AddComment(sx::Location loc) { _comments.push_back(loc); }
    /// Add an error
    inline void AddError(sx::Location loc, const std::string& message) { _errors.push_back({loc, message}); }

    /// Add a string vector
    inline sx::Value AddArray(sx::Location loc, ValueVector&& values) { return _statements.AddArray(loc, move(values)); }
    /// Add a string vector
    inline sx::Value AddObject(sx::Object object) { return _statements.AddObject(object.location(), object); }
    /// Add an object
    inline std::optional<sx::Value> AddObject(std::optional<sx::Object> object) {
        if (!object)
            return std::nullopt;
        return AddObject(*object);
    }
    /// Create an enum
    template <typename Enum>
    inline sx::Value CreateEnum(sx::Location loc, Enum e) const { return sx::Value(loc, sx::ValueType::I64, static_cast<int64_t>(e)); }
    /// Create a string
    sx::Value CreateString(sx::Location loc) const { return sx::Value(loc, sx::ValueType::STRING, 0); }
    /// Add an object
    sx::Value AddObject(sx::Location loc, sx::ObjectType type, std::initializer_list<DocumentBuilder::OptionalAttribute> attrs = {});
    /// Add an object
    sx::Value AddObject(sx::Location loc, sx::ObjectType type, AttributeVector&& attrs);

    /// Start an object
    PartialObject StartObject(sx::ObjectType type, std::initializer_list<DocumentBuilder::OptionalAttribute> attrs);
    /// Start an object with attributes
    PartialObject StartObject(sx::ObjectType type, AttributeVector&& attrs);

    /// Collect viz attributes
    AttributeVector CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<AttributeVector>> attributes);

    /// Write as flatbuffer
    flatbuffers::Offset<sx::Module> Write(flatbuffers::FlatBufferBuilder& builder);
};

}
}

#endif // INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
