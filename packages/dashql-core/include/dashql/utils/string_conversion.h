#pragma once

#include <array>
#include <iostream>
#include <string>
#include <string_view>

namespace dashql {

extern const std::array<unsigned char, 256> TOLOWER_ASCII_TABLE;
// This will return weird results with non-ascii characters, use with caution
inline unsigned char tolower_fuzzy(unsigned char c) { return TOLOWER_ASCII_TABLE[c]; }

inline bool anyupper_fuzzy(std::string_view s) {
    bool anyupper = false;
    for (char c : s) {
        anyupper |= c >= 65 && c <= 90;
    }
    return anyupper;
}

/// Is a character a valid start of an unquoted identifier?
/// Mirrors the scanner's `ident_start` rule: [A-Za-z\200-\377_]
inline bool is_ident_start(unsigned char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' || c >= 0x80;
}

/// Is a character a valid continuation of an unquoted identifier?
/// Mirrors the scanner's `ident_cont` rule: [A-Za-z\200-\377_0-9$]
inline bool is_ident_cont(unsigned char c) { return is_ident_start(c) || (c >= '0' && c <= '9') || c == '$'; }

/// Does an identifier require double-quoting to round-trip through the scanner?
/// This is the case when it contains upper-case characters (which the scanner would fold to
/// lower-case) or characters that aren't valid in a bare identifier (e.g. `/`, `.`, leading digit).
inline bool identifier_requires_quotes(std::string_view text) {
    if (text.empty()) {
        return true;
    }
    if (anyupper_fuzzy(text)) {
        return true;
    }
    if (!is_ident_start(static_cast<unsigned char>(text.front()))) {
        return true;
    }
    for (char c : text) {
        if (!is_ident_cont(static_cast<unsigned char>(c))) {
            return true;
        }
    }
    return false;
}

inline int memicmp_fuzzy(const void *_s1, const void *_s2, size_t len) {
    auto *s1 = static_cast<const unsigned char *>(_s1);
    auto *s2 = static_cast<const unsigned char *>(_s2);
    for (; len > 0; --len, ++s1, ++s2) {
        auto c1 = tolower_fuzzy(*s1);
        auto c2 = tolower_fuzzy(*s2);
        if (c1 != c2) return c1 - c2;
    }
    return 0;
}

struct fuzzy_ci_char_traits : public std::char_traits<char> {
    static bool eq(char c1, char c2) { return tolower_fuzzy(c1) == tolower_fuzzy(c2); }
    static bool ne(char c1, char c2) { return tolower_fuzzy(c1) != tolower_fuzzy(c2); }
    static bool lt(char c1, char c2) { return tolower_fuzzy(c1) < tolower_fuzzy(c2); }
    static int compare(const char *s1, const char *s2, size_t n) { return memicmp_fuzzy(s1, s2, n); }
    static const char *find(const char *s, int n, char a) {
        for (; n-- > 0; ++s) {
            if (tolower_fuzzy(*s) == tolower_fuzzy(a)) {
                return s;
            }
        }
        return nullptr;
    }
};
using fuzzy_ci_string_view = std::basic_string_view<char, fuzzy_ci_char_traits>;

/// Helper to double-quote a name if it isn't a valid bare identifier (case-sensitive or
/// containing characters that aren't allowed in an unquoted identifier). Embedded double
/// quotes are escaped by doubling them.
inline std::string_view quote_anyupper_fuzzy(std::string_view text, std::string &tmp) {
    if (identifier_requires_quotes(text)) {
        tmp.clear();
        tmp.reserve(text.size() + 2);
        tmp.push_back('\"');
        for (char c : text) {
            if (c == '\"') {
                tmp.push_back('\"');
            }
            tmp.push_back(c);
        }
        tmp.push_back('\"');
        return tmp;
    } else {
        return text;
    }
}

/// Wrapper class for conditional quoting based on uppercase characters
class QuotedIfAnyUpper {
    /// The text
    std::string_view text_;

   public:
    /// Constructor
    explicit QuotedIfAnyUpper(std::string_view text) : text_(text) {}
    /// Stream operator
    friend std::ostream &operator<<(std::ostream &os, const QuotedIfAnyUpper &wrapper) {
        if (identifier_requires_quotes(wrapper.text_)) {
            os << '"';
            for (char c : wrapper.text_) {
                if (c == '"') {
                    os << '"';
                }
                os << c;
            }
            os << '"';
        } else {
            os << wrapper.text_;
        }
        return os;
    }
};

}  // namespace dashql
