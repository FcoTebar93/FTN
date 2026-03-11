export interface DbExecuteInput {
    sql: string;
    params?: unknown[];
}

export interface DbExecuteResult {
    rowCount: number;
    rows: unknown[];
}