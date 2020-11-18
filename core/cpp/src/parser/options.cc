#include <unordered_map>
#include <sstream>
#include "dashql/parser/grammar/nodes.h"

namespace dashql {
namespace parser {

/// The keyword map
static const std::unordered_map<std::string_view, sx::AttributeKey> DASHQL_OPTIONS = {
#define X(NAME, TOKEN) { NAME, sx::AttributeKey::TOKEN },
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

/// Map an option.
/// Registers an error if the (key, value) combination is not supported.
sx::Node Option(ParserDriver& driver, sx::Location loc, sx::Location key_loc, sx::Node value) {

    // Try to match the option key
    auto key_text = driver.scanner().TextAt(key_loc);
    auto key = sx::AttributeKey::NONE;
    if (key_text.size() <= MAX_OPTION_KEY_LENGTH) {
        // Convert to lowercase
        std::array<char, MAX_OPTION_KEY_LENGTH + 1> buffer;
        for (unsigned i = 0; i < key_text.size(); ++i)
            buffer[i] = ::tolower(key_text[i]);
        std::string_view text_lc{buffer.data(), key_text.size()};

        // Find the keyword
        if (auto iter = DASHQL_OPTIONS.find(text_lc); iter != DASHQL_OPTIONS.end())
            key = iter->second;
    }

    // Couldn't match option key?
    if (key == sx::AttributeKey::NONE) {
        std::stringstream err_msg;
        err_msg << "unknown option key: ";
        err_msg << key_text;
        driver.AddError(loc, err_msg.str());
        return Null();
    }

    // Check whether the given (key, value) pair is valid.
    // This is a best-effort check and will produce false-positives.

    // XXX

    // Everything seems fine, return the option
    return key << value;
}

}
}
