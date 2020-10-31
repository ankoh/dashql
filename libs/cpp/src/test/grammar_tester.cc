#include "dashql/parser/test/grammar_tester.h"

#include "ryml_std.hpp"
#include "ryml.hpp"
#include "c4/yml/emit.hpp"
#include "c4/yml/std/string.hpp"
#include "c4/yml/yml.hpp"

#include <cstdint>
#include <stack>
#include <unordered_set>
#include <sstream>
#include <regex>

namespace dashql {
namespace parser {

namespace sx = proto::syntax;

namespace {

constexpr size_t INLINE_LOCATION_CAP = 20;
constexpr size_t LOCATION_HINT_LENGTH = 10;

std::string escape(std::string_view in) {
    std::string out{in};
    for (size_t i = out.find("\n", 0); i != std::string::npos; i = out.find("\n", 0)) {
        out.replace(i, 2, "\\n");
        i += 1;
    }
    return out;
}

void encode(ryml::NodeRef n, proto::syntax::Location loc, std::string_view text) {
    n |= ryml::VAL;

    auto begin = loc.offset();
    auto end = loc.offset() + loc.length();

    std::stringstream ss;
    ss << begin << ".." <<  end;
    if (loc.length() < INLINE_LOCATION_CAP) {
        ss << "|'" << escape(text.substr(loc.offset(), loc.length())) << "'";
    } else {
        auto prefix = escape(text.substr(loc.offset(), LOCATION_HINT_LENGTH));
        auto suffix = escape(text.substr(loc.offset() + loc.length() - LOCATION_HINT_LENGTH, LOCATION_HINT_LENGTH));
        ss << "|'" << prefix << "'..'" << suffix << "'";
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
void GrammarTester::EncodeExpect(ryml::NodeRef ref, const proto::syntax::Module& module, std::string_view text) {
    ryml::Tree tree;
    auto root = tree.rootref();
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
                auto attr_key = c4::to_csubstr(attr_key_tt->names[static_cast<size_t>(attr->key())]);

                // Check attribute type
                switch (attr_value.type()) {
                    case sx::ValueType::NONE:
                        break;
                    case sx::ValueType::I32: {
                        auto n = v[attr_key];
                        n |= ryml::VAL;
                        n << attr_value.value();
                        break;
                    }
                    case sx::ValueType::STRING: {
                        auto n = v[attr_key];
                        encode(n, attr_value.location(), text);
                        break;
                    }
                    case sx::ValueType::OBJECT: {
                        auto aid = assert_less_than(attr_value.value(), oid);
                        tree.move(tmp_values[aid].id(), v.id(), tree.last_child(v.id()));
                        tmp_values[aid].set_key(attr_key);
                        break;
                    }
                    case sx::ValueType::ARRAY: {
                        // Translate arrays with a stack since array can be nested
                        auto n = v[attr_key];
                        n |= ryml::SEQ;
                        std::vector<std::tuple<ryml::NodeRef, const sx::Array*>> nested_arrays;
                        nested_arrays.push_back({n, arrays->Get(attr_value.value())});

                        while (!nested_arrays.empty()) {
                            auto& [array_node, array_ptr] = nested_arrays.back();
                            nested_arrays.pop_back();

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
                                    for (auto i = array_begin; i < array_end; ++i) {
                                        auto nested_array = array_node.append_child();
                                        nested_array |= ryml::SEQ;
                                        nested_arrays.push_back({nested_array, arrays->Get(i)});
                                    }
                                    break;
                                case sx::ValueType::OBJECT:
                                    assert_within(array_begin, array_end, oid);
                                    for (unsigned i = array_begin; i < array_end; ++i) {
                                        tree.move(tmp_values[i].id(), array_node.id(), tree.last_child(array_node.id()));
                                    }
                                    break;
                                case sx::ValueType::STRING:
                                    assert_within(array_begin, array_end, values_str->size());
                                    for (auto i = array_begin; i < array_end; ++i) {
                                        auto nested_val = array_node.append_child();
                                        nested_val |= ryml::VAL;
                                        encode(nested_val, *values_str->Get(i), text);
                                    }
                                    break;
                                case sx::ValueType::I32:
                                    assert_within(array_begin, array_end, values_i32->size());
                                    for (auto i = array_begin; i < array_end; ++i) {
                                        auto nested_val = array_node.append_child();
                                        nested_val |= ryml::VAL;
                                        nested_val << values_i32->Get(i);
                                    }
                                    break;
                            }
                        }
                        break;
                    }
                }
            }
        }

        // Build the document entries
        auto statements = root["statements"];
        statements |= ryml::SEQ;
        for (unsigned id = 0; id < entries->size(); ++id) {
            assert_less_than(id, entries->size());
            auto child = tmp_values[entries->Get(id)].id();
            tree.move(child, statements.id(), tree.last_child(statements.id()));
        }
    }
    tree.remove(tmp.id());

    // Add errors
    auto errors = root["errors"];
    errors |= ryml::SEQ;
    for (auto err : *module.errors())
        encode(errors.append_child(), *err, text);

    // Add line breaks
    auto line_breaks = root["line_breaks"];
    line_breaks |= ryml::SEQ;
    for (auto err : *module.line_breaks())
        encode(line_breaks.append_child(), *err, text);

    // Add comments
    auto comments = root["comments"];
    comments |= ryml::SEQ;
    for (auto err : *module.comments())
        encode(comments.append_child(), *err, text);

    // Write the yaml
    ryml::emit(tree);
}

}  // namespace parser
}  // namespace dashql
