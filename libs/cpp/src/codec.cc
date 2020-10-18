// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/proto/program_generated.h"
#include "dashql/parser/syntax.h"
#include "flatbuffers/flatbuffers.h"
#include <string_view>

namespace dashql {
namespace parser {

struct SectionsBuilder {
    /// The section data
    std::vector<int64_t> _literals_i64 = {};
    std::vector<double> _literals_f64 = {};
    std::vector<std::string> _literals_string = {};
    std::vector<proto::program::ParameterDeclaration> _parameter_declarations = {};
    std::vector<proto::program::FileLoad> _loads_file = {};
    std::vector<proto::program::HTTPLoad> _loads_http = {};
    std::vector<proto::program::CSVExtract> _extracts_csv = {};
    std::vector<proto::program::JSONPathExtract> _extracts_json = {};
    std::vector<proto::program::VizStatement> _viz_statements = {};

    /// The builder
    SectionsBuilder() = default;
    /// Add a value
    template<typename V>
    proto::program::SectionEntry add(V v) {
        auto push = [&](auto tag, auto& vec, auto& val) {
            vec.push_back(val);
            return proto::program::SectionEntry(tag, vec.size() - 1);
        };
        if constexpr (std::is_same_v<V, int64_t>()) {
            return push(proto::program::SectionTag::I64Literal, _literals_i64, v);
        }
        if constexpr (std::is_same_v<V, double>()) {
            return push(proto::program::SectionTag::F64Literal, _literals_f64, v);
        }
        if constexpr (std::is_same_v<V, std::string_view>()) {
            return push(proto::program::SectionTag::StringLiteral, _literals_string, v);
        }
        if constexpr (std::is_same_v<V, proto::program::ParameterDeclaration>()) {
            return push(proto::program::SectionTag::ParameterDeclaration, _parameter_declarations, v);
        }
        if constexpr (std::is_same_v<V, proto::program::FileLoad>()) {
            return push(proto::program::SectionTag::FileLoad, _loads_file, v);
        }
        if constexpr (std::is_same_v<V, proto::program::HTTPLoad>()) {
            return push(proto::program::SectionTag::HTTPLoad, _loads_http, v);
        }
        if constexpr (std::is_same_v<V, proto::program::CSVExtract>()) {
            return push(proto::program::SectionTag::CSVExtract, _extracts_csv, v);
        }
        if constexpr (std::is_same_v<V, proto::program::JSONPathExtract>()) {
            return push(proto::program::SectionTag::JSONPathExtract, _extracts_json, v);
        }
        if constexpr (std::is_same_v<V, proto::program::VizStatement>()) {
            return push(proto::program::SectionTag::VizStatement, _viz_statements, v);
        }
        assert("invalid section");
    }
};

flatbuffers::Offset<proto::program::Program> WriteProgram(flatbuffers::FlatBufferBuilder& builder,
                                                          Program& program)
{
    /// The sections
    SectionsBuilder sections;
    


}

} // namespace parser
} // namespace dashql
