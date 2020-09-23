import * as proto from '@dashql/proto';
import * as Store from '../store';
import { LogController } from './log';
import { CoreController } from './core';
import { CacheController } from './cache';
import { TaskID, Task, TaskQueue } from './task_queue';
import { Argument, setTQLQueryResult } from '../store';

export class TQLInterpreter {
    protected store: Store.ReduxStore;
    protected log: LogController;
    protected core: CoreController;
    protected cache: CacheController;

    protected queuedTasks: TaskQueue;
    protected activeTasks: Array<Task>;
    protected requiredFor: Map<TaskID, Array<TaskID>>;

    // Constructor
    constructor(
        store: Store.ReduxStore,
        core: CoreController,
        log: LogController,
        cache: CacheController,
    ) {
        this.store = store;
        this.log = log;
        this.core = core;
        this.cache = cache;
        this.queuedTasks = new TaskQueue();
        this.activeTasks = [];
        this.requiredFor = new Map();
    }

    // Evaluate a program
    public async eval(module: proto.tql.Module) {
        const session = await this.core.createSession();

        const state = this.store.getState();

        const parameters: {
            [key: string]: Argument['value'] | null | undefined;
        } = {};

        const loads: {
            [key: string]: Blob | undefined;
        } = {};

        for (const statement of module.getStatementsList()) {
            switch (statement.getStatementCase()) {
                case proto.tql.Statement.StatementCase.PARAMETER: {
                    const parameter = statement.getParameter();

                    if (!parameter) {
                        continue;
                    }

                    const name = parameter.getName()?.getString() ?? '';

                    parameters[name] = null;

                    break;
                }
                case proto.tql.Statement.StatementCase.LOAD: {
                    const load = statement.getLoad();

                    if (!load) {
                        continue;
                    }

                    const destination = load.getName()?.getString()?.toString();

                    if (!destination) {
                        continue;
                    }

                    const methodCase = load.getMethodCase();

                    switch (methodCase) {
                        case proto.tql.LoadStatement.MethodCase.FILE: {
                            const file = load.getFile();

                            if (!file) {
                                continue;
                            }

                            const variable = file
                                .getVariable()
                                ?.getName()
                                ?.getString();

                            if (!variable) {
                                continue;
                            }

                            const value = state.tqlArguments.get(variable)
                                ?.value;

                            if (!(value instanceof File)) {
                                continue;
                            }

                            loads[destination] = value;

                            break;
                        }
                        default: {
                            throw `Load method ${methodCase} not implemented!`;
                        }
                    }

                    break;
                }
                case proto.tql.Statement.StatementCase.EXTRACT: {
                    const extract = statement.getExtract();

                    if (!extract) {
                        continue;
                    }

                    const source = extract
                        .getDataName()
                        ?.getString()
                        .toString();

                    if (!source) {
                        continue;
                    }

                    const destination = extract
                        .getName()
                        ?.getString()
                        .toString();

                    if (!destination) {
                        continue;
                    }

                    switch (extract.getMethodCase()) {
                        case proto.tql.ExtractStatement.MethodCase
                            .METHOD_NOT_SET: {
                            continue;
                        }
                        case proto.tql.ExtractStatement.MethodCase.CSV: {
                            const blob = loads[source];

                            if (!blob) {
                                continue;
                            }

                            const tempPath = '/tmp';
                            const tempFileName = `${source}.csv`;
                            const tempFilePath = `${tempPath}/${tempFileName}`;

                            const buffer = new Uint8Array(
                                await blob.arrayBuffer(),
                            );

                            try {
                                FS.unlink(tempFilePath);
                            } catch {}

                            FS.writeFile(tempFilePath, buffer);

                            await this.core.runQuery(
                                session,
                                `DROP TABLE IF EXISTS ${destination};`,
                            );

                            await this.core.runQuery(
                                session,
                                `CREATE TABLE ${destination} AS SELECT * FROM read_csv_auto('${tempFilePath}');`,
                            );

                            const result = await this.core.runQuery(
                                session,
                                `SELECT * FROM ${destination};`,
                            );

                            this.store.dispatch(
                                setTQLQueryResult(destination, result),
                            );

                            break;
                        }
                        case proto.tql.ExtractStatement.MethodCase.JSON: {
                            throw 'JSON extract method not implemented!';
                        }
                    }

                    break;
                }
                case proto.tql.Statement.StatementCase.QUERY: {
                    const query = statement.getQuery();

                    if (!query) {
                        continue;
                    }

                    const destination = query.getName()?.getString();

                    const text = query.getQueryText()?.getString();

                    if (!text) {
                        continue;
                    }

                    if (destination) {
                        await this.core.runQuery(
                            session,
                            `DROP TABLE IF EXISTS ${destination};`,
                        );

                        await this.core.runQuery(
                            session,
                            `CREATE TABLE ${destination} AS ${text};`,
                        );

                        const result = await this.core.runQuery(
                            session,
                            `SELECT * FROM ${destination};`,
                        );

                        this.store.dispatch(
                            setTQLQueryResult(destination, result),
                        );
                    } else {
                        await this.core.runQuery(session, text);
                    }

                    break;
                }
                case proto.tql.Statement.StatementCase.VIZ: {
                    break;
                }
            }
        }
    }
}

export default TQLInterpreter;
