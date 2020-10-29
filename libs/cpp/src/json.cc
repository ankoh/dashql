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
    /// The object
    const proto::syntax::Object* object;
    /// The object value
    json::Value value;
    /// Has been visited?
    bool visited;

    /// Constructor
    ValueBuilder(std::optional<unsigned> parent, std::string_view member, const proto::syntax::Object* object, json::Type t)
        : parent(parent), parent_member(member), object(object), visited(false), value(t) {}
    /// Move constructor
    ValueBuilder(ValueBuilder&& other)
        : parent(other.parent), parent_member(other.parent_member), object(other.object), value(std::move(other.value)), visited(false) {}
    /// Move assignment
    ValueBuilder& operator=(ValueBuilder&& other) {
        parent = other.parent;
        parent_member = other.parent_member;
        object = other.object;
        value = std::move(other.value);
        visited = other.visited;
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

    // Encode statements
    auto& stmts = *module.statements();
    for (auto iter = stmts.rbegin(); iter != stmts.rend(); ++iter) {
        // Traverse the AST with a DFS
        std::vector<ValueBuilder> pending;
        pending.emplace_back(std::nullopt, std::string_view{}, *iter, json::Type::kObjectType);
        while (!pending.empty()) {
            auto& v = pending.back();

            // Alread visited?
            if (v.visited) {
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
                continue;
            }
            v.visited = true;

            // Register all children
            v.value.AddMember("location", encode(doc, v.object->location()), alloc);
            auto type_name = proto::syntax::ObjectTagTypeTable()->names[static_cast<size_t>(v.object->type())];
            v.value.AddMember("type", json::StringRef(type_name), alloc);
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
