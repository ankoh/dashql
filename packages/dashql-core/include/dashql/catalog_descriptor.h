#pragma once

#include <flatbuffers/detached_buffer.h>

#include "dashql/catalog.h"

namespace dashql {

/// Immutable verified descriptor bytes, owning all declaration strings.
class DescriptorPool {
    const std::vector<uint8_t> data;

   public:
    explicit DescriptorPool(std::span<const uint8_t> bytes);
    const buffers::catalog::CatalogDescriptor& GetDescriptor() const;
};

/// Receiver-local declarations backed by immutable bytes, with a lazy completion index.
class DescriptorEntry final : public CatalogEntry {
    const std::shared_ptr<const DescriptorPool> pool;
    const Rank rank;
    NameRegistry names;

   public:
    DescriptorEntry(Catalog& catalog, CatalogEntryID id, Rank rank, std::shared_ptr<const DescriptorPool> pool);
    Rank GetRank() const { return rank; }
    flatbuffers::Offset<buffers::catalog::CatalogEntry> DescribeEntry(
        flatbuffers::FlatBufferBuilder& builder) const override;
    const NameSearchIndex& GetNameSearchIndex() override;
};

/// Throws std::invalid_argument if declarations cannot be imported by DescriptorPool.
flatbuffers::DetachedBuffer PackCatalogDescriptor(const CatalogEntry& entry);

}  // namespace dashql
