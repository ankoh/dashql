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
    for (auto [loc, key, attr]: attrs) {
        if (attr)
            _attributes.push_back(sx::Attribute(loc, key, *attr));
    }
    return sx::Span(begin, _attributes.size() - begin);
}

/// Add node attributes
sx::Span DocumentBuilder::AddAttributes(const std::vector<sx::Attribute>& attrs) {
    size_t begin = _attributes.size();
    for (auto& attr: attrs)
        _attributes.push_back(attr);
    return sx::Span(begin, _attributes.size() - begin);
}

/// Add an object
void DocumentBuilder::AddEntry(sx::Object object) {
    _objects.push_back(object);
    _entries.push_back(_objects.size() - 1);
}

/// Add an object
sx::Value DocumentBuilder::AddObject(sx::Location loc, sx::Object object) {
    _objects.push_back(object);
    return sx::Value(loc, sx::ValueType::OBJECT, _objects.size() - 1);
}

/// Add an object
sx::Value DocumentBuilder::AddArray(sx::Location loc, const std::vector<sx::Location>& strings) {
    _arrays.push_back(sx::Array(sx::ValueType::ARRAY, _values_string.size(), strings.size()));
    for (auto& loc: strings)
        _values_string.push_back(loc);
    return sx::Value(loc, sx::ValueType::ARRAY, _arrays.size() - 1);
}

/// Add an object
sx::Value DocumentBuilder::AddArray(sx::Location loc, const std::vector<sx::Object>& objects) {
    _arrays.push_back(sx::Array(sx::ValueType::ARRAY, _objects.size(), objects.size()));
    for (auto& loc: objects)
        _objects.push_back(loc);
    return sx::Value(loc, sx::ValueType::ARRAY, _arrays.size() - 1);
}

/// Write as flatbuffer
fb::Offset<sx::Document> DocumentBuilder::Write(fb::FlatBufferBuilder& builder) {
    fb::Offset<fb::Vector<uint32_t>> entries;
    fb::Offset<fb::Vector<const sx::Object*>> objects;
    fb::Offset<fb::Vector<const sx::Attribute*>> attributes;
    fb::Offset<fb::Vector<const sx::Array*>> arrays;
    fb::Offset<fb::Vector<int32_t>> values_i32;
    fb::Offset<fb::Vector<const sx::Location*>> values_string;

    entries = builder.CreateVector(_entries);
    objects = builder.CreateVectorOfStructs(_objects);
    attributes = builder.CreateVectorOfStructs(_attributes);
    arrays = builder.CreateVectorOfStructs(_arrays);
    values_i32 = builder.CreateVector(_values_i32);
    values_string = builder.CreateVectorOfStructs(_values_string);

    sx::DocumentBuilder doc{builder};
    doc.add_entries(entries);
    doc.add_objects(objects);
    doc.add_attributes(attributes);
    doc.add_arrays(arrays);
    doc.add_values_i32(values_i32);
    doc.add_values_string(values_string);
    return doc.Finish();
}

/// Constructor
ModuleBuilder::ModuleBuilder()
    : _document(), _errors() {}

/// Add an object
sx::Object ModuleBuilder::CreateObject(sx::Location loc, sx::ObjectType type, std::initializer_list<DocumentBuilder::OptionalAttribute> attrs) {
    return sx::Object(loc, type, _document.AddAttributes(attrs));
}

/// Add an object
sx::Object ModuleBuilder::CreateObject(sx::Location loc, sx::ObjectType type, const std::vector<sx::Attribute>& attrs) {
    return sx::Object(loc, type, _document.AddAttributes(attrs));
}

/// Add an object
sx::Value ModuleBuilder::AddObject(sx::Location loc, sx::ObjectType type, std::initializer_list<DocumentBuilder::OptionalAttribute> attrs) {
    return _document.AddObject(loc, sx::Object(loc, type, _document.AddAttributes(attrs)));
}

/// Add an object
sx::Value ModuleBuilder::AddObject(sx::Location loc, sx::ObjectType type, const std::vector<sx::Attribute>& attrs) {
    return _document.AddObject(loc, sx::Object(loc, type, _document.AddAttributes(attrs)));
}

/// Add an object
std::vector<sx::Attribute> ModuleBuilder::CollectViz(sx::Location viz_loc, sxd::VizType viz_type, std::initializer_list<std::reference_wrapper<std::vector<sx::Attribute>>> attrs) {
    auto type_val = sx::Value(viz_loc, sx::ValueType::I32, static_cast<int32_t>(viz_type));
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
    auto doc_ofs = _document.Write(builder);
    auto error_vec = builder.CreateVector(errs);
    auto line_breaks_vec = builder.CreateVectorOfStructs(_line_breaks);
    auto comments_vec = builder.CreateVectorOfStructs(_comments);
    sx::ModuleBuilder b{builder};
    b.add_document(doc_ofs);
    b.add_errors(error_vec);
    b.add_line_breaks(line_breaks_vec);
    b.add_comments(comments_vec);
    return b.Finish();
}

}  // namespace parser
}  // namespace dashql
