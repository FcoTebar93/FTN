declare module "pg" {
  export interface QueryResult<T = unknown> {
    rowCount?: number;
    rows: T[];
  }

  export interface PoolClient {
    query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
    release(): void;
  }

  export class Pool {
    constructor(opts: { connectionString: string; max?: number });
    query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
