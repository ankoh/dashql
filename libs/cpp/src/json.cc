#include <cstdint>

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

}

/// Encode JSON
json::StringBuffer encodeJSON(proto::syntax::Module& module) {
    // Prepare document
    json::Document doc(json::kObjectType);
    auto& alloc = doc.GetAllocator();

    json::Value errors(json::kArrayType);
    for (auto err: *module.errors())
        errors.PushBack(encode(doc, *err), alloc);
    doc.AddMember("errors", errors, alloc);

    json::Value comments(json::kArrayType);
    for (auto c: *module.comments())
        comments.PushBack(encode(doc, *c), alloc);
    doc.AddMember("comments", comments, alloc);

    json::Value line_breaks(json::kArrayType);
    for (auto lb: *module.line_breaks())
        line_breaks.PushBack(encode(doc, *lb), alloc);
    doc.AddMember("lineBreaks", line_breaks, alloc);

    // Write string
    json::StringBuffer buffer;
    json::Writer<json::StringBuffer> writer(buffer);
    doc.Accept(writer);
    return buffer;
}

}
}
