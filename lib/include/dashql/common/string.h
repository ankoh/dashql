// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_STRING_H_
#define INCLUDE_DASHQL_COMMON_STRING_H_

#include <string>

namespace dashql {

inline bool isNoQuote(unsigned char c) { return c != '\"' && c != '\''; }

template <typename Fn> static inline void ltrim(std::string &s, Fn keepChar) {
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), keepChar));
}

template <typename Fn> static inline void rtrim(std::string &s, Fn keepChar) {
    s.erase(std::find_if(s.rbegin(), s.rend(), keepChar).base(), s.end());
}

template <typename Fn> static inline void trim(std::string &s, Fn keepChar) {
    ltrim(s, keepChar);
    rtrim(s, keepChar);
}

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_STRING_H_