// Copyright (c) 2020 The DashQL Authors

#include <string_view>
#include <optional>
#include <iostream>

#include "dashql/parser/common/variant.h"
#include "dashql/parser/proto/program_generated.h"
#include "dashql/parser/syntax.h"
#include "flatbuffers/flatbuffers.h"

using namespace std;
namespace fb = flatbuffers;

namespace dashql {
namespace parser {

struct SectionsBuilder {
    /// The section data
    vector<int64_t> _literals_i64 = {};
    vector<double> _literals_f64 = {};
    vector<string_view> _literals_string = {};
    vector<proto::program::ParameterDeclaration> _parameter_declarations = {};
    vector<proto::program::FileLoad> _loads_file = {};
    vector<proto::program::HTTPLoad> _loads_http = {};
    vector<proto::program::CSVExtract> _extracts_csv = {};
    vector<proto::program::JSONPathExtract> _extracts_json = {};
    vector<proto::program::VizStatement> _viz_statements = {};

    /// The builder
    SectionsBuilder() = default;
    /// Add a value
    template <typename V> proto::program::SectionEntry add(V v) {
        auto push = [&](auto tag, auto& vec, auto&& val) {
            vec.push_back(val);
            return proto::program::SectionEntry(tag, vec.size() - 1);
        };
        if constexpr (is_same_v<V, int64_t>) {
            return push(proto::program::SectionTag::I64Literal, _literals_i64, v);
        }
        if constexpr (is_same_v<V, double>) {
            return push(proto::program::SectionTag::F64Literal, _literals_f64, v);
        }
        if constexpr (is_same_v<V, string_view>) {
            return push(proto::program::SectionTag::StringLiteral, _literals_string, v);
        }
        if constexpr (is_same_v<V, proto::program::ParameterDeclaration>) {
            return push(proto::program::SectionTag::ParameterDeclaration, _parameter_declarations, v);
        }
        if constexpr (is_same_v<V, proto::program::FileLoad>) {
            return push(proto::program::SectionTag::FileLoad, _loads_file, v);
        }
        if constexpr (is_same_v<V, proto::program::HTTPLoad>) {
            return push(proto::program::SectionTag::HTTPLoad, _loads_http, v);
        }
        if constexpr (is_same_v<V, proto::program::CSVExtract>) {
            return push(proto::program::SectionTag::CSVExtract, _extracts_csv, v);
        }
        if constexpr (is_same_v<V, proto::program::JSONPathExtract>) {
            return push(proto::program::SectionTag::JSONPathExtract, _extracts_json, v);
        }
        if constexpr (is_same_v<V, proto::program::VizStatement>) {
            return push(proto::program::SectionTag::VizStatement, _viz_statements, v);
        }
        return null();
    }

    /// Write as flatbuffer
    fb::Offset<proto::program::Sections> write(fb::FlatBufferBuilder& builder) {
        optional<fb::Offset<fb::Vector<int64_t>>> literals_i64;
        optional<fb::Offset<fb::Vector<double>>> literals_f64;
        optional<fb::Offset<fb::Vector<fb::Offset<fb::String>>>> literals_str;
        optional<fb::Offset<fb::Vector<const proto::program::ParameterDeclaration*>>> parameter_declarations;
        optional<fb::Offset<fb::Vector<const proto::program::FileLoad*>>> loads_file;
        optional<fb::Offset<fb::Vector<const proto::program::HTTPLoad*>>> loads_http;
        optional<fb::Offset<fb::Vector<const proto::program::CSVExtract*>>> extracts_csv;
        optional<fb::Offset<fb::Vector<const proto::program::JSONPathExtract*>>> extracts_json;
        optional<fb::Offset<fb::Vector<const proto::program::VizStatement*>>> viz_statements;

        if (!_literals_i64.empty())
            literals_i64 = builder.CreateVector(_literals_i64);
        if (!_literals_f64.empty())
            literals_f64 = builder.CreateVector(_literals_f64);
        if (!_literals_string.empty()) {
            std::vector<fb::Offset<fb::String>> offsets;
            offsets.reserve(_literals_string.size());
            for (auto s: _literals_string)
                offsets.push_back(builder.CreateString(s.data(), s.size()));
            literals_str = builder.CreateVector(offsets);
        }
        if (!_parameter_declarations.empty()) {
            proto::program::ParameterDeclaration* writer;
            parameter_declarations = builder.CreateUninitializedVectorOfStructs(_parameter_declarations.size(), &writer);
            for (auto& p: _parameter_declarations)
                *writer = p;
        }
        if (!_loads_file.empty()) {
            proto::program::FileLoad* writer;
            loads_file = builder.CreateUninitializedVectorOfStructs(_loads_file.size(), &writer);
            for (auto& p: _loads_file)
                *writer = p;
        }
        if (!_loads_http.empty()) {
            proto::program::HTTPLoad* writer;
            loads_http = builder.CreateUninitializedVectorOfStructs(_loads_http.size(), &writer);
            for (auto& p: _loads_http)
                *writer = p;
        }
        if (!_extracts_csv.empty()) {
            proto::program::CSVExtract* writer;
            extracts_csv = builder.CreateUninitializedVectorOfStructs(_extracts_csv.size(), &writer);
            for (auto& p: _extracts_csv)
                *writer = p;
        }
        if (!_extracts_json.empty()) {
            proto::program::JSONPathExtract* writer;
            extracts_json = builder.CreateUninitializedVectorOfStructs(_extracts_json.size(), &writer);
            for (auto& p: _extracts_json)
                *writer = p;
        }
        if (!_viz_statements.empty()) {
            proto::program::VizStatement* writer;
            viz_statements = builder.CreateUninitializedVectorOfStructs(_viz_statements.size(), &writer);
            for (auto& p: _viz_statements)
                *writer = p;
        }

        proto::program::SectionsBuilder sectionsBuilder{builder};
        if (literals_i64)
            sectionsBuilder.add_literals_i64(*literals_i64);
        if (literals_f64)
            sectionsBuilder.add_literals_f64(*literals_f64);
        if (literals_str)
            sectionsBuilder.add_literals_string(*literals_str);
        if (parameter_declarations)
            sectionsBuilder.add_parameter_declarations(*parameter_declarations);
        if (loads_file)
            sectionsBuilder.add_loads_file(*loads_file);
        if (loads_http)
            sectionsBuilder.add_loads_http(*loads_http);
        if (extracts_csv)
            sectionsBuilder.add_extracts_csv(*extracts_csv);
        if (extracts_json)
            sectionsBuilder.add_extracts_jsonpath(*extracts_json);
        if (viz_statements)
            sectionsBuilder.add_viz_statements(*viz_statements);
        return sectionsBuilder.Finish();
    }

    /// A null entry
    proto::program::SectionEntry null() { return proto::program::SectionEntry(proto::program::SectionTag::NONE, 0); }
};

static proto::program::Location encode(const Location& l) {
    auto b = proto::program::Position(l.begin.line, l.begin.column);
    auto e = proto::program::Position(l.end.line, l.end.column);
    return proto::program::Location(b, e);
}

static proto::program::ParameterTag encode(const ParameterType& p) {
    switch (p.type) {
#define PARAM_TYPES       \
    X(Integer, INTEGER)   \
    X(Float, FLOAT)       \
    X(Text, TEXT)         \
    X(Date, DATE)         \
    X(DateTime, DATETIME) \
    X(Time, TIME)         \
    X(File, FILE)

#define X(A, B)                  \
    case ParameterType::Type::A: \
        return proto::program::ParameterTag::B;
        PARAM_TYPES
#undef X
        default:
            return proto::program::ParameterTag::NONE;
    }
}

static proto::program::HTTPVerb encode(const LoadStatement::HTTPLoader::Method::Verb& v) {
    switch (v) {
#define HTTP_VERBS \
    X(Get, GET)    \
    X(Put, PUT)    \
    X(Post, POST)

#define X(A, B)                                      \
    case LoadStatement::HTTPLoader::Method::Verb::A: \
        return proto::program::HTTPVerb::B;
        HTTP_VERBS
#undef X
        default:
            return proto::program::HTTPVerb::NONE;
    }
}

static proto::program::VizTag encode(SectionsBuilder& sections, const VizStatement::VizType& type) {
    switch (type.type) {
#define VIZ_TYPES           \
    X(Area, AREA)           \
    X(Bar, BAR)             \
    X(Bubble, BUBBLE)       \
    X(Grid, GRID)           \
    X(Histogram, HISTOGRAM) \
    X(Line, LINE)           \
    X(Number, NUMBER)       \
    X(Pie, PIE)             \
    X(Point, POINT)         \
    X(Scatter, SCATTER)     \
    X(Table, TABLE)         \
    X(Text, TEXT)

#define X(A, B)                          \
    case VizStatement::VizType::Type::A: \
        return proto::program::VizTag::B;
        VIZ_TYPES
#undef X
        default:
            return proto::program::VizTag::NONE;
    }
}

static proto::program::SectionEntry encode(SectionsBuilder& sections, const ExtractStatement::ExtractMethod& method) {
    auto result = sections.null();
    visit(overload{
              [&](const ExtractStatement::CSVExtract& c) {
                  auto loc = encode(c.location);
                  auto extract = proto::program::CSVExtract(loc);
                  result = sections.add(extract);
              },
              [&](const ExtractStatement::JSONPathExtract& j) {
                  auto loc = encode(j.location);
                  auto extract = proto::program::JSONPathExtract(loc);
                  result = sections.add(extract);
              },
          },
          method);
    return result;
}

static proto::program::SectionEntry encode(SectionsBuilder& sections, const LoadStatement::LoadMethod& method) {
    auto result = sections.null();
    visit(overload{
              [&](const LoadStatement::FileLoader& f) {
                  auto loc = encode(f.location);
                  auto load = proto::program::FileLoad(loc);
                  result = sections.add(load);
              },
              [&](const LoadStatement::HTTPLoader& h) {
                  auto loc = encode(h.location);
                  auto verb = proto::program::HTTPVerb::NONE;
                  auto url = sections.null();
                  auto load = proto::program::HTTPLoad(loc, verb, url);
                  result = sections.add(load);
              },
          },
          method);
    return result;
}

fb::Offset<proto::program::Program> WriteProgram(fb::FlatBufferBuilder& builder, Program& program) {
    /// The sections
    SectionsBuilder sections;

    /// Encode all statements
    vector<proto::program::SectionEntry> stmt_entries;
    for (auto& statement : program.statements) {
        visit(overload{
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
    vector<fb::Offset<proto::program::Error>> errors;
    errors.reserve(program.errors.size());
    for (auto& err: program.errors) {
        auto loc = encode(err.location);
        auto msg = builder.CreateString(err.message);
        proto::program::ErrorBuilder errorBuilder(builder);
        errorBuilder.add_location(&loc);
        errorBuilder.add_message(msg);
        errors.push_back(errorBuilder.Finish());
    }

    // Encode program
    auto sec_ofs = sections.write(builder);
    auto stmt_vec = builder.CreateVectorOfStructs(stmt_entries);
    auto error_vec = builder.CreateVector(errors);
    proto::program::ProgramBuilder programBuilder{builder};
    programBuilder.add_sections(sec_ofs);
    programBuilder.add_statements(stmt_vec);
    programBuilder.add_errors(error_vec);
    return programBuilder.Finish();
}

}  // namespace parser
}  // namespace dashql
