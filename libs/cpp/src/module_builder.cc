// Copyright (c) 2020 The DashQL Authors

#include <string_view>
#include <optional>
#include <iostream>

#include "dashql/parser/common/variant.h"
#include "dashql/parser/module_builder.h"

using namespace std;
namespace fb = flatbuffers;

namespace dashql {
namespace parser {

/// Add node attributes
syntax::Span SectionsBuilder::AddAttributes(std::initializer_list<OptionalAttribute> attrs) {
    size_t begin = _attributes.size();
    for (auto [loc, key, attr]: attrs) {
        if (attr)
            _attributes.push_back(syntax::Attribute(loc, key, *attr));
    }
    return syntax::Span(begin, _attributes.size() - begin);
}

/// Add node attributes
syntax::Span SectionsBuilder::AddAttributes(const std::vector<syntax::Attribute>& attrs) {
    size_t begin = _attributes.size();
    for (auto& attr: attrs)
        _attributes.push_back(attr);
    return syntax::Span(begin, _attributes.size() - begin);
}

/// Write as flatbuffer
fb::Offset<proto::syntax::ModuleSections> SectionsBuilder::Write(fb::FlatBufferBuilder& builder) {
    optional<fb::Offset<fb::Vector<double>>> numbers;
    optional<fb::Offset<fb::Vector<const proto::syntax::Span*>>> number_arrays;
    optional<fb::Offset<fb::Vector<const proto::syntax::Attribute*>>> attributes;
    optional<fb::Offset<fb::Vector<const proto::syntax::Object*>>> objects;
    optional<fb::Offset<fb::Vector<const proto::syntax::Span*>>> object_arrays;

    if (!_numbers.empty())
        numbers = builder.CreateVector(_numbers);
    if (!_number_arrays.empty())
        number_arrays = builder.CreateVectorOfStructs(_number_arrays);
    if (!_attributes.empty())
        attributes = builder.CreateVectorOfStructs(_attributes);
    if (!_objects.empty())
        objects = builder.CreateVectorOfStructs(_objects);
    if (!_object_arrays.empty())
        object_arrays = builder.CreateVectorOfStructs(_object_arrays);

    proto::syntax::ModuleSectionsBuilder sectionsBuilder{builder};
    if (numbers)
        sectionsBuilder.add_numbers(*numbers);
    if (number_arrays)
        sectionsBuilder.add_number_arrays(*number_arrays);
    if (attributes)
        sectionsBuilder.add_attributes(*attributes);
    if (objects)
        sectionsBuilder.add_objects(*objects);
    if (object_arrays)
        sectionsBuilder.add_object_arrays(*object_arrays);
    return sectionsBuilder.Finish();
}

/// Constructor
ModuleBuilder::ModuleBuilder()
    : _sections(), _statements(), _errors() {}

/// Add an object
syntax::Object ModuleBuilder::CreateObject(syntax::Location loc, syntax::ObjectType type, std::initializer_list<OptionalAttribute> attrs) {
    return syntax::Object(loc, type, _sections.AddAttributes(attrs));
}

/// Add an object
syntax::Object ModuleBuilder::CreateObject(syntax::Location loc, syntax::ObjectType type, const std::vector<syntax::Attribute>& attrs) {
    return syntax::Object(loc, type, _sections.AddAttributes(attrs));
}

/// Add an object
std::vector<syntax::Attribute> ModuleBuilder::CollectViz(syntax::Location viz_loc, syntax::VizType viz_type, std::initializer_list<std::reference_wrapper<std::vector<syntax::Attribute>>> attrs) {
    auto type_val = syntax::Value(viz_loc, syntax::ValueType::NUMBER, static_cast<double>(viz_type));
    auto type_attr = syntax::Attribute(viz_loc, syntax::AttributeKey::VIZ_STATEMENT_TYPE, type_val);
    std::vector<syntax::Attribute> result{type_attr};
    for (auto& as: attrs) {
        for (auto& a: as.get()) {
            result.push_back(a);
        }
    }
    return result;
}

/// Write the module
fb::Offset<proto::syntax::Module> ModuleBuilder::Write(fb::FlatBufferBuilder& builder) {
    std::vector<fb::Offset<proto::syntax::Error>> errs;
    for (auto [loc, msg]: _errors) {
        auto s = builder.CreateString(msg.data(), msg.length());
        proto::syntax::ErrorBuilder eb{builder};
        eb.add_location(&loc);
        eb.add_message(s);
        errs.push_back(eb.Finish());
    }
    auto sec_ofs = _sections.Write(builder);
    auto stmt_vec = builder.CreateVectorOfStructs(_statements);
    auto error_vec = builder.CreateVector(errs);
    auto line_breaks_vec = builder.CreateVectorOfStructs(_line_breaks);
    auto comments_vec = builder.CreateVectorOfStructs(_comments);
    proto::syntax::ModuleBuilder b{builder};
    b.add_sections(sec_ofs);
    b.add_statements(stmt_vec);
    b.add_errors(error_vec);
    b.add_line_breaks(line_breaks_vec);
    b.add_line_breaks(comments_vec);
    return b.Finish();
}

}  // namespace parser
}  // namespace dashql
