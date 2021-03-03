// Copyright (c) 2020 The DashQL Authors

#include "dashql/dataframe/dataframe.h"

#include "binaryen-c.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace dataframe {
Dataframe::Dataframe(Dataframe::AlgebraTree &algebra_tree) {
    BinaryenModuleRef module = BinaryenModuleCreate();
    auto result = BinaryenModuleAllocateAndWrite(module, nullptr);
    this->module = {static_cast<char *>(result.binary), static_cast<char *>(result.binary) + result.binaryBytes};
}
}  // namespace dataframe
}  // namespace dashql
