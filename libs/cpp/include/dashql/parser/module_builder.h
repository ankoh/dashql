// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
#define INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_

#include <string_view>
#include "dashql/parser/proto/syntax_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace parser {

namespace syntax = proto::syntax;
using OptionalAttribute = std::tuple<syntax::Location, syntax::AttributeKey, std::optional<syntax::Value>>;

/// A section builder
class SectionsBuilder {
    protected:
    /// The section data
    std::vector<double> _numbers = {};
    std::vector<syntax::Span> _number_arrays = {};
    std::vector<std::string_view> _strings = {};
    std::vector<syntax::Span> _string_arrays = {};
    std::vector<syntax::Attribute> _attributes = {};
    std::vector<syntax::Object> _objects = {};
    std::vector<syntax::Span> _object_arrays = {};

    /// A null entry
    inline auto null() {
        assert(false);
        return syntax::Value(syntax::Location(), syntax::ValueType::NONE, 0);
    }

    /// Push variadic attributes
    template <typename... Tail> inline size_t PushAttributes(size_t&) { return 0; }
    template <typename Head, typename... Tail>
    inline void PushAttributes(size_t& n, Head head, Tail... tail) {
        if constexpr (std::is_same_v<Head, syntax::Attribute>) {
            _attributes.push_back(head);
            ++n;
        } else if constexpr (std::is_same_v<Head, std::optional<syntax::Attribute>>) {
            if (head) {
                _attributes.push_back(*head);
                ++n;
            }
        } else {
            assert(false);
        }
        PushAttributes(n, tail...);
    }

    public:
    /// Constructor
    SectionsBuilder() = default;

    /// Add a value
    template <typename V> syntax::Value Add(syntax::Location loc, V v) {
        auto push = [&](auto tag, auto& vec, auto&& val) {
            vec.push_back(val);
            return syntax::Value(loc, tag, vec.size() - 1);
        };
        if constexpr (std::is_same_v<V, double>) {
            return push(syntax::ValueType::NUMBER, _numbers, v);
        }
        if constexpr (std::is_same_v<V, std::string_view>) {
            return push(syntax::ValueType::STRING, _strings, v);
        }
        if constexpr (std::is_same_v<V, syntax::Object>) {
            return push(syntax::ValueType::OBJECT, _objects, v);
        }
        return null();
    }

    /// Add a value array
    template <typename V> syntax::Value Add(syntax::Location loc, const std::vector<V>& vs) {
        auto push = [&](auto tag, auto& val_vec, auto& span_vec, const auto& vs) {
            auto entry = span_vec.size();
            auto begin = val_vec.size();
            for (auto& v: vs)
                val_vec.push_back(move(v));
            span_vec.push_back(syntax::Span(begin, vs.size()));
            return syntax::Value(loc, tag, entry);
        };
        if constexpr (std::is_same_v<V, double>) {
            return push(syntax::ValueType::NUMBER_ARRAY, _numbers, _number_arrays, vs);
        }
        if constexpr (std::is_same_v<V, std::string_view>) {
            return push(syntax::ValueType::STRING_ARRAY, _strings, _string_arrays, vs);
        }
        if constexpr (std::is_same_v<V, syntax::Object>) {
            return push(syntax::ValueType::OBJECT_ARRAY, _objects, _object_arrays, vs);
        }
        return null();
    }

    /// Add node attributes
    syntax::Span AddAttributes(std::initializer_list<OptionalAttribute> attrs);
    /// Add node attributes
    syntax::Span AddAttributes(const std::vector<syntax::Attribute>& attrs);

    /// Write as flatbuffer
    flatbuffers::Offset<syntax::ModuleSections> Write(flatbuffers::FlatBufferBuilder& builder);
};

class ModuleBuilder {
    protected:
    /// The sections
    SectionsBuilder _sections;
    /// The statements
    std::vector<syntax::Object> _statements;
    /// The errors
    std::vector<std::pair<syntax::Location, std::string>> _errors;
    /// The line breaks
    std::vector<syntax::Location> _line_breaks;
    /// The comments
    std::vector<syntax::Location> _comments;

    public:
    /// Constructor
    ModuleBuilder();

    /// Get the sections
    auto& sections() { return _sections; }
    /// Get the statements
    auto& statements() { return _statements; }
    /// Get the errors
    auto& errors() { return _errors; }

    /// Add a statement
    inline void AddStatement(syntax::Object object) { _statements.push_back(object); }
    /// Add a line break
    inline void AddLineBreak(syntax::Location loc) { _line_breaks.push_back(loc); }
    /// Add a comment
    inline void AddComment(syntax::Location loc) { _comments.push_back(loc); }
    /// Add an error
    inline void AddError(syntax::Location loc, const std::string& message) { _errors.push_back({loc, message}); }
    /// Add a string vector
    inline syntax::Value AddStringArray(syntax::Location loc, const std::vector<std::string_view>& strings) { return _sections.Add(loc, strings); }

    /// Add an object
    syntax::Object CreateObject(syntax::Location loc, syntax::ObjectType type, std::initializer_list<OptionalAttribute> attrs);
    /// Add an object
    syntax::Object CreateObject(syntax::Location loc, syntax::ObjectType type, const std::vector<syntax::Attribute>& attrs);
    /// Create viz tag
    syntax::Value CreateVizTag(syntax::Location loc, syntax::VizType vizType) const {
        return {loc, syntax::ValueType::NUMBER, static_cast<double>(vizType)};
    }
    /// Collect viz attributes
    std::vector<syntax::Attribute> CollectViz(syntax::Location viz_loc, syntax::VizType viz_type, std::initializer_list<std::reference_wrapper<std::vector<syntax::Attribute>>> attributes);

    /// Write as flatbuffer
    flatbuffers::Offset<syntax::Module> Write(flatbuffers::FlatBufferBuilder& builder);
};

}
}

#endif // INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
