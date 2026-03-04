let chargeAttempts = 0;

export type ActivityFn<TInput = unknown, TResult = unknown> = (input: TInput) => Promise<TResult> | TResult;

export interface ActivityRegistry {
    getActivity(name: string): ActivityFn | undefined;
}

export class InMemoryActivityRegistry implements ActivityRegistry {
    private readonly activities = new Map<string, ActivityFn>();

    register<TInput, TResult>(name: string, activity: ActivityFn<TInput, TResult>): void {
        this.activities.set(name, activity as ActivityFn<unknown, unknown>);
    }

    getActivity(name: string): ActivityFn | undefined {
        return this.activities.get(name);
    }
}

export const validateOrderActivity: ActivityFn<{orderId: string;userId: string;amount: number;}, void> = async (input) => {
    console.log("[activity] validate-order", input);
};

export const chargePaymentActivity: ActivityFn<{orderId: string;amount: number;}, void> = async (input) => {
  chargeAttempts += 1;
  console.log("[activity] charge-payment attempt", chargeAttempts, input);

  if (chargeAttempts < 2) {
    throw new Error("Simulated payment gateway failure");
  }
};

export const createShipmentActivity: ActivityFn<{orderId: string; userId: string;}, void> = async (input) => {
    console.log("[activity] create-shipment", input);
};