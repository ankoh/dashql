//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_INFRA_TEXT_VIEW_STREAM_H_
#define INCLUDE_TIGON_INFRA_TEXT_VIEW_STREAM_H_

#include <streambuf>
#include <istream>
#include <string_view>

namespace tigon {

struct TextViewBuffer: std::streambuf {
    TextViewBuffer(char const* base, size_t size) {
        char* p(const_cast<char*>(base));
        this->setg(p, p, p + size);
    }

    TextViewBuffer(std::string_view str)
        : TextViewBuffer(str.data(), str.length()) {}
};

struct ITextViewStream: virtual TextViewBuffer, std::istream {
    ITextViewStream(std::string_view str)
        : TextViewBuffer(str), std::istream(static_cast<std::streambuf*>(this)) {
    }
};

} // namespace tigon

#endif // INCLUDE_TIGON_INFRA_TEXT_VIEW_STREAM_H_
