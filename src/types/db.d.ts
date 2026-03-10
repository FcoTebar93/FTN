declare module "stripe" {
    type StripeConstructorOptions = { apiVersion?: string };
  
    export default class Stripe {
      constructor(secretKey: string, opts?: StripeConstructorOptions);
  
      checkout: {
        sessions: {
          create(input: {
            mode: "payment";
            success_url: string;
            cancel_url: string;
            customer_email?: string;
            currency: string;
            line_items: Array<{
              quantity: number;
              price_data: {
                currency: string;
                unit_amount: number;
                product_data: { name: string };
              };
            }>;
            metadata?: Record<string, string>;
          }): Promise<{ id: string; url?: string; metadata?: Record<string, string> }>;
        };
      };
  
      webhooks: {
        constructEvent(
          payload: string | Buffer,
          signatureHeader: string,
          secret: string
        ): { type: string; data: { object: any } };
      };
    }
}