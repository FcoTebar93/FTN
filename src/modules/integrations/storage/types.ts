export interface DbExecuteInput {
    sql: string;
    params?: unknown[];
}

export interface DbExecuteResult {
    rowCount: number;
    rows: unknown[];
}

export interface PutKeyValueInput {
    namespace: string;
    key: string;
    value: unknown;
}
  
export interface PutKeyValueResult {
    ok: true;
}
  
export interface GetKeyValueInput {
    namespace: string;
    key: string;
}
  
export interface GetKeyValueResult {
    found: boolean;
    value?: unknown;
}