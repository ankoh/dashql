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
sx::Span SectionsBuilder::AddAttributes(std::initializer_list<OptionalAttribute> attrs) {
    size_t begin = _attributes.size();
    for (auto [loc, key, attr]: attrs) {
        if (attr)
            _attributes.push_back(sx::Attribute(loc, key, *attr));
    }
    return sx::Span(begin, _attributes.size() - begin);
}

/// Add node attributes
sx::Span SectionsBuilder::AddAttributes(const std::vector<sx::Attribute>& attrs) {
    size_t begin = _attributes.size();
    for (auto& attr: attrs)
        _attributes.push_back(attr);
    return sx::Span(begin, _attributes.size() - begin);
}

/// Write as flatbuffer
fb::Offset<sx::ModuleSections> SectionsBuilder::Write(fb::FlatBufferBuilder& builder) {
    optional<fb::Offset<fb::Vector<double>>> numbers;
    optional<fb::Offset<fb::Vector<const sx::Span*>>> number_arrays;
    optional<fb::Offset<fb::Vector<const sx::Attribute*>>> attributes;
    optional<fb::Offset<fb::Vector<const sx::Object*>>> objects;
    optional<fb::Offset<fb::Vector<const sx::Span*>>> object_arrays;

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

    sx::ModuleSectionsBuilder sectionsBuilder{builder};
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
sx::Object ModuleBuilder::CreateObject(sx::Location loc, sx::ObjectType type, std::initializer_list<OptionalAttribute> attrs) {
    return sx::Object(loc, type, _sections.AddAttributes(attrs));
}

/// Add an object
sx::Object ModuleBuilder::CreateObject(sx::Location loc, sx::ObjectType type, const std::vector<sx::Attribute>& attrs) {
    return sx::Object(loc, type, _sections.AddAttributes(attrs));
}

/// Add an object
std::vector<sx::Attribute> ModuleBuilder::CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<std::vector<sx::Attribute>>> attrs) {
    auto type_val = sx::Value(viz_loc, sx::ValueType::NUMBER, static_cast<double>(viz_type));
    auto type_attr = sx::Attribute(viz_loc, sx::AttributeKey::DASHQL_VIZ_STATEMENT_TYPE, type_val);
    std::vector<sx::Attribute> result{type_attr};
    for (auto& as: attrs) {
        for (auto& a: as.get()) {
            result.push_back(a);
        }
    }
    return result;
}

/// Write the module
fb::Offset<sx::Module> ModuleBuilder::Write(fb::FlatBufferBuilder& builder) {
    std::vector<fb::Offset<sx::Error>> errs;
    for (auto [loc, msg]: _errors) {
        auto s = builder.CreateString(msg.data(), msg.length());
        sx::ErrorBuilder eb{builder};
        eb.add_location(&loc);
        eb.add_message(s);
        errs.push_back(eb.Finish());
    }
    auto sec_ofs = _sections.Write(builder);
    auto stmt_vec = builder.CreateVectorOfStructs(_statements);
    auto error_vec = builder.CreateVector(errs);
    auto line_breaks_vec = builder.CreateVectorOfStructs(_line_breaks);
    auto comments_vec = builder.CreateVectorOfStructs(_comments);
    sx::ModuleBuilder b{builder};
    b.add_sections(sec_ofs);
    b.add_statements(stmt_vec);
    b.add_errors(error_vec);
    b.add_line_breaks(line_breaks_vec);
    b.add_line_breaks(comments_vec);
    return b.Finish();
}

}  // namespace parser
}  // namespace dashql
