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
sx::Span DocumentBuilder::AddAttributes(std::initializer_list<OptionalAttribute> attrs) {
    size_t begin = _attributes.size();
    for (auto [key, attr]: attrs) {
        if (attr)
            _attributes.push_back(sx::Attribute(key, *attr));
    }
    return sx::Span(begin, _attributes.size() - begin);
}

/// Add node attributes
sx::Span DocumentBuilder::AddAttributes(AttributeVector&& attrs) {
    size_t begin = _attributes.size();
    for (auto& attr: attrs)
        _attributes.push_back(attr);
    return sx::Span(begin, _attributes.size() - begin);
}

/// Add an object
void DocumentBuilder::AddEntry(sx::Value value) {
    _entries.push_back(value);
}

/// Add an object
sx::Value DocumentBuilder::AddObject(sx::Location loc, sx::Object object) {
    _objects.push_back(object);
    return sx::Value(loc, sx::ValueType::OBJECT, _objects.size() - 1);
}

/// Add an object
sx::Value DocumentBuilder::AddArray(sx::Location loc, ValueVector&& values) {
    _arrays.push_back(sx::Array(_array_values.size(), values.size()));
    for (auto& v: values)
        _array_values.push_back(v);
    return sx::Value(loc, sx::ValueType::ARRAY, _arrays.size() - 1);
}

/// Write as flatbuffer
fb::Offset<sx::Document> DocumentBuilder::Write(fb::FlatBufferBuilder& builder) {
    fb::Offset<fb::Vector<const sx::Value*>> entries;
    fb::Offset<fb::Vector<const sx::Object*>> objects;
    fb::Offset<fb::Vector<const sx::Attribute*>> attributes;
    fb::Offset<fb::Vector<const sx::Array*>> arrays;
    fb::Offset<fb::Vector<const sx::Value*>> array_values;

    entries = builder.CreateVectorOfStructs(_entries);
    objects = builder.CreateVectorOfStructs(_objects);
    attributes = builder.CreateVectorOfStructs(_attributes);
    arrays = builder.CreateVectorOfStructs(_arrays);
    array_values = builder.CreateVectorOfStructs(_array_values);

    sx::DocumentBuilder doc{builder};
    doc.add_entries(entries);
    doc.add_objects(objects);
    doc.add_attributes(attributes);
    doc.add_arrays(arrays);
    doc.add_array_values(array_values);
    return doc.Finish();
}

/// Constructor
ModuleBuilder::ModuleBuilder()
    : _statements(), _errors() {}

/// Add an object
sx::Value ModuleBuilder::AddObject(sx::Location loc, sx::ObjectType type, std::initializer_list<DocumentBuilder::OptionalAttribute> attrs) {
    return _statements.AddObject(loc, sx::Object(loc, type, _statements.AddAttributes(attrs)));
}

/// Add an object
sx::Value ModuleBuilder::AddObject(sx::Location loc, sx::ObjectType type, AttributeVector&& attrs) {
    return _statements.AddObject(loc, sx::Object(loc, type, _statements.AddAttributes(move(attrs))));
}

/// Add an object
AttributeVector ModuleBuilder::CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<AttributeVector>> attrs) {
    auto type_val = sx::Value(viz_loc, sx::ValueType::I64, static_cast<int64_t>(viz_type));
    auto type_attr = sx::Attribute(sx::AttributeKey::DASHQL_VIZ_TYPE, type_val);
    AttributeVector result{type_attr};
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
    auto doc_ofs = _statements.Write(builder);
    auto error_vec = builder.CreateVector(errs);
    auto line_breaks_vec = builder.CreateVectorOfStructs(_line_breaks);
    auto comments_vec = builder.CreateVectorOfStructs(_comments);
    sx::ModuleBuilder b{builder};
    b.add_statements(doc_ofs);
    b.add_errors(error_vec);
    b.add_line_breaks(line_breaks_vec);
    b.add_comments(comments_vec);
    return b.Finish();
}

}  // namespace parser
}  // namespace dashql
