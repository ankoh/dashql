// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
#define INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_

#include <string_view>
#include "dashql/parser/proto/syntax_generated.h"
#include "dashql/parser/proto/syntax_dashql_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace parser {

namespace sx = proto::syntax;
namespace sxd = proto::syntax_dashql;
using OptionalAttribute = std::tuple<sx::Location, sx::AttributeKey, std::optional<sx::Value>>;

/// A section builder
class SectionsBuilder {
    protected:
    /// The section data
    std::vector<double> _numbers = {};
    std::vector<sx::Span> _number_arrays = {};
    std::vector<std::string_view> _strings = {};
    std::vector<sx::Span> _string_arrays = {};
    std::vector<sx::Attribute> _attributes = {};
    std::vector<sx::Object> _objects = {};
    std::vector<sx::Span> _object_arrays = {};

    /// A null entry
    inline auto null() {
        assert(false);
        return sx::Value(sx::Location(), sx::ValueType::NONE, 0);
    }

    /// Push variadic attributes
    template <typename... Tail> inline size_t PushAttributes(size_t&) { return 0; }
    template <typename Head, typename... Tail>
    inline void PushAttributes(size_t& n, Head head, Tail... tail) {
        if constexpr (std::is_same_v<Head, sx::Attribute>) {
            _attributes.push_back(head);
            ++n;
        } else if constexpr (std::is_same_v<Head, std::optional<sx::Attribute>>) {
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
    template <typename V> sx::Value Add(sx::Location loc, V v) {
        auto push = [&](auto tag, auto& vec, auto&& val) {
            vec.push_back(val);
            return sx::Value(loc, tag, vec.size() - 1);
        };
        if constexpr (std::is_same_v<V, double>) {
            return push(sx::ValueType::NUMBER, _numbers, v);
        }
        if constexpr (std::is_same_v<V, std::string_view>) {
            return push(sx::ValueType::STRING, _strings, v);
        }
        if constexpr (std::is_same_v<V, sx::Object>) {
            return push(sx::ValueType::OBJECT, _objects, v);
        }
        return null();
    }

    /// Add a value array
    template <typename V> sx::Value Add(sx::Location loc, const std::vector<V>& vs) {
        auto push = [&](auto tag, auto& val_vec, auto& span_vec, const auto& vs) {
            auto entry = span_vec.size();
            auto begin = val_vec.size();
            for (auto& v: vs)
                val_vec.push_back(move(v));
            span_vec.push_back(sx::Span(begin, vs.size()));
            return sx::Value(loc, tag, entry);
        };
        if constexpr (std::is_same_v<V, double>) {
            return push(sx::ValueType::NUMBER_ARRAY, _numbers, _number_arrays, vs);
        }
        if constexpr (std::is_same_v<V, std::string_view>) {
            return push(sx::ValueType::STRING_ARRAY, _strings, _string_arrays, vs);
        }
        if constexpr (std::is_same_v<V, sx::Object>) {
            return push(sx::ValueType::OBJECT_ARRAY, _objects, _object_arrays, vs);
        }
        return null();
    }

    /// Add node attributes
    sx::Span AddAttributes(std::initializer_list<OptionalAttribute> attrs);
    /// Add node attributes
    sx::Span AddAttributes(const std::vector<sx::Attribute>& attrs);

    /// Write as flatbuffer
    flatbuffers::Offset<sx::ModuleSections> Write(flatbuffers::FlatBufferBuilder& builder);
};

class ModuleBuilder {
    protected:
    /// The sections
    SectionsBuilder _sections;
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
    auto& sections() { return _sections; }
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
    inline sx::Value AddStringArray(sx::Location loc, const std::vector<std::string_view>& strings) { return _sections.Add(loc, strings); }

    /// Add an object
    sx::Object CreateObject(sx::Location loc, sx::ObjectType type, std::initializer_list<OptionalAttribute> attrs);
    /// Add an object
    sx::Object CreateObject(sx::Location loc, sx::ObjectType type, const std::vector<sx::Attribute>& attrs);

    /// Collect viz attributes
    std::vector<sx::Attribute> CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<std::vector<sx::Attribute>>> attributes);

    /// Write as flatbuffer
    flatbuffers::Offset<sx::Module> Write(flatbuffers::FlatBufferBuilder& builder);
};

}
}

#endif // INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
