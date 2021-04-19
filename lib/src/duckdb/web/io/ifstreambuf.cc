#include "duckdb/web/io/ifstreambuf.h"

#include <cstring>

namespace duckdb {
namespace web {
namespace io {

bool InputFileStreamBuffer::NextPage() {
    auto page_id = next_page_id_++;
    if ((page_id << buffer_manager_->GetPageSizeShift()) > file_.GetSize()) return false;
    buffer_.Release();
    buffer_ = buffer_manager_->FixPage(file_, page_id, false);
    auto data = buffer_.GetData();
    setg(data.data(), data.data(), data.data() + data.size());
    return true;
}

std::streamsize InputFileStreamBuffer::xsgetn(char* out, std::streamsize want) {
    auto base = out;
    auto left = std::min<size_t>(want, file_.GetSize() - GetPosition());
    assert((egptr() - gptr()) <= (file_.GetSize() - GetPosition()));
    while (left > 0 && (gptr() < egptr() || NextPage())) {
        auto m = std::min<size_t>(egptr() - gptr(), left);
        std::memcpy(out, gptr(), m);
        gbump(m);
        out += m;
        left -= m;
    }
    return out - base;
}

InputFileStreamBuffer::pos_type InputFileStreamBuffer::seekoff(off_type n, std::ios_base::seekdir dir,
                                                               std::ios_base::openmode) {
    size_t pos;
    if (dir == std::ios_base::beg) {
        pos = n;
    } else if (dir == std::ios_base::end) {
        pos = file_.GetSize() - n;
    } else {
        pos = std::min<size_t>(file_.GetSize(), pos + n);
    }
    auto page_id = pos >> buffer_manager_->GetPageSizeShift();
    auto page_ofs = pos - (page_id << buffer_manager_->GetPageSizeShift());
    next_page_id_ = page_id;
    NextPage();
    gbump(page_ofs);
    return pos;
}

InputFileStreamBuffer::pos_type InputFileStreamBuffer::seekpos(pos_type p, std::ios_base::openmode) {
    auto page_id = p >> buffer_manager_->GetPageSizeShift();
    auto page_ofs = p - (page_id << buffer_manager_->GetPageSizeShift());
    next_page_id_ = page_id;
    NextPage();
    gbump(page_ofs);
    return p;
}

}  // namespace io
}  // namespace web
}  // namespace duckdb
