//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_EXTRACT_EXTRACT_H_
#define INCLUDE_TIGON_EXTRACT_EXTRACT_H_

#include "tigon/common/span.h"

namespace tigon {

class Extract {
    /// Read a buffer into the extract
    virtual void read(nonstd::span<std::byte> buffer);
};

} // namespace tigon

#endif // INCLUDE_TIGON_EXTRACT_EXTRACT_H_
