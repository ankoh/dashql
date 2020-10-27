// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
#define INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_

#include <string_view>
#include "dashql/parser/proto/syntax_generated.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace parser {

/// A section builder
class SectionsBuilder {
    protected:
    /// The section data
    std::vector<double> _numbers = {};
    std::vector<proto::syntax::Span> _number_arrays = {};
    std::vector<std::string_view> _strings = {};
    std::vector<proto::syntax::Span> _string_arrays = {};
    std::vector<proto::syntax::Attribute> _attributes = {};
    std::vector<proto::syntax::Object> _objects = {};
    std::vector<proto::syntax::Span> _object_arrays = {};

    /// A null entry
    inline auto null() {
        assert(false);
        return proto::syntax::Value(proto::syntax::Location(), proto::syntax::ValueType::NONE, 0);
    }

    public:
    /// Constructor
    SectionsBuilder() = default;

    /// Add a value
    template <typename V> proto::syntax::Value Add(proto::syntax::Location loc, V v) {
        auto push = [&](auto tag, auto& vec, auto&& val) {
            vec.push_back(val);
            return proto::syntax::Value(loc, tag, vec.size() - 1);
        };
        if constexpr (std::is_same_v<V, double>) {
            return push(proto::syntax::ValueType::NUMBER, _numbers, v);
        }
        if constexpr (std::is_same_v<V, std::string_view>) {
            return push(proto::syntax::ValueType::STRING, _strings, v);
        }
        if constexpr (std::is_same_v<V, proto::syntax::Object>) {
            return push(proto::syntax::ValueType::OBJECT, _objects, v);
        }
        return null();
    }

    /// Add a value array
    template <typename V> proto::syntax::Value Add(proto::syntax::Location loc, const std::vector<V>& vs) {
        auto push = [&](auto tag, auto& val_vec, auto& span_vec, const auto& vs) {
            auto entry = span_vec.size();
            auto begin = val_vec.size();
            for (auto& v: vs)
                val_vec.push_back(move(v));
            span_vec.push_back(proto::syntax::Span(begin, vs.size()));
            return proto::syntax::Value(tag, entry);
        };
        if constexpr (std::is_same_v<V, double>) {
            return push(proto::syntax::ValueType::NUMBER_ARRAY, _numbers, _number_arrays, vs);
        }
        if constexpr (std::is_same_v<V, std::string_view>) {
            return push(proto::syntax::ValueType::STRING_ARRAY, _strings, _string_arrays, vs);
        }
        if constexpr (std::is_same_v<V, proto::syntax::Object>) {
            return push(proto::syntax::ValueType::OBJECT_ARRAY, _objects, _object_arrays, vs);
        }
        return null();
    }

    /// Add node attributes
    proto::syntax::Span AddAttributes(const std::vector<proto::syntax::Attribute>& vs) {
        auto begin = _attributes.size();
        for (auto& v: vs)
            _attributes.push_back(v);
        return proto::syntax::Span(begin, vs.size());
    }

    /// Write as flatbuffer
    flatbuffers::Offset<proto::syntax::ModuleSections> Write(flatbuffers::FlatBufferBuilder& builder);
};

class ModuleBuilder {
    /// The sections
    SectionsBuilder _sections;
    /// The statements
    std::vector<uint32_t> _statements;
    /// The errors
    std::vector<std::pair<proto::syntax::Location, std::string>> _errors;

    public:
    /// Constructor
    ModuleBuilder();

    /// Get the sections
    auto& sections() { return _sections; }
    /// Get the statements
    auto& statements() { return _statements; }
    /// Get the errors
    auto& errors() { return _errors; }

    /// Add an error
    void AddError(proto::syntax::Location loc, const std::string& message);
    /// Write as flatbuffer
    flatbuffers::Offset<proto::syntax::Module> Write(flatbuffers::FlatBufferBuilder& builder);
};

}
}

#endif // INCLUDE_DASHQL_PARSER_MODULE_BUILDER_H_
