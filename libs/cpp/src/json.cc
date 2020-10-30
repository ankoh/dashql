#include "dashql/parser/json.h"

#include <cstdint>
#include <stack>
#include <unordered_set>

#include "rapidjson/document.h"
#include "rapidjson/istreamwrapper.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"
#include "rapidjson/prettywriter.h"

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
json::StringBuffer encodeJSON(const proto::syntax::Module& module, bool pretty) {
    // Prepare document
    json::Document doc(json::kObjectType);
    auto& alloc = doc.GetAllocator();
    auto* obj_type_tt = proto::syntax::ObjectTypeTypeTable();
    auto* attr_key_tt = proto::syntax::AttributeKeyTypeTable();

    // Translate document
    {
        // Unpack document
        auto* entries = module.statements()->entries();
        auto* objs = module.statements()->objects();
        auto* attrs = module.statements()->attributes();
        auto* arrays = module.statements()->arrays();
        auto* values_str = module.statements()->values_string();
        auto* values_i32 = module.statements()->values_i32();

        auto assert_less_than = [](unsigned v, unsigned size) {
            assert(v < size);
            return std::min(size, v);
        };
        auto assert_within = [](unsigned& begin, unsigned& end, unsigned size) {
            assert(begin <= end);
            assert(end <= size);
            end = std::min(end, size);
            begin = std::min(begin, end);
            return;
        };

        // Translate objects
        std::vector<json::Value> obj_values;
        obj_values.reserve(module.statements()->objects()->size());
        for (unsigned oid = 0; oid < objs->size(); ++oid) {
            auto o = objs->Get(oid);

            // Create object
            obj_values.emplace_back(json::Type::kObjectType);
            auto& v = obj_values.back();
            v.AddMember("type", json::StringRef(obj_type_tt->names[static_cast<size_t>(o->type())]), alloc);
            v.AddMember("location", encode(doc, o->location()), alloc);

            // Translate attributes
            auto& attr_span = o->attributes();
            auto attr_end = attr_span.offset() + attr_span.length();
            for (unsigned i = attr_span.offset(); i < attr_end; ++i) {
                // Unpack attribute
                auto* attr = attrs->Get(i);
                auto& attr_value = attr->value();
                auto attr_key = json::StringRef(attr_key_tt->names[static_cast<size_t>(attr->key())]);

                // Check attribute type
                switch (attr_value.type()) {
                    case sx::ValueType::NONE:
                        break;
                    case sx::ValueType::I32:
                        v.AddMember(attr_key, attr_value.value(), alloc);
                        break;
                    case sx::ValueType::STRING:
                        v.AddMember(attr_key, encode(doc, attr_value.location()), alloc);
                        break;
                    case sx::ValueType::OBJECT: {
                        auto aid = assert_less_than(attr_value.value(), oid);
                        v.AddMember(attr_key, std::move(obj_values[aid]), alloc);
                        break;
                    }
                    case sx::ValueType::ARRAY: {
                        // Translate arrays with a stack since array can be nested
                        std::vector<std::tuple<std::optional<size_t>, json::Value, const sx::Array*>> nested_arrays;
                        nested_arrays.push_back(
                            {std::nullopt, json::Value(json::Type::kArrayType), arrays->Get(attr_value.value())});
                        while (!nested_arrays.empty()) {
                            auto& [parent_id, value, array_ptr] = nested_arrays.back();

                            // Already visited?
                            if (!array_ptr) {
                                // Nested array? - Push into parent
                                if (parent_id) {
                                    std::get<1>(nested_arrays[*parent_id]).PushBack(std::move(value), alloc);
                                } else {
                                    // Add root attribute
                                    v.AddMember(attr_key, std::move(value), alloc);
                                }
                                nested_arrays.pop_back();
                                continue;
                            }

                            // Unpack the array
                            auto array_id = nested_arrays.size() - 1;
                            auto array_type = array_ptr->type();
                            auto array_begin = array_ptr->offset();
                            auto array_end = array_begin + array_ptr->length();

                            // Push on next visit
                            array_ptr = nullptr;

                            switch (array_type) {
                                case sx::ValueType::NONE:
                                    break;
                                case sx::ValueType::ARRAY:
                                    assert_within(array_begin, array_end, arrays->size());
                                    for (auto i = array_begin; i < array_end; ++i)
                                        nested_arrays.push_back({array_id, json::Value(json::Type::kArrayType), arrays->Get(i)});
                                    break;
                                case sx::ValueType::OBJECT:
                                    assert_within(array_begin, array_end, oid);
                                    for (auto i = array_begin; i < array_end; ++i)
                                        value.PushBack(std::move(obj_values[i]), alloc);
                                    break;
                                case sx::ValueType::STRING:
                                    assert_within(array_begin, array_end, values_str->size());
                                    for (auto i = array_begin; i < array_end; ++i)
                                        value.PushBack(encode(doc, *values_str->Get(i)), alloc);
                                    break;
                                case sx::ValueType::I32:
                                    assert_within(array_begin, array_end, values_i32->size());
                                    for (auto i = array_begin; i < array_end; ++i)
                                        value.PushBack(values_i32->Get(i), alloc);
                                    break;
                            }
                        }
                        break;
                    }
                }
            }
        }

        // Build the document entries
        auto statements = json::Value(json::Type::kArrayType);
        for (unsigned eid = 0; eid < entries->size(); ++eid)
            statements.PushBack(std::move(obj_values[eid]), alloc);
        doc.AddMember("statements", statements, alloc);
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
    if (pretty) {
        json::PrettyWriter<json::StringBuffer> writer(buffer);
        doc.Accept(writer);
    } else {
        json::Writer<json::StringBuffer> writer(buffer);
        doc.Accept(writer);
    }
    return buffer;
}

}  // namespace parser
}  // namespace dashql
