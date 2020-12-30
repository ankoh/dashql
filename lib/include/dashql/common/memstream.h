// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_MEMSTREAM_H_
#define INCLUDE_DASHQL_COMMON_MEMSTREAM_H_

#include <istream>
#include <streambuf>

namespace dashql {

struct membuf : std::streambuf {
    membuf(char const* base, size_t size) {
        char* p(const_cast<char*>(base));
        this->setg(p, p, p + size);
    }
};

struct imemstream : virtual membuf, std::istream {
    imemstream(char const* base, size_t size) : membuf(base, size), std::istream(static_cast<std::streambuf*>(this)) {}
};

}  // namespace dashql

#endif
