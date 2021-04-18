#include "duckdb/web/io/streambuf.h"

#include <cstring>
#include <iostream>

namespace duckdb {
namespace web {
namespace io {

bool InputStreamBuffer::NextPage() {
    auto page_id = next_page_id_++;
    if ((page_id << buffer_manager_->GetPageSizeShift()) > file_.GetSize()) return false;
    buffer_.Release();
    buffer_ = buffer_manager_->FixPage(file_, page_id, false);
    auto data = buffer_.GetData();
    setg(data.data(), data.data(), data.data() + data.size());
    return true;
}

// std::streamsize InputStreamBuffer::xsgetn(char* out, std::streamsize n) {
//    n = std::min<size_t>(n, file_.GetSize());
//    auto prev = n;
//    while (n > 0) {
//        auto m = std::min(egptr() - gptr(), n);
//        std::memcpy(out, gptr(), m);
//        n -= m;
//        _M_in_cur += m;
//        if (egptr() == gptr() && not NextPage()) return prev - n;
//    }
//    return n;
//}

InputStreamBuffer::pos_type InputStreamBuffer::seekoff(off_type n, std::ios_base::seekdir dir,
                                                       std::ios_base::openmode) {
    size_t pos;
    if (dir == std::ios_base::beg) {
        pos = n;
    } else if (dir == std::ios_base::end) {
        pos = file_.GetSize() - n;
    } else {
        pos = std::min<size_t>(file_.GetSize(), pos + n);
    }
    next_page_id_ = pos >> buffer_manager_->GetPageSizeShift();
    NextPage();
    _M_in_cur += pos - (next_page_id_ << buffer_manager_->GetPageSizeShift());
    return pos;
}

InputStreamBuffer::pos_type InputStreamBuffer::seekpos(pos_type p, std::ios_base::openmode) {
    size_t pos = p;
    next_page_id_ = pos >> buffer_manager_->GetPageSizeShift();
    NextPage();
    _M_in_cur += pos - (next_page_id_ << buffer_manager_->GetPageSizeShift());
    return pos;
}

}  // namespace io
}  // namespace web
}  // namespace duckdb
