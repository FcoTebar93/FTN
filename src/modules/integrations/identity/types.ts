export interface VerifyIdentityInput {
    userId: string;
    documentType: string;
    documentImageUrl: string;
}

export interface VerifyIdentityResult {
    success: boolean;
    score: number;
    provider: string;
}
