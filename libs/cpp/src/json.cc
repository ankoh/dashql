#include <cstdint>
#include <stack>
#include <unordered_set>

#include "rapidjson/document.h"
#include "rapidjson/istreamwrapper.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

#include "dashql/parser/json.h"

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

struct ValueBuilder {
    /// The parent
    std::optional<unsigned> parent;
    /// The parent member
    std::string_view parent_member;
    /// The object value
    json::Value value;
    /// The pending visit (if any)
    const proto::syntax::Object* pendingVisit;

    /// Constructor
    ValueBuilder(std::optional<unsigned> parent, std::string_view member, json::Type t, const proto::syntax::Object* object = nullptr)
        : parent(parent), parent_member(member), value(t), pendingVisit(object) {}
    /// Move constructor
    ValueBuilder(ValueBuilder&& other)
        : parent(other.parent), parent_member(other.parent_member), value(std::move(other.value)), pendingVisit(other.pendingVisit) {}
    /// Move assignment
    ValueBuilder& operator=(ValueBuilder&& other) {
        parent = other.parent;
        parent_member = other.parent_member;
        value = std::move(other.value);
        pendingVisit = other.pendingVisit;
        return *this;
    }
    /// Get the member ref
    auto getParentMember() const { return json::StringRef(parent_member.data(), parent_member.size()); }
};

}

/// Encode JSON
json::StringBuffer encodeJSON(proto::syntax::Module& module) {
    // Prepare document
    json::Document doc(json::kObjectType);
    auto& alloc = doc.GetAllocator();
    auto* obj_type_tt = proto::syntax::ObjectTypeTypeTable();
    auto* attr_key_tt = proto::syntax::AttributeKeyTypeTable();

    // Unpack document
    auto& stmts = *module.statements();
    auto& attrs = *module.document()->attributes();
    auto& objs = *module.document()->objects();
    auto& arrays = *module.document()->arrays();
    auto& values_str = *module.document()->values_string();
    auto& values_i32 = *module.document()->values_i32();

    // Encode statements
    for (auto iter = stmts.rbegin(); iter != stmts.rend(); ++iter) {
        std::vector<ValueBuilder> pending;
        pending.emplace_back(std::nullopt, std::string_view{}, json::Type::kObjectType, *iter);

        // Traverse the AST with a DFS & emit JSON in reverse direction
        while (!pending.empty()) {
            // Alread visited?
            auto& v = pending.back();
            if (!v.pendingVisit) {
                // Add the value as member in the parent (if any)
                if (v.parent) {
                    auto& parent = pending[*v.parent].value;
                    if (!v.parent_member.empty()) {
                        parent.AddMember(v.getParentMember(), std::move(v.value), alloc);
                    } else {
                        parent.PushBack(std::move(v.value), alloc);
                    }
                } else {
                    doc.PushBack(std::move(v.value), alloc);
                }

                // Remove the last element and continue
                pending.pop_back();
                continue;
            }

            // Visit the object (if any)
            auto target = v.pendingVisit;
            auto type_name = obj_type_tt->names[static_cast<size_t>(target->type())];
            v.value.AddMember("type", json::StringRef(type_name), alloc);
            v.value.AddMember("location", encode(doc, target->location()), alloc);
            v.pendingVisit = nullptr;

            // Translate the attributes
            auto attr_span = target->attributes();
            std::vector<ValueBuilder> children;
            for (auto i = 0; i < attr_span.length(); ++i) {

                // Unpack the attribute
                auto& attr = *attrs[attr_span.offset() + i];
                auto& attr_value = attr.value();
                auto& attr_loc = attr.location();
                auto key_name = attr_key_tt->names[static_cast<size_t>(attr.key())];
                auto parent_id = pending.size() - 1;

                // Check the attribute type
                switch (attr_value.type()) {
                    case sx::ValueType::NONE:
                        break;

                    // Add I32 attribute directly
                    case sx::ValueType::I32:
                        v.value.AddMember(json::StringRef(key_name), attr_value.value(), alloc);
                        break;

                    // Add STRING attribute directly
                    case sx::ValueType::STRING: {
                        auto loc = encode(doc, attr_loc);
                        v.value.AddMember(json::StringRef(key_name), loc, alloc);
                        break;
                    }

                    // Visit object attribute later
                    case sx::ValueType::OBJECT: {
                        auto* obj = objs[attr_value.value()];
                        children.emplace_back(parent_id, key_name, json::Type::kObjectType, obj);
                        break;
                    }

                    // Unpack array directly
                    case sx::ValueType::ARRAY: {
                        auto* arr = arrays[attr_value.value()];
                        switch (arr->type()) {
                            case sx::ValueType::NONE:
                                break;

                            // Visit all array objects later
                            case sx::ValueType::OBJECT: {
                                for (unsigned i = 0; i < arr->length(); ++i)
                                    children.emplace_back(parent_id, "", json::Type::kObjectType, objs[arr->offset() + arr->length() - 1 - i]);
                                break;
                            }

                            // Build string array directly
                            case sx::ValueType::STRING: {
                                auto a = json::Value(json::Type::kArrayType);
                                for (unsigned i = 0; i < arr->length(); ++i)
                                    a.PushBack(encode(doc, *values_str[arr->offset() + arr->length() - 1 - i]), alloc);
                                v.value.AddMember(json::StringRef(key_name), a, alloc);
                                break;
                            }

                            // Build I32 array directly
                            case sx::ValueType::I32: {
                                auto a = json::Value(json::Type::kArrayType);
                                for (unsigned i = 0; i < arr->length(); ++i)
                                    a.PushBack(values_i32[arr->offset() + arr->length() - 1 - i], alloc);
                                v.value.AddMember(json::StringRef(key_name), a, alloc);
                                break;
                            }

                            // Recurse into nested array
                            case sx::ValueType::ARRAY: {
                                break;
                            }
                        }
                        // 
                        break;
                    }
                }

                // XXX
            }

            // Add the children to the stack of pending values
        }
    }

    // Add errors
    json::Value errors(json::kArrayType);
    for (auto err: *module.errors())
        errors.PushBack(encode(doc, *err), alloc);
    doc.AddMember("errors", errors, alloc);

    // Add line breaks
    json::Value line_breaks(json::kArrayType);
    for (auto lb: *module.line_breaks())
        line_breaks.PushBack(encode(doc, *lb), alloc);
    doc.AddMember("lineBreaks", line_breaks, alloc);

    // Add comments
    json::Value comments(json::kArrayType);
    for (auto c: *module.comments())
        comments.PushBack(encode(doc, *c), alloc);
    doc.AddMember("comments", comments, alloc);

    // Write string
    json::StringBuffer buffer;
    json::Writer<json::StringBuffer> writer(buffer);
    doc.Accept(writer);
    return buffer;
}

}
}
