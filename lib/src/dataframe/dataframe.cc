// Copyright (c) 2020 The DashQL Authors

#include "dashql/dataframe/dataframe.h"

#include "binaryen-c.h"
#include "flatbuffers/flatbuffers.h"

namespace dashql {
namespace dataframe {
Dataframe::Dataframe(Dataframe::AlgebraTree &query) {
    BinaryenModuleRef module = BinaryenModuleCreate();

    // Create a function type for  i32 (i32, i32)
    BinaryenType ii[2] = {BinaryenTypeInt32(), BinaryenTypeInt32()};
    BinaryenType params = BinaryenTypeCreate(ii, 2);
    BinaryenType results = BinaryenTypeInt32();

    // Get the 0 and 1 arguments, and add them
    BinaryenExpressionRef x = BinaryenLocalGet(module, 0, BinaryenTypeInt32()),
                          y = BinaryenLocalGet(module, 1, BinaryenTypeInt32());
    BinaryenExpressionRef add = BinaryenBinary(module, BinaryenAddInt32(), x, y);

    // Create the add function
    // Note: no additional local variables
    // Note: no basic blocks here, we are an AST. The function body is just an
    // expression node.
    BinaryenFunctionRef adder = BinaryenAddFunction(module, "adder", params, results, NULL, 0, add);

    auto result = BinaryenModuleAllocateAndWrite(module, nullptr);
    this->module = {static_cast<char *>(result.binary), static_cast<char *>(result.binary) + result.binaryBytes};
}
}  // namespace dataframe
}  // namespace dashql
