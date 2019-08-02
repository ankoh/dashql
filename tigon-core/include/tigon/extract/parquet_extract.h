//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_EXTRACT_PARQUET_EXTRACT_H_
#define INCLUDE_TIGON_EXTRACT_PARQUET_EXTRACT_H_

#include "tigon/extract/extract.h"

namespace tigon {

class ParquetExtract: public Extract {
    /// Read a buffer into the extract
    void read(nonstd::span<std::byte> buffer) override;
};


} // namespace tigon

#endif // INCLUDE_TIGON_EXTRACT_PARQUET_EXTRACT_H_
