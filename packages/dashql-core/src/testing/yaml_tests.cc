#include "dashql/testing/yaml_tests.h"

#include <sstream>

#include "c4/yml/emit.hpp"
#include "c4/yml/std/std.hpp"
#include "dashql/script.h"
#include "gtest/gtest.h"

namespace dashql::testing {

constexpr size_t INLINE_LOCATION_CAP = 20;
constexpr size_t LOCATION_HINT_LENGTH = 10;
constexpr size_t YAML_MAX_DEPTH = 128;

::testing::AssertionResult Matches(c4::yml::ConstNodeRef have, c4::yml::ConstNodeRef expected) {
    std::string have_str = c4::yml::emitrs_yaml<std::string>(have, c4::yml::EmitOptions().max_depth(YAML_MAX_DEPTH));
    std::string expected_str =
        c4::yml::emitrs_yaml<std::string>(expected, c4::yml::EmitOptions().max_depth(YAML_MAX_DEPTH));
    if (have_str == expected_str) return ::testing::AssertionSuccess();

    std::ostringstream err;
    err << "\nHAVE\n----------------------------------------\n" << have_str;
    err << "\nEXPECTED\n----------------------------------------\n" << expected_str << "\n";
    std::vector<std::string> expected_lines, actual_lines;
    ::testing::internal::SplitString(expected_str, '\n', &expected_lines);
    ::testing::internal::SplitString(have_str, '\n', &actual_lines);
    err << ::testing::internal::edit_distance::CreateUnifiedDiff(actual_lines, expected_lines) << "\n";
    return ::testing::AssertionFailure() << err.str();
}

::testing::AssertionResult MatchesContent(c4::yml::ConstNodeRef have, c4::yml::ConstNodeRef expected_keymap) {
    if (!expected_keymap.has_key() || !expected_keymap.is_container()) {
        return Matches(have, expected_keymap);
    }
    // Emit expected_keymap and strip the top-level key line so we compare have with the inner content.
    std::string expected_full =
        c4::yml::emitrs_yaml<std::string>(expected_keymap, c4::yml::EmitOptions().max_depth(YAML_MAX_DEPTH));
    size_t first_nl = expected_full.find('\n');
    if (first_nl == std::string::npos) {
        return Matches(have, expected_keymap);
    }
    std::string expected_content = expected_full.substr(first_nl + 1);
    // Unindent: find the minimum leading spaces on the first line and strip that from every line.
    size_t indent = 0;
    while (indent < expected_content.size() && expected_content[indent] == ' ') ++indent;
    if (indent > 0) {
        std::string unindented;
        unindented.reserve(expected_content.size());
        size_t pos = 0;
        while (pos < expected_content.size()) {
            size_t line_start = pos;
            while (pos < expected_content.size() && expected_content[pos] != '\n') ++pos;
            std::string line(expected_content.substr(line_start, pos - line_start));
            if (line.size() >= indent) line = line.substr(indent);
            unindented += line;
            if (pos < expected_content.size()) {
                unindented += '\n';
                ++pos;
            }
        }
        expected_content = std::move(unindented);
    }
    std::string have_str = c4::yml::emitrs_yaml<std::string>(have, c4::yml::EmitOptions().max_depth(YAML_MAX_DEPTH));
    if (have_str == expected_content) return ::testing::AssertionSuccess();
    std::ostringstream err;
    err << "\nHAVE\n----------------------------------------\n" << have_str;
    err << "\nEXPECTED\n----------------------------------------\n" << expected_content << "\n";
    std::vector<std::string> expected_lines, actual_lines;
    ::testing::internal::SplitString(expected_content, '\n', &expected_lines);
    ::testing::internal::SplitString(have_str, '\n', &actual_lines);
    err << ::testing::internal::edit_distance::CreateUnifiedDiff(actual_lines, expected_lines) << "\n";
    return ::testing::AssertionFailure() << err.str();
}

void EncodeLocationText(c4::yml::NodeRef n, buffers::parser::Location loc, std::string_view text,
                        const char* text_key) {
    auto begin = loc.offset();
    auto end = loc.offset() + loc.length();

    std::string text_val;
    if (loc.length() < INLINE_LOCATION_CAP) {
        text_val = std::string(text.substr(loc.offset(), loc.length()));
    } else {
        auto loc_prefix = text.substr(loc.offset(), LOCATION_HINT_LENGTH);
        auto loc_suffix = text.substr(loc.offset() + loc.length() - LOCATION_HINT_LENGTH, LOCATION_HINT_LENGTH);
        text_val = std::string(loc_prefix) + ".." + std::string(loc_suffix);
    }
    auto text_node = n.append_child();
    text_node << c4::yml::key(text_key);
    if (text_val.empty()) {
      // Empty string: rapidyaml can emit a null byte for empty double-quoted scalars.
      // Use a sentinel that readers treat as empty.
      text_node.set_val(n.tree()->to_arena("<empty-quoted>"));
    } else {
      text_node << text_val;
    }
    text_node.set_val_style(c4::yml::VAL_DQUO);  // always emit as quoted string (e.g. "1")
}

void EncodeLocationRange(c4::yml::NodeRef n, buffers::parser::Location loc, std::string_view text,
                         const char* loc_key) {
    auto begin = loc.offset();
    auto end = loc.offset() + loc.length();

    auto loc_node = n.append_child();
    loc_node << c4::yml::key(loc_key);
    loc_node |= c4::yml::SEQ;
    loc_node.set_container_style(c4::yml::FLOW_SL);  // emit as [begin, end]
    loc_node.append_child() << begin;
    loc_node.append_child() << end;
}

void EncodeError(c4::yml::NodeRef n, const buffers::parser::ErrorT& err, std::string_view text) {
    n.append_child() << c4::yml::key("message") << err.message;
    EncodeLocationText(n, *err.location, text);
}

}  // namespace dashql::testing
