declare module "pg" {
    export interface QueryResult<T = any> {
      rowCount?: number;
      rows: T[];
    }
  
    export class Pool {
      constructor(opts: { connectionString: string });
      query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
    }
}