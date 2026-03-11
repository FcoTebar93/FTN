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

export interface VerifyIdentityInput {
    userId: string;
    documentType: string;
    documentImageUrl: string;
}
  
export interface VerifyIdentityResult {
    verified: boolean;
    score: number;
    provider: string;
}
  
export interface CheckFraudScoreInput {
    userId: string;
    orderId: string;
    amountCents: number;
    currency: string;
    ipAddress?: string;
    deviceId?: string;
}
  
export interface CheckFraudScoreResult {
    score: number;
    riskLevel: "low" | "medium" | "high";
}
