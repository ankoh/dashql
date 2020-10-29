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
    json::Value l{json::kObjectType};
    l.AddMember("offset", loc.offset(), alloc);
    l.AddMember("length", loc.length(), alloc);
    return l;
}

}

/// Encode JSON
json::StringBuffer encodeJSON(proto::syntax::Module& module) {
    // Prepare document
    json::Document doc(json::kObjectType);
    auto& alloc = doc.GetAllocator();

    // Add comments
    {
        json::Value comments(json::kArrayType);
        for (auto c: *module.comments())
            comments.PushBack(encode(doc, *c), alloc);
        doc.AddMember("comments", comments, alloc);
    }

    // Write string
    json::StringBuffer buffer;
    json::Writer<json::StringBuffer> writer(buffer);
    doc.Accept(writer);
    return buffer;
}

}
}
