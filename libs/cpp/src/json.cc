#include "dashql/parser/json.h"

#include <cstdint>
#include <stack>
#include <unordered_set>

#include "rapidjson/document.h"
#include "rapidjson/istreamwrapper.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace json = rapidjson;

namespace dashql {
namespace parser {

namespace sx = proto::syntax;

namespace {

json::Value encode(json::Document& doc, proto::syntax::Location loc) {
    auto& alloc = doc.GetAllocator();
    json::Value v{json::kObjectType};
    v.AddMember("offset", loc.offset(), alloc);
    v.AddMember("length", loc.length(), alloc);
    return v;
}

json::Value encode(json::Document& doc, const proto::syntax::Error& err) {
    auto& alloc = doc.GetAllocator();
    json::Value v{json::kObjectType};
    v.AddMember("message", json::StringRef(err.message()->c_str()), alloc);
    v.AddMember("location", encode(doc, *err.location()), alloc);
    return v;
}

}  // namespace

/// Encode JSON
json::StringBuffer encodeJSON(proto::syntax::Module& module) {
    // Prepare document
    json::Document doc(json::kObjectType);
    auto& alloc = doc.GetAllocator();
    auto* obj_type_tt = proto::syntax::ObjectTypeTypeTable();
    auto* attr_key_tt = proto::syntax::AttributeKeyTypeTable();

    // Translate document
    {
        // Translate strings
        std::vector<json::Value> values_str;
        for (auto v: *module.document()->values_string())
            values_str.emplace_back(encode(doc, *v), alloc);

        // Translate objects
        std::vector<json::Value> obj_values;
        obj_values.reserve(module.document()->objects()->size());
        auto* objs = module.document()->objects();
        auto* attrs = module.document()->attributes();

        for (unsigned oid = 0; oid < objs->size(); ++oid) {
            auto o = objs->Get(oid);
            auto& attr_span = o->attributes();
            auto attr_end = attr_span.offset() + attr_span.length();

            // Create object
            obj_values.emplace_back(json::Type::kObjectType);
            auto& v = obj_values.back();
            v.AddMember("type", json::StringRef(obj_type_tt->names[static_cast<size_t>(o->type())]), alloc);
            v.AddMember("location", encode(doc, o->location()), alloc);

            // Translate attributes
            for (unsigned i = attr_span.offset(); i < attr_end; ++i) {
                auto* attr = attrs->Get(i);
                auto& attr_value = attr->value();
                auto attr_key = json::StringRef(attr_key_tt->names[static_cast<size_t>(attr->key())]);

                switch (attr_value.type()) {
                    case sx::ValueType::NONE: break;
                    case sx::ValueType::I32:
                        v.AddMember(attr_key, attr_value.value(), alloc);
                        break;
                    case sx::ValueType::STRING:
                        v.AddMember(attr_key, encode(doc, attr_value.location()), alloc);
                        break;
                    case sx::ValueType::OBJECT:
                        if (attr_value.value() >= oid) {
                            // Invalid object
                        }
                        v.AddMember(attr_key, std::move(obj_values[oid]), alloc);
                        break;
                    case sx::ValueType::ARRAY: {
                        auto* arr = attrs->Get(attr_value.value());
                        break;
                    }
                }
            }
        }
    }

    // Add errors
    json::Value errors(json::kArrayType);
    for (auto err : *module.errors()) errors.PushBack(encode(doc, *err), alloc);
    doc.AddMember("errors", errors, alloc);

    // Add line breaks
    json::Value line_breaks(json::kArrayType);
    for (auto lb : *module.line_breaks()) line_breaks.PushBack(encode(doc, *lb), alloc);
    doc.AddMember("lineBreaks", line_breaks, alloc);

    // Add comments
    json::Value comments(json::kArrayType);
    for (auto c : *module.comments()) comments.PushBack(encode(doc, *c), alloc);
    doc.AddMember("comments", comments, alloc);

    // Write string
    json::StringBuffer buffer;
    json::Writer<json::StringBuffer> writer(buffer);
    doc.Accept(writer);
    return buffer;
}

}  // namespace parser
}  // namespace dashql
