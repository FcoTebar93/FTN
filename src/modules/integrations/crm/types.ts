export interface UpsertUserInput {
    userId?: string;
    email: string;
    name?: string;
    planName?: string;
    metadata?: Record<string, unknown>;
}
  
export interface UpsertUserResult {
    userId: string;
}