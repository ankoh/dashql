#include "dashql/parser/grammar/dson.h"

#include <sstream>
#include <unordered_map>

#include "dashql/parser/grammar/nodes.h"
#include "dashql/parser/string.h"
#include "dashql/proto_generated.h"

namespace dashql {
namespace parser {

/// Get the text at a location
static std::string_view textAt(std::string_view text, proto::Location loc) {
    return text.substr(loc.offset(), loc.length());
}

/// The keyword map
static const std::unordered_map<std::string_view, proto::AttributeKey> DSON_KEYS = {
#define X(NAME, TOKEN) {NAME, proto::AttributeKey::TOKEN},
#include "./grammar/lists/dson_keys.list"
#undef X
};

/// Determine the maximum keyword length
size_t constexpr length(const char* str) { return *str ? 1 + length(str + 1) : 0; }
constexpr size_t MAX_OPTION_KEY_LENGTH = std::max<size_t>({
#define X(NAME, TOKEN) length(NAME),
#include "./grammar/lists/dson_keys.list"
#undef X
});

/// Get dson key as string
static std::string_view knownKeyToString(uint16_t key) {
    switch (static_cast<proto::AttributeKey>(key)) {
#define X(NAME, TOKEN)               \
    case proto::AttributeKey::TOKEN: \
        return NAME;
#include "./grammar/lists/dson_keys.list"
#undef X
        default:
            return "";
    }
}

/// Map the DSON keys
static std::unordered_map<std::string_view, uint16_t> mapDSONKeys(std::string_view text,
                                                                  const std::vector<proto::Location>& keys) {
    std::unordered_map<std::string_view, uint16_t> dict;
    dict.reserve(keys.size());
    for (auto i = 0; i < keys.size(); ++i) {
        auto& key = keys[i];
        dict.insert({text.substr(key.offset(), key.length()), i});
    }
    return dict;
}

/// Constructor
DSONDictionary::DSONDictionary(std::string_view program_text, const proto::ProgramT& program)
    : program_text_(std::move(program_text)),
      program_(program),
      key_mapping_(mapDSONKeys(program_text_, program_.dson_keys)) {}

/// Convert an dson key to string
std::string_view DSONDictionary::keyToString(uint16_t key) const {
    if (key < static_cast<uint16_t>(proto::AttributeKey::DSON_DYNAMIC_KEYS_)) {
        return proto::AttributeKeyTypeTable()->names[key];
    } else {
        key -= static_cast<uint16_t>(proto::AttributeKey::DSON_DYNAMIC_KEYS_);
        assert(key < program_.dson_keys.size());
        auto text = textAt(program_text_, program_.dson_keys[key]);
        return text;
    }
}

/// Convert an dson key to camelcase (primarily for JSON)
std::string_view DSONDictionary::keyToStringForJSON(uint16_t key, std::string& tmp) const {
    if (key < static_cast<uint16_t>(proto::AttributeKey::DSON_KEYS_)) {
        return proto::AttributeKeyTypeTable()->names[key];
    }
    if (key >= static_cast<uint16_t>(proto::AttributeKey::DSON_DYNAMIC_KEYS_)) {
        key -= static_cast<uint16_t>(proto::AttributeKey::DSON_DYNAMIC_KEYS_);
        assert(key < program_.dson_keys.size());
        return textAt(program_text_, program_.dson_keys[key]);
    }
    tmp = knownKeyToString(key);
    bool to_upper = false;
    unsigned i = 0, j = 0;
    while (i < tmp.size()) {
        char c = tmp[i++];
        if (c == '_') {
            to_upper = true;
            continue;
        };
        tmp[j++] = to_upper ? std::toupper(c) : c;
        to_upper = false;
    }
    return {tmp.data(), j};
}

/// Convert an dson key to string for a script
std::string_view DSONDictionary::keyToStringForScript(uint16_t key, std::string& tmp) const {
    tmp = "'";
    tmp += keyToString(key);
    tmp += "'";
    return tmp;
}

/// Read dson from text
static uint16_t knownKeyFromString(std::string_view text) {
    // Try to match with known DSON keys
    if (text.size() <= MAX_OPTION_KEY_LENGTH) {
        // Convert to lowercase
        std::array<char, MAX_OPTION_KEY_LENGTH + 1> buffer;
        for (unsigned i = 0; i < text.size(); ++i) buffer[i] = ::tolower(text[i]);
        std::string_view text_lc{buffer.data(), text.size()};

        // Find the dson
        if (auto iter = DSON_KEYS.find(text_lc); iter != DSON_KEYS.end()) return static_cast<uint16_t>(iter->second);
    }
    return 0;
}

/// Get an attribute key from a string
uint16_t DSONDictionary::keyFromString(std::string_view text) const {
    if (auto iter = key_mapping_.find(text); iter != key_mapping_.end()) {
        return iter->second;
    }
    return knownKeyFromString(text);
}

/// Add a dson file in the parser.
proto::Node ParserDriver::AddDSONField(proto::Location loc, std::vector<proto::Location>&& key_path,
                                       proto::Node value) {
    constexpr size_t MAX_NESTING_LEVEL = 4;

    // Check max nesting level
    std::array<uint16_t, MAX_NESTING_LEVEL> keys;
    if (key_path.size() > keys.size()) {
        std::stringstream err_msg;
        err_msg << "key length exceeds max nesting level of " << MAX_NESTING_LEVEL;
        AddError(loc, err_msg.str());
        return Null();
    }

    // Parse keys
    for (unsigned i = 0; i < key_path.size(); ++i) {
        auto key_loc = key_path[i];
        auto key_text = scanner().TextAt(key_loc);
        auto& key = keys[i];
        key = 0;

        // Convert to lowercase
        if (key_text.size() <= MAX_OPTION_KEY_LENGTH) {
            key = static_cast<uint16_t>(knownKeyFromString(key_text));
        }

        // Check dictionary for unknown keys
        if (key == 0) {
            key_text = trimview(key_text, isNoQuote);
            key_loc = scanner().LocationOf(key_text);
            auto iter = dson_key_map_.find(key_text);
            if (iter == dson_key_map_.end()) {
                key = static_cast<uint16_t>(proto::AttributeKey::DSON_DYNAMIC_KEYS_) + dson_keys_.size();
                dson_key_map_.insert({key_text, key});
                dson_keys_.push_back(key_loc);
            } else {
                key = iter->second;
            }
        }

        // Register as dson key in scanner (for syntax highlighting)
        scanner().MarkAsDSONKey(key_loc);
    }

    // XXX Check whether the given (key, value) pair is valid.
    // This is a best-effort check and will produce false-positives.

    // Expand key path
    auto iter = keys.rbegin() + (keys.size() - key_path.size());
    auto prev = Attr(*iter, value);
    for (++iter; iter != keys.rend(); ++iter) {
        prev = Attr(*iter, AddObject(loc, proto::NodeType::OBJECT_DSON, {&prev, 1}, true, false));
    }
    return prev;
}

}  // namespace parser
}  // namespace dashql
