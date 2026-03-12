import { WorkflowsPage } from "./features/workflows/WorkflowsPage";
import { PaymentModal } from "./PaymentModal";
import { DesignerPage } from "./features/designer/DesignerPage";

export function App() {
  const backendBaseUrl = "http://localhost:4000";

  const url = new URL(window.location.href);
  const path = url.pathname;

  if (path === "/pagar") {
    return <PaymentModal backendBaseUrl={backendBaseUrl} />;
  }

  if (path.startsWith("/designer")) {
    return (
      <div className="app">
        <DesignerPage />
      </div>
    );
  }

  return (
    <div className="app">
      <WorkflowsPage />
    </div>
  );
}