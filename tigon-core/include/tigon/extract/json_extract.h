//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_EXTRACT_JSON_EXTRACT_H_
#define INCLUDE_TIGON_EXTRACT_JSON_EXTRACT_H_

#include "tigon/extract/extract.h"

namespace tigon {

class JSONExtract: public Extract {
    public:
    /// Constructor
    JSONExtract(duckdb::Connection& conn, proto::TQLExtractStatement& stmt);
    /// Destructor
    ~JSONExtract() = default;

    /// Prepare the database
    void prepare() override;
    /// Read a buffer into the extract
    void read(nonstd::span<std::byte> buffer) override;
};

} // namespace tigon

#endif // INCLUDE_TIGON_EXTRACT_JSON_EXTRACT_H_
