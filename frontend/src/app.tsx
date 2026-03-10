import { WorkflowsPage } from "./features/workflows/WorkflowsPage";
import { PaymentModal } from "./PaymentModal";

export function App(){
  const backendBaseUrl = "http://localhost:4000";
  
  const url = new URL(window.location.href);
  const path = url.pathname;
  
  if (path === "/pagar") {
    return <PaymentModal backendBaseUrl={backendBaseUrl} />;
  }

  return (
    <div className="app">
      <WorkflowsPage />
    </div>
  );
}