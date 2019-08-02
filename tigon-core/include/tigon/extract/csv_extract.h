//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_EXTRACT_CSV_EXTRACT_H_
#define INCLUDE_TIGON_EXTRACT_CSV_EXTRACT_H_

#include "tigon/extract/extract.h"

namespace tigon {

class CSVExtract : public Extract {
  public:
    /// Constructor
    CSVExtract(duckdb::Connection &conn, proto::TQLExtractStatement &statement);
    /// Destructor
    ~CSVExtract() = default;

    /// Prepare the database
    void prepare() override;
    /// Read a buffer into the extract
    void read(nonstd::span<std::byte> buffer) override;
};

} // namespace tigon

#endif // INCLUDE_TIGON_EXTRACT_CSV_EXTRACT_H_
