#pragma once

#include <cstdint>
#include <span>
#include <string>

#include "arrow/result.h"

namespace dashql::shell {

class ArrowRenderer {
   public:
    explicit ArrowRenderer(uint32_t terminal_columns = 100);

    void Resize(uint32_t terminal_columns);
    arrow::Result<std::string> RenderIPC(std::span<const uint8_t> data) const;

   private:
    uint32_t terminal_columns_;
};

}  // namespace dashql::shell
