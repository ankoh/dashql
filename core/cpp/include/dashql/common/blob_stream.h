// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_COMMON_STREAMS_H_
#define INCLUDE_DASHQL_COMMON_STREAMS_H_

#include <iostream>
#include <memory>
#include <vector>

namespace dashql {

using BlobID = size_t;

constexpr size_t BLOB_SREAMBUF_SIZE = 16 * 1024;

class BlobIStreamBuffer : public std::streambuf {
   public:
    using UnderflowFunc = size_t (*)(BlobID, char*, size_t);

   protected:
    /// The underflow function
    UnderflowFunc underflow_func_;
    /// The blob id
    BlobID blob_id_;
    /// The global writer
    size_t blob_offset_;
    /// Reached the blob end?
    bool blob_end_;
    /// The buffer
    std::unique_ptr<char[]> buffer_;

    /// Is at EOF?
    inline bool IsEOF() const { return blob_end_ && (egptr() == gptr()); }

   public:
    /// Constructor
    BlobIStreamBuffer(UnderflowFunc underflow, BlobID blob_id);

    /// Virtual function (to be read s-how-many-c) called by other member functions to get
    /// an estimate on the number of characters available in the associated input sequence.
    std::streamsize showmanyc() override;
    /// Retrieves characters from the controlled input sequence and stores them in the array pointed by s,
    /// until either n characters have been extracted or the end of the sequence is reached.
    std::streamsize xsgetn(char* out, std::streamsize capacity) override;
    /// Virtual function called by other member functions to get the current character
    /// in the controlled input sequence without changing the current position.
    int_type underflow() override;
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_COMMON_STREAMS_H_
