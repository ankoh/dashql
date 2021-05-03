#ifndef INCLUDE_DASHQL_ANALYZER_JSON_SAX_H_
#define INCLUDE_DASHQL_ANALYZER_JSON_SAX_H_

#include <optional>
#include <unordered_map>
#include <variant>
#include <vector>

#include "dashql/common/variant.h"
#include "dashql/proto_generated.h"
#include "rapidjson/document.h"
#include "rapidjson/writer.h"

namespace sx = dashql::proto::syntax;

namespace dashql {
namespace json {

enum class SAXOpTag {
    NULL_,
    ARRAY_END,
    ARRAY_START,
    BOOL,
    DOUBLE,
    INT32,
    INT64,
    KEY,
    OBJECT_END,
    OBJECT_START,
    STRING,
    STRING_REF,
    UINT32,
    UINT64,
};

using SAXOpArg =
    std::variant<bool, int32_t, uint32_t, int64_t, uint64_t, double, std::string_view, std::string, std::nullopt_t>;

struct SAXOp {
    /// The SAX op tag
    SAXOpTag tag;
    /// The argument
    SAXOpArg argument;
};

struct SAXDocument {
    /// The attribute key
    sx::AttributeKey key;
    /// The sax ops
    std::vector<SAXOp> ops;

    /// Is document empty?
    bool empty() const { return ops.size() == 0; }
    /// Get the size of the document
    size_t size() const { return ops.size(); }
    /// Subscript operator
    const SAXOp& operator[](size_t idx) const { return ops[idx]; }

    /// Write entire document to writer
    template <typename Writer> void Write(Writer& out) const {
        for (auto& op : ops) {
            switch (op.tag) {
                case json::SAXOpTag::NULL_:
                    out.Null();
                    break;
                case json::SAXOpTag::ARRAY_END:
                    out.EndArray(std::get<int64_t>(op.argument));
                    break;
                case json::SAXOpTag::ARRAY_START:
                    out.StartArray();
                    break;
                case json::SAXOpTag::BOOL:
                    out.Bool(std::get<bool>(op.argument));
                    break;
                case json::SAXOpTag::DOUBLE:
                    out.Double(std::get<double>(op.argument));
                    break;
                case json::SAXOpTag::INT32:
                    out.Uint(std::get<int32_t>(op.argument));
                    break;
                case json::SAXOpTag::INT64:
                    out.Int64(std::get<int64_t>(op.argument));
                    break;
                case json::SAXOpTag::UINT32:
                    out.Uint(std::get<uint32_t>(op.argument));
                    break;
                case json::SAXOpTag::UINT64:
                    out.Uint64(std::get<uint64_t>(op.argument));
                    break;
                case json::SAXOpTag::KEY:
                    std::visit(
                        [&out](auto&& arg) {
                            using T = std::decay_t<decltype(arg)>;
                            if constexpr (std::is_same_v<T, std::string>) {
                                out.Key(arg.data(), arg.length(), true);
                            }
                            if constexpr (std::is_same_v<T, std::string_view>) {
                                out.Key(arg.data(), arg.length(), false);
                            }
                        },
                        op.argument);
                    break;
                case json::SAXOpTag::OBJECT_END:
                    out.EndObject(std::get<int64_t>(op.argument));
                    break;
                case json::SAXOpTag::OBJECT_START:
                    out.StartObject();
                    break;
                case json::SAXOpTag::STRING: {
                    auto& s = std::get<std::string>(op.argument);
                    out.String(s.data(), s.size(), true);
                    break;
                }
                case json::SAXOpTag::STRING_REF: {
                    auto& s = std::get<std::string_view>(op.argument);
                    out.String(s.data(), s.size(), false);
                    break;
                }
            }
        }
    }
};

struct SAXDocumentBuilder : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, SAXDocumentBuilder> {
    /// The current doc
    SAXDocument doc;

    /// Constructor
    SAXDocumentBuilder(sx::AttributeKey key) {
        doc = {
            .key = key,
            .ops = {},
        };
    }

    bool Null() {
        doc.ops.push_back({.tag = SAXOpTag::NULL_, .argument = std::nullopt});
        return true;
    }

    bool Key(std::string_view name, bool copy = false) {
        doc.ops.push_back({.tag = SAXOpTag::KEY, .argument = copy ? SAXOpArg{std::string{name}} : SAXOpArg{name}});
        return true;
    }

    bool Key(const char* txt, size_t length, bool copy) { return Key(std::string_view{txt, length}, copy); }
    bool String(std::string_view name, bool copy = false) {
        doc.ops.push_back({.tag = SAXOpTag::STRING, .argument = copy ? SAXOpArg{std::string{name}} : SAXOpArg{name}});
        return true;
    }
    bool String(const char* txt, size_t length, bool copy) { return String(std::string_view{txt, length}, copy); }
    bool Bool(bool v) {
        doc.ops.push_back({.tag = SAXOpTag::BOOL, .argument = v});
        return true;
    }
    bool Int(int32_t v) {
        doc.ops.push_back({.tag = SAXOpTag::INT32, .argument = v});
        return true;
    }
    bool Int64(int64_t v) {
        doc.ops.push_back({.tag = SAXOpTag::INT64, .argument = v});
        return true;
    }
    bool Uint(uint32_t v) {
        doc.ops.push_back({.tag = SAXOpTag::UINT32, .argument = v});
        return true;
    }
    bool Uint64(uint64_t v) {
        doc.ops.push_back({.tag = SAXOpTag::UINT64, .argument = v});
        return true;
    }
    bool Double(double v) {
        doc.ops.push_back({.tag = SAXOpTag::DOUBLE, .argument = v});
        return true;
    }
    bool StartObject() {
        doc.ops.push_back({.tag = SAXOpTag::OBJECT_START, .argument = std::nullopt});
        return true;
    }
    bool StartArray() {
        doc.ops.push_back({.tag = SAXOpTag::ARRAY_START, .argument = std::nullopt});
        return true;
    }
    bool EndObject(size_t count) {
        doc.ops.push_back({.tag = SAXOpTag::OBJECT_END, .argument = static_cast<int64_t>(count)});
        return true;
    }
    bool EndArray(size_t count) {
        doc.ops.push_back({.tag = SAXOpTag::ARRAY_END, .argument = static_cast<int64_t>(count)});
        return true;
    }
    SAXDocument Finish() { return std::move(doc); }
};

}  // namespace json
}  // namespace dashql

#endif
