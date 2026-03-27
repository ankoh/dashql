#pragma once

#include <algorithm>
#include <string>

namespace dashql {

inline bool is_no_quote(unsigned char c) { return c != '\''; }
inline bool is_no_double_quote(unsigned char c) { return c != '\"'; }
inline bool is_no_space(unsigned char c) { return c != ' ' && c != '\n'; }

template <typename Fn> inline void trim_left(std::string &s, Fn keep_char) {
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), keep_char));
}
template <typename Fn> inline void trim_right(std::string &s, Fn keep_char) {
    s.erase(std::find_if(s.rbegin(), s.rend(), keep_char).base(), s.end());
}
template <typename Fn> inline void trim(std::string &s, Fn keep_char) {
    trim_left(s, keep_char);
    trim_right(s, keep_char);
}
template <typename Fn> inline std::string_view trim_view_left(std::string_view s, Fn keepChar) {
    auto offset = std::find_if(s.begin(), s.end(), keepChar) - s.begin();
    return {s.data() + offset, s.size() - static_cast<size_t>(offset)};
}
template <typename Fn> inline std::string_view trim_view_right(std::string_view s, Fn keepChar) {
    auto len = std::find_if(s.rbegin(), s.rend(), keepChar).base() - s.begin();
    return {s.data(), static_cast<size_t>(len)};
}
template <typename Fn> inline std::string_view trim_view(std::string_view s, Fn keepChar) {
    return trim_view_left(trim_view_right(s, keepChar), keepChar);
}

}  // namespace dashql
