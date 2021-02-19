#include <sstream>
#include <unordered_map>

#include "dashql/parser/grammar/nodes.h"
#include "dashql/proto_generated.h"

namespace dashql {
namespace parser {

/// The keyword map
static const std::unordered_map<std::string_view, sx::AttributeKey> DASHQL_OPTIONS = {
#define X(NAME, TOKEN) {NAME, sx::AttributeKey::TOKEN},
#include "./grammar/lists/dashql_option_keys.list"
#undef X
};

/// Determine the maximum keyword length
size_t constexpr length(const char* str) { return *str ? 1 + length(str + 1) : 0; }
constexpr size_t MAX_OPTION_KEY_LENGTH = std::max<size_t>({
#define X(NAME, TOKEN) length(NAME),
#include "./grammar/lists/dashql_option_keys.list"
#undef X
});

constexpr size_t MAX_NESTING_LEVEL = 4;

/// Map an option.
/// Registers an error if the (key, value) combination is not supported.
sx::Node Option(ParserDriver& driver, sx::Location loc, std::vector<sx::Location>&& key_path, sx::Node value) {
    // Check max nesting level
    std::array<sx::AttributeKey, MAX_NESTING_LEVEL> keys;
    if (key_path.size() > keys.size()) {
        std::stringstream err_msg;
        err_msg << "key length exceeds max nesting level of " << MAX_NESTING_LEVEL;
        driver.AddError(loc, err_msg.str());
        return Null();
    }

    // Parse keys
    for (unsigned i = 0; i < key_path.size(); ++i) {
        auto key_loc = key_path[i];
        auto key_text = driver.scanner().TextAt(key_loc);
        auto& key = keys[i];
        key = sx::AttributeKey::NONE;

        // Convert to lowercase
        if (key_text.size() <= MAX_OPTION_KEY_LENGTH) {
            // Convert to lowercase
            std::array<char, MAX_OPTION_KEY_LENGTH + 1> buffer;
            for (unsigned i = 0; i < key_text.size(); ++i) buffer[i] = ::tolower(key_text[i]);
            std::string_view text_lc{buffer.data(), key_text.size()};

            // Find the keyword
            if (auto iter = DASHQL_OPTIONS.find(text_lc); iter != DASHQL_OPTIONS.end()) key = iter->second;
        }

        // Abort immediately when encountering unknown keys
        if (key == sx::AttributeKey::NONE) {
            std::stringstream err_msg;
            err_msg << "unknown option key: ";
            err_msg << key_text;
            driver.AddError(loc, err_msg.str());
            return Null();
        }
    }

    // Build the options

    // XXX Check whether the given (key, value) pair is valid.
    // This is a best-effort check and will produce false-positives.

    // Expand key path
    auto iter = keys.rbegin() + (keys.size() - key_path.size());
    auto prev = *iter << value;
    for (++iter; iter != keys.rend(); ++iter) {
        prev = driver.AddObject(loc, sx::NodeType::OBJECT_DASHQL_OPTION_LIST, {&prev, 1}, true, false);
    }
    return prev;
}

}  // namespace parser
}  // namespace dashql
