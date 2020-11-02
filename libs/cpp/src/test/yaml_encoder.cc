#include "dashql/parser/test/yaml_encoder.h"

#include <cstdint>
#include <regex>
#include <sstream>
#include <stack>
#include <unordered_set>

#include "c4/yml/std/string.hpp"
#include "c4/yml/yml.hpp"
#include "ryml.hpp"
#include "ryml_std.hpp"

namespace dashql {
namespace parser {

namespace sx = proto::syntax;

namespace {

constexpr size_t INLINE_LOCATION_CAP = 20;
constexpr size_t LOCATION_HINT_LENGTH = 10;

std::string escape(std::string_view in) {
    std::string out{in};
    for (size_t i = out.find("\n", 0); i != std::string::npos; i = out.find("\n", i)) {
        out.replace(i, 1, "\\n");
        i += 2;
    }
    return out;
}

void encode(ryml::NodeRef n, proto::syntax::Location loc, std::string_view text) {
    n |= ryml::VAL;

    auto begin = loc.offset();
    auto end = loc.offset() + loc.length();

    std::stringstream ss;
    ss << begin << ".." << end;
    if (loc.length() < INLINE_LOCATION_CAP) {
        ss << "|`" << escape(text.substr(loc.offset(), loc.length())) << "`";
    } else {
        auto prefix = escape(text.substr(loc.offset(), LOCATION_HINT_LENGTH));
        auto suffix = escape(text.substr(loc.offset() + loc.length() - LOCATION_HINT_LENGTH, LOCATION_HINT_LENGTH));
        ss << "|`" << prefix << "`..`" << suffix << "`";
    }
    n << ss.str();
}

void encode(ryml::NodeRef e, const proto::syntax::Error& err, std::string_view text) {
    e |= ryml::MAP;
    e["message"] = c4::to_csubstr(err.message()->c_str());
    encode(e["location"], *err.location(), text);
}

}  // namespace

/// Encode yaml
void EncodeTestExpectation(ryml::NodeRef root, const proto::syntax::Module& module, std::string_view text) {
    auto& tree = *root.tree();
    root |= ryml::MAP;

    auto* obj_type_tt = proto::syntax::ObjectTypeTypeTable();
    auto* attr_key_tt = proto::syntax::AttributeKeyTypeTable();

    auto tmp = root["tmp"];
    tmp |= ryml::SEQ;

    // Translate document
    {
        // Unpack document
        auto* entries = module.statements()->entries();
        auto* objs = module.statements()->objects();
        auto* attrs = module.statements()->attributes();
        auto* arrays = module.statements()->arrays();
        auto* array_values = module.statements()->array_values();

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
        std::vector<ryml::NodeRef> tmp_values;
        tmp_values.reserve(module.statements()->objects()->size());
        for (unsigned oid = 0; oid < objs->size(); ++oid) {
            auto o = objs->Get(oid);

            // Create object
            tmp_values.push_back(tmp.append_child());
            auto v = tmp_values.back();
            v |= ryml::MAP;
            v["type"] = c4::to_csubstr(obj_type_tt->names[static_cast<size_t>(o->type())]);
            encode(v["location"], o->location(), text);

            // Translate attributes
            auto& attr_span = o->attributes();
            auto attr_end = attr_span.offset() + attr_span.length();
            for (unsigned i = attr_span.offset(); i < attr_end; ++i) {
                // Unpack attribute
                auto* attr = attrs->Get(i);
                auto& attr_value = attr->value();
                auto attr_key = std::string_view(attr_key_tt->names[static_cast<size_t>(attr->key())]);

                std::vector<std::tuple<ryml::NodeRef, std::string_view, const sx::Value*>> pending;
                pending.push_back({v, attr_key, &attr_value});

                while (!pending.empty()) {
                    auto [parent, key, target] = pending.back();
                    auto k = c4::csubstr(key.data(), key.size());
                    pending.pop_back();

                    // Check attribute type
                    switch (target->type()) {
                        case sx::ValueType::NONE:
                            break;
                        case sx::ValueType::I64: {
                            auto n = key.empty() ? parent.append_child() : parent[k];
                            n |= ryml::VAL;
                            n << target->value();
                            break;
                        }
                        case sx::ValueType::STRING: {
                            encode(key.empty() ? parent.append_child() : parent[k], target->location(), text);
                            break;
                        }
                        case sx::ValueType::OBJECT: {
                            auto aid = assert_less_than(target->value(), oid);
                            tree.move(tmp_values[aid].id(), parent.id(), tree.last_child(parent.id()));
                            if (!key.empty()) {
                                tmp_values[aid].set_key(k);
                            }
                            break;
                        }
                        case sx::ValueType::ARRAY: {
                            auto n = key.empty() ? parent.append_child() : parent[k];
                            n |= ryml::SEQ;

                            auto array_id = target->value();
                            auto array_ptr = arrays->Get(array_id);
                            auto array_begin = array_ptr->offset();
                            auto array_end = array_begin + array_ptr->length();

                            for (auto i = array_begin; i < array_end; ++i) {
                                auto array_elem = array_values->Get(array_end - i - 1);
                                pending.push_back({n, {}, array_elem});
                            }
                        }
                    }
                }
            }
        }

        // Build the document entries
        auto statements = root["statements"];
        statements |= ryml::SEQ;
        for (unsigned id = 0; id < entries->size(); ++id) {
            auto entry = entries->Get(id);
            if (entry->type() != sx::ValueType::OBJECT)
                continue;
            assert_less_than(id, entries->size());
            auto child = tmp_values[entry->value()].id();
            tree.move(child, statements.id(), tree.last_child(statements.id()));
        }
    }
    tree.remove(tmp.id());

    // Add errors
    auto errors = root["errors"];
    errors |= ryml::SEQ;
    for (auto err : *module.errors()) encode(errors.append_child(), *err, text);

    // Add line breaks
    auto line_breaks = root["line_breaks"];
    line_breaks |= ryml::SEQ;
    for (auto err : *module.line_breaks()) encode(line_breaks.append_child(), *err, text);

    // Add comments
    auto comments = root["comments"];
    comments |= ryml::SEQ;
    for (auto err : *module.comments()) encode(comments.append_child(), *err, text);
}

}  // namespace parser
}  // namespace dashql
