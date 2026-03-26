declare module "pg" {
  export interface QueryResult<T = any> {
    rowCount?: number;
    rows: T[];
  }

  export interface PoolClient {
    query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    release(): void;
  }

  export class Pool {
    constructor(opts: { connectionString: string; max?: number });
    query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
