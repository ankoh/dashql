// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/program_editor.h"

#include <sstream>

#include "dashql/analyzer/program_instance.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/parser/scanner.h"
#include "dashql/proto_generated.h"
#include "flatbuffers/flatbuffers.h"
#include "gtest/gtest.h"

using namespace std;
using namespace dashql;

namespace {

template <typename FB>
std::pair<const FB*, flatbuffers::DetachedBuffer> Pack(std::unique_ptr<typename FB::NativeTableType> fbo) {
    flatbuffers::FlatBufferBuilder fbb;
    flatbuffers::Offset<FB> ofs = FB::Pack(fbb, fbo.get());
    fbb.Finish(ofs);
    auto buffer = fbb.Release();
    return {flatbuffers::GetRoot<FB>(buffer.data()), move(buffer)};
}

TEST(ProgramEditorTest, InputStatementAddPosition) {
    auto txt = "INPUT weather_avg TYPE INTEGER USING TEXT";
    ProgramInstance instance{txt, move(parser::ParserDriver::Parse(txt))};
    ASSERT_EQ(instance.program().statements.size(), 1);

    ProgramEditor editor{instance};
    std::pair<const proto::edit::ProgramEdit*, flatbuffers::DetachedBuffer> edit;
    {
        auto e = std::make_unique<proto::edit::EditOperationT>();
        proto::edit::CardPositionUpdateT changePos;
        changePos.position = std::make_unique<proto::analyzer::CardPosition>(1, 2, 3, 4);
        e->statement_id = 0;
        e->variant.Set(move(changePos));
        auto pe = std::make_unique<proto::edit::ProgramEditT>();
        pe->edits.push_back(move(e));
        edit = Pack<proto::edit::ProgramEdit>(move(pe));
    }

    auto expected =
        R"RAW(INPUT weather_avg TYPE INTEGER USING TEXT (
    position = (
        row = 1,
        column = 2,
        width = 3,
        height = 4
    )
))RAW";
    EXPECT_EQ(editor.Apply(*std::get<0>(edit)), expected);
}

TEST(ProgramEditorTest, VizStatementAddPosition) {
    auto txt = "VIZ weather_avg USING LINE";
    ProgramInstance instance{txt, move(parser::ParserDriver::Parse(txt))};
    ASSERT_EQ(instance.program().statements.size(), 1);

    ProgramEditor editor{instance};
    std::pair<const proto::edit::ProgramEdit*, flatbuffers::DetachedBuffer> edit;
    {
        auto e = std::make_unique<proto::edit::EditOperationT>();
        proto::edit::CardPositionUpdateT changePos;
        changePos.position = std::make_unique<proto::analyzer::CardPosition>(1, 2, 3, 4);
        e->statement_id = 0;
        e->variant.Set(move(changePos));
        auto pe = std::make_unique<proto::edit::ProgramEditT>();
        pe->edits.push_back(move(e));
        edit = Pack<proto::edit::ProgramEdit>(move(pe));
    }

    auto expected =
        R"RAW(VIZ weather_avg USING LINE (
    position = (
        row = 1,
        column = 2,
        width = 3,
        height = 4
    )
))RAW";
    EXPECT_EQ(editor.Apply(*std::get<0>(edit)), expected);
}

TEST(ProgramEditorTest, VizStatementUpdatePosition) {
    auto txt =
        "VIZ weather_avg USING LINE (\n    position = (row = 1, column = 2, width = 3, height = 4),\n    title = "
        "'sometitle'\n)";
    ProgramInstance instance{txt, move(parser::ParserDriver::Parse(txt))};
    ASSERT_EQ(instance.program().statements.size(), 1);

    ProgramEditor editor{instance};
    std::pair<const proto::edit::ProgramEdit*, flatbuffers::DetachedBuffer> edit;
    {
        auto e = std::make_unique<proto::edit::EditOperationT>();
        proto::edit::CardPositionUpdateT changePos;
        changePos.position = std::make_unique<proto::analyzer::CardPosition>(6, 5, 4, 3);
        e->statement_id = 0;
        e->variant.Set(move(changePos));
        auto pe = std::make_unique<proto::edit::ProgramEditT>();
        pe->edits.push_back(move(e));
        edit = Pack<proto::edit::ProgramEdit>(move(pe));
    }

    auto expected =
        R"RAW(VIZ weather_avg USING LINE (
    position = (
        row = 6,
        column = 5,
        width = 4,
        height = 3
    ),
    title = 'sometitle'
))RAW";
    EXPECT_EQ(editor.Apply(*std::get<0>(edit)), expected);
}

TEST(ProgramEditorTest, UpdateMultiplePosition) {
    auto txt = R"RAW(
INPUT country TYPE VARCHAR USING TEXT (
    title = 'Country',
    position = (row = 0, column = 0, width = 3, height = 1)
);

CREATE VIEW foo AS
    SELECT
        v::INTEGER AS x,
        (sin(v / 50000.0) * 100 + 100)::INTEGER AS y,
        (random() * 10)::INTEGER as cat10,
        (random() * 100)::INTEGER as cat100
    FROM generate_series(0, 1000000) AS a(v);

VIZ foo USING (
    title = 'Line Chart',
    position = (row = 1, column = 0, width = 6, height = 4),
    mark = 'line',
    encoding = (
        x = (field = 'x', type = 'quantitative'),
        y = (field = 'y', type = 'quantitative')
    )
);

VIZ foo USING AREA (
    position = (row = 1, column = 6, width = 6, height = 4),
    title = 'Area Chart'
);
    )RAW";
    ProgramInstance instance{txt, move(parser::ParserDriver::Parse(txt))};
    ASSERT_EQ(instance.program().statements.size(), 4);

    ProgramEditor editor{instance};
    std::pair<const proto::edit::ProgramEdit*, flatbuffers::DetachedBuffer> edit;
    {
        auto e0 = std::make_unique<proto::edit::EditOperationT>();
        proto::edit::CardPositionUpdateT change0;
        change0.position = std::make_unique<proto::analyzer::CardPosition>(6, 5, 4, 3);
        e0->statement_id = 0;
        e0->variant.Set(move(change0));

        auto e1 = std::make_unique<proto::edit::EditOperationT>();
        proto::edit::CardPositionUpdateT change1;
        change1.position = std::make_unique<proto::analyzer::CardPosition>(9, 8, 7, 6);
        e1->statement_id = 2;
        e1->variant.Set(move(change1));

        auto e2 = std::make_unique<proto::edit::EditOperationT>();
        proto::edit::CardPositionUpdateT change2;
        change2.position = std::make_unique<proto::analyzer::CardPosition>(13, 12, 11, 10);
        e2->statement_id = 3;
        e2->variant.Set(move(change2));

        auto pe = std::make_unique<proto::edit::ProgramEditT>();
        pe->edits.push_back(move(e0));
        pe->edits.push_back(move(e1));
        pe->edits.push_back(move(e2));
        edit = Pack<proto::edit::ProgramEdit>(move(pe));
    }

    auto expected = R"RAW(
INPUT country TYPE VARCHAR USING TEXT (
    position = (
        row = 6,
        column = 5,
        width = 4,
        height = 3
    ),
    title = 'Country'
);

CREATE VIEW foo AS
    SELECT
        v::INTEGER AS x,
        (sin(v / 50000.0) * 100 + 100)::INTEGER AS y,
        (random() * 10)::INTEGER as cat10,
        (random() * 100)::INTEGER as cat100
    FROM generate_series(0, 1000000) AS a(v);

VIZ foo USING (
    position = (
        row = 9,
        column = 8,
        width = 7,
        height = 6
    ),
    title = 'Line Chart',
    encoding = (
        x = (
            field = 'x',
            type = 'quantitative'
        ),
        y = (
            field = 'y',
            type = 'quantitative'
        )
    ),
    mark = 'line'
);

VIZ foo USING AREA (
    position = (
        row = 13,
        column = 12,
        width = 11,
        height = 10
    ),
    title = 'Area Chart'
);
    )RAW";
    EXPECT_EQ(editor.Apply(*std::get<0>(edit)), expected);
}

}  // namespace
