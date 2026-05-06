import { useEffect, useState } from "preact/hooks";
import { authHeaders } from "./config";
import { useUiText } from "./i18n";

type PaymentModalProps = {
  backendBaseUrl: string;
};

type CheckoutResponse = {
  sessionId: string;
  url: string;
};

type Status = "idle" | "loading" | "error";

export function PaymentModal({ backendBaseUrl }: PaymentModalProps) {
  const { t } = useUiText();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const workflowId = url.searchParams.get("workflowId");
    const runId = url.searchParams.get("runId");
    const email = url.searchParams.get("email") ?? undefined;
    const planName = url.searchParams.get("planName") ?? "Plan";
    const priceCents = Number(url.searchParams.get("priceCents") ?? "0");

    if (!workflowId || !runId || !email || !priceCents) {
      setStatus("error");
      setError(t.payment.missingParams);
      return;
    }

    const createCheckout = async () => {
      setStatus("loading");
      try {
        const res = await fetch(`${backendBaseUrl}/pay/checkout`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            successUrl: `${window.location.origin}/pago-ok`,
            cancelUrl: `${window.location.origin}/pago-cancelado`,
            customerEmail: email,
            currency: "eur",
            lineItems: [
              { name: planName, unitAmountCents: priceCents, quantity: 1 },
            ],
            metadata: {
              workflowId,
              runId,
            },
          }),
        });

        if (!res.ok) {
          throw new Error(`Error HTTP ${res.status}`);
        }

        const data: CheckoutResponse = await res.json();
        if (!data.url) {
          throw new Error(t.payment.missingUrl);
        }

        window.location.href = data.url;
      } catch (e) {
        setStatus("error");
        setError((e as Error).message);
      }
    };

    void createCheckout();
  }, [backendBaseUrl]);

  return (
    <div className="payment-modal-backdrop">
      <div className="payment-modal">
        {status === "loading" && (
          <>
            <h2>{t.payment.processingTitle}</h2>
            <p>{t.payment.processingBody}</p>
          </>
        )}
        {status === "error" && (
          <>
            <h2>{t.payment.errorTitle}</h2>
            <p>{error ?? t.payment.cannotStart}</p>
            <button onClick={() => window.location.reload()}>{t.payment.retry}</button>
          </>
        )}
      </div>
    </div>
  );
}