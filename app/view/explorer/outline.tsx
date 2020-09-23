import * as React from 'react';
import { connect } from 'react-redux';
import * as proto from '@dashql/proto';
import { RootState } from '../../store';
import { withAppContext, IAppContext } from '../../app_context';
import Section from './section';
import OutlineSubsection from './outline_subsection';
import SectionEntry from './section_entry';

type Props = {
    appContext: IAppContext;
} & ReturnType<typeof mapStateToProps>;

type State = {
    title: string;
    indices: number[];
    previousSectionIndex: number | undefined;
    template: string;
    children?: React.ReactNodeArray;
};

class Outline extends React.Component<Props, State> {
    getSectionIndex = (previous?: number, current?: number) => {
        if (previous !== undefined && current !== undefined) {
            return Math.max(previous, current);
        } else if (previous !== undefined) {
            return previous;
        } else if (current !== undefined) {
            return current;
        } else {
            return undefined;
        }
    };

    render() {
        const statements = this.props.module.getStatementsList();

        const parameters: number[] = [];
        let lastParameter: number | undefined;

        const loads: number[] = [];
        let lastLoad: number | undefined;

        const extracts: number[] = [];
        let lastExtract: number | undefined;

        const queries: number[] = [];
        let lastQuery: number | undefined;

        const visualizations: number[] = [];
        let lastViz: number | undefined;

        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];

            switch (statement.getStatementCase()) {
                case proto.tql.Statement.StatementCase.PARAMETER:
                    parameters.push(i);
                    lastParameter = i;
                    break;
                case proto.tql.Statement.StatementCase.LOAD:
                    loads.push(i);
                    lastLoad = i;
                    break;
                case proto.tql.Statement.StatementCase.EXTRACT:
                    extracts.push(i);
                    lastExtract = i;
                    break;
                case proto.tql.Statement.StatementCase.QUERY:
                    queries.push(i);
                    lastQuery = i;
                    break;
                case proto.tql.Statement.StatementCase.VIZ:
                    visualizations.push(i);
                    lastViz = i;
                    break;
                default:
                    break;
            }
        }

        lastLoad = this.getSectionIndex(lastParameter, lastLoad);
        lastExtract = this.getSectionIndex(lastLoad, lastExtract);
        lastQuery = this.getSectionIndex(lastExtract, lastQuery);
        lastViz = this.getSectionIndex(lastQuery, lastViz);

        return (
            <Section title="Dashboard Program">
                <OutlineSubsection
                    title="Parameters"
                    indices={parameters}
                    previousSectionIndex={undefined}
                    template={`DECLARE PARAMETER <name> AS INTEGER;`}
                >
                    {parameters.map((i: number) => (
                        <SectionEntry key={i} index={i} />
                    ))}
                </OutlineSubsection>
                <OutlineSubsection
                    title="Load Statements"
                    indices={loads}
                    previousSectionIndex={lastParameter}
                    template={`LOAD <name> FROM http (
    url = 'https://example.com',
    method = GET
);`}
                >
                    {loads.map((i: number) => (
                        <SectionEntry key={i} index={i} />
                    ))}
                </OutlineSubsection>
                <OutlineSubsection
                    title="Extract Statements"
                    indices={extracts}
                    previousSectionIndex={lastLoad}
                    template={`EXTRACT <name> FROM <name> USING json ();`}
                >
                    {extracts.map((i: number) => (
                        <SectionEntry key={i} index={i} />
                    ))}
                </OutlineSubsection>
                <OutlineSubsection
                    title="Query Statements"
                    indices={queries}
                    previousSectionIndex={lastExtract}
                    template={`QUERY <name> AS SELECT * FROM 1;`}
                >
                    {queries.map((i: number) => (
                        <SectionEntry key={i} index={i} />
                    ))}
                </OutlineSubsection>
                <OutlineSubsection
                    title="Visualizations"
                    indices={visualizations}
                    previousSectionIndex={lastQuery}
                    template={`VIZ <name> FROM <name> USING TABLE;`}
                >
                    {visualizations.map((i: number) => (
                        <SectionEntry key={i} index={i} />
                    ))}
                </OutlineSubsection>
            </Section>
        );
    }
}

const mapStateToProps = (state: RootState) => ({
    module: state.tqlModule,
});

export default connect(mapStateToProps)(withAppContext(Outline));
