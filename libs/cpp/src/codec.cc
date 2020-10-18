// Copyright (c) 2020 The DashQL Authors

#include <string_view>

#include "dashql/parser/common/variant.h"
#include "dashql/parser/proto/program_generated.h"
#include "dashql/parser/syntax.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace parser {

struct SectionsBuilder {
    /// The section data
    std::vector<int64_t> _literals_i64 = {};
    std::vector<double> _literals_f64 = {};
    std::vector<std::string_view> _literals_string = {};
    std::vector<proto::program::ParameterDeclaration> _parameter_declarations = {};
    std::vector<proto::program::FileLoad> _loads_file = {};
    std::vector<proto::program::HTTPLoad> _loads_http = {};
    std::vector<proto::program::CSVExtract> _extracts_csv = {};
    std::vector<proto::program::JSONPathExtract> _extracts_json = {};
    std::vector<proto::program::VizStatement> _viz_statements = {};

    /// The builder
    SectionsBuilder() = default;
    /// Add a value
    template <typename V> proto::program::SectionEntry add(V v) {
        auto push = [&](auto tag, auto& vec, auto&& val) {
            vec.push_back(val);
            return proto::program::SectionEntry(tag, vec.size() - 1);
        };
        if constexpr (std::is_same_v<V, int64_t>) {
            return push(proto::program::SectionTag::I64Literal, _literals_i64, v);
        }
        if constexpr (std::is_same_v<V, double>) {
            return push(proto::program::SectionTag::F64Literal, _literals_f64, v);
        }
        if constexpr (std::is_same_v<V, std::string>) {
            return push(proto::program::SectionTag::StringLiteral, _literals_string, v);
        }
        if constexpr (std::is_same_v<V, proto::program::ParameterDeclaration>) {
            return push(proto::program::SectionTag::ParameterDeclaration, _parameter_declarations, v);
        }
        if constexpr (std::is_same_v<V, proto::program::FileLoad>) {
            return push(proto::program::SectionTag::FileLoad, _loads_file, v);
        }
        if constexpr (std::is_same_v<V, proto::program::HTTPLoad>) {
            return push(proto::program::SectionTag::HTTPLoad, _loads_http, v);
        }
        if constexpr (std::is_same_v<V, proto::program::CSVExtract>) {
            return push(proto::program::SectionTag::CSVExtract, _extracts_csv, v);
        }
        if constexpr (std::is_same_v<V, proto::program::JSONPathExtract>) {
            return push(proto::program::SectionTag::JSONPathExtract, _extracts_json, v);
        }
        if constexpr (std::is_same_v<V, proto::program::VizStatement>) {
            return push(proto::program::SectionTag::VizStatement, _viz_statements, v);
        }
        assert("invalid section");
    }

    /// Write as flatbuffer
    flatbuffers::Offset<proto::program::Sections> write(flatbuffers::FlatBufferBuilder& builder) {
        proto::program::SectionsBuilder sectionsBuilder{builder};
        return sectionsBuilder.Finish();
    }

    /// A null entry
    proto::program::SectionEntry null() { return proto::program::SectionEntry(proto::program::SectionTag::NONE, 0); }
};

static proto::program::ParameterTag encode(const ParameterType& p) {
    switch (p.type) {
        case ParameterType::Type::Integer:
            return proto::program::ParameterTag::INTEGER;
        case ParameterType::Type::Float:
            return proto::program::ParameterTag::FLOAT;
        case ParameterType::Type::Text:
            return proto::program::ParameterTag::TEXT;
        case ParameterType::Type::Date:
            return proto::program::ParameterTag::DATE;
        case ParameterType::Type::DateTime:
            return proto::program::ParameterTag::DATETIME;
        case ParameterType::Type::Time:
            return proto::program::ParameterTag::TIME;
        case ParameterType::Type::File:
            return proto::program::ParameterTag::FILE;
        default:
            return proto::program::ParameterTag::NONE;
    }
}

static proto::program::Location encode(const Location& l) {
    auto b = proto::program::Position(l.begin.line, l.begin.column);
    auto e = proto::program::Position(l.end.line, l.end.column);
    return proto::program::Location(b, e);
}

static proto::program::SectionEntry encode(SectionsBuilder& sections, const ExtractStatement::ExtractMethod& method) {
    // XXX
}

static proto::program::SectionEntry encode(SectionsBuilder& sections, const LoadStatement::LoadMethod& method) {
    // XXX
}

static proto::program::VizTag encode(SectionsBuilder& sections, const VizStatement::VizType& type) {
    // XXX
}

flatbuffers::Offset<proto::program::Program> WriteProgram(flatbuffers::FlatBufferBuilder& builder, Program& program) {
    /// The sections
    SectionsBuilder sections;

    /// Encode all statements
    std::vector<proto::program::SectionEntry> stmt_entries;
    for (auto& statement : program.statements) {
        std::visit(overload{
                       [&](const ParameterDeclaration& p) {
                           auto loc = encode(p.location);
                           auto tag = encode(p.type);
                           auto name = sections.add(p.name.string);
                           auto label = sections.add(p.label.string);
                           auto decl = proto::program::ParameterDeclaration(loc, tag, name, label, sections.null());
                           stmt_entries.push_back(sections.add(decl));
                       },
                       [&](const ExtractStatement& e) {
                           auto loc = encode(e.location);
                           auto name = sections.add(e.name.string);
                           auto data = sections.add(e.data_name.string);
                           auto method = encode(sections, e.method);
                           auto extract = proto::program::ExtractStatement(loc, name, data, method);
                           stmt_entries.push_back(sections.add(extract));
                       },
                       [&](const LoadStatement& l) {
                           auto loc = encode(l.location);
                           auto name = sections.add(l.name.string);
                           auto method = encode(sections, l.method);
                           auto load = proto::program::LoadStatement(loc, name, method);
                           stmt_entries.push_back(sections.add(load));
                       },
                       [&](const QueryStatement& q) {
                           auto loc = encode(q.location);
                           auto name = q.name ? sections.add(q.name->string) : sections.null();
                           auto text = sections.add(q.query_text);
                           auto query = proto::program::QueryStatement(loc, name, text);
                           stmt_entries.push_back(sections.add(query));
                       },
                       [&](const VizStatement& v) {
                           auto loc = encode(v.location);
                           auto tag = encode(sections, v.viz_type);
                           auto type = encode(sections, v.viz_type);
                           auto name = sections.add(v.name.string);
                           auto query_name = sections.add(v.query_name.string);
                           auto viz = proto::program::VizStatement(loc, tag, name, query_name);
                           stmt_entries.push_back(sections.add(viz));
                       },
                   },
                   statement);
    }

    // Encode errors
    std::vector<flatbuffers::Offset<proto::program::Error>> errors;

    // Encode program
    auto sec_ofs = sections.write(builder);
    auto stmt_vec = builder.CreateVectorOfStructs(stmt_entries);
    proto::program::ProgramBuilder programBuilder{builder};
    programBuilder.add_sections(sec_ofs);
    programBuilder.add_statements(stmt_vec);
    return programBuilder.Finish();
}

}  // namespace parser
}  // namespace dashql
