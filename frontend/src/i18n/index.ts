import { useEffect, useState } from "preact/hooks";

export type Locale = "es" | "en";

const STORAGE_KEY = "ftn_locale";

export function getStoredLocale(): Locale {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "en" ? "en" : "es";
  } catch {
    return "es";
  }
}

export function setStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent("ftn:locale", { detail: { locale } }));
  } catch {
    // ignore
  }
}

export function useLocale(): [Locale, (next: Locale | ((curr: Locale) => Locale)) => void] {
  const [locale, setLocale] = useState<Locale>(() => (typeof window !== "undefined" ? getStoredLocale() : "es"));

  useEffect(() => {
    const onCustom = (e: Event) => {
      const ce = e as CustomEvent<{ locale?: Locale }>;
      const next = ce.detail?.locale;
      if (next === "en" || next === "es") setLocale(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLocale(getStoredLocale());
    };
    window.addEventListener("ftn:locale", onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ftn:locale", onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setAndStore = (next: Locale | ((curr: Locale) => Locale)) => {
    setLocale((curr) => {
      const resolved = typeof next === "function" ? (next as (c: Locale) => Locale)(curr) : next;
      setStoredLocale(resolved);
      return resolved;
    });
  };

  return [locale, setAndStore];
}

export const uiText = {
  es: {
    common: {
      back: "Volver",
      loading: "Cargando…",
      redirecting: "Redirigiendo…",
    },
    app: {
      authStatusFailed: "No se pudo comprobar /auth/status:",
      registrationDisabled: "El registro no está habilitado en este entorno.",
      protectedNotFound: "No existe o no tienes permisos para acceder a este recurso protegido.",
    },
    nav: {
      runs: "Runs",
      catalog: "Ejecutar workflow",
      designer: "Crear workflow",
      credentials: "Credenciales",
      logout: "Cerrar sesión",
    },
    auth: {
      signIn: "Iniciar sesion",
      signInToContinue: "Inicia sesión para continuar",
      username: "Usuario",
      password: "Contraseña",
      enter: "Entrar",
      entering: "Entrando…",
      createAccount: "Crear cuenta",
      register: "Registrarse",
      creatingAccount: "Creando cuenta…",
      registerSubtitle: "Registro en FTN",
      confirmPassword: "Confirmar contraseña",
      backToLogin: "Volver al inicio de sesión",
      badCredentials: "Usuario o contraseña incorrectos.",
      loginFailed: "No se pudo iniciar sesión.",
      passwordsNoMatch: "Las contraseñas no coinciden.",
      usernameTaken: "Ese nombre de usuario ya está en uso.",
      invalidUserOrPass:
        "Revisa el usuario (3–64 caracteres, letras, números, _, ., -) y la contraseña (mínimo 10 caracteres).",
      registerFailed: "No se pudo completar el registro.",
    },
    errors: {
      notFoundTitle: "404 — Recurso no disponible",
      notFoundDesc: "No existe o no tienes permisos para acceder a esta ruta.",
      backHome: "Volver al inicio",
    },
    payment: {
      missingParams: "Faltan parámetros en la URL para iniciar el pago.",
      processingTitle: "Procesando tu pago…",
      processingBody: "Te redirigiremos a la pasarela en unos segundos.",
      errorTitle: "Ha ocurrido un error",
      cannotStart: "No se ha podido iniciar el pago.",
      retry: "Reintentar",
      missingUrl: "La respuesta no contiene una URL de pago.",
    },
    workflows: {
      title: "Workflows",
      loadingList: "Cargando workflows…",
      loadingDetail: "Cargando detalle…",
      selectOne: "Selecciona un workflow para ver el detalle.",
      stateNotFound: "No se ha encontrado el estado.",
      filterAll: "Todos",
      searchPlaceholder: "Buscar por nombre, id…",
      emptyWithStatus: (status: string) => `No hay workflows con estado "${status}".`,
      empty: "No hay workflows aún.",
      noneMatchSearch: "Ningún workflow coincide con la búsqueda.",
      noDate: "sin fecha",
      signals: "señales",
      retries: "retries",
      refresh: "Refrescar",
      cancelRun: "Cancelar run",
      cancelling: "Cancelando…",
      cancelPrompt: "Motivo de cancelación (opcional):",
      exportJson: "Exportar JSON",
      started: "Comenzado",
      completed: "Completado",
      failed: "Falló",
      reason: "Razón",
      cancelled: "Cancelado",
      cancelReason: "Motivo cancelación",
      requestedBy: "Solicitado por",
      liveEvery: "Actualizando cada 4 s",
      tabState: "Estado",
      tabEvents: "Eventos",
      tabSteps: "Steps",
      summary: "Resumen",
      version: "Versión",
      diagnostics: "Diagnóstico",
      lastEvent: "Último evento",
      pendingActivities: "Actividades pendientes",
      noPendingActivities: "No hay actividades pendientes en este momento.",
      completedActivities: "Actividades completadas",
      noCompletedActivities: "Todavía no se ha completado ninguna actividad.",
      pendingTimers: "Timers pendientes",
      noPendingTimers: "No hay timers programados.",
      wakeAt: "Despierta",
      hideJson: "Ocultar JSON",
      showJson: "Ver JSON completo",
      eventsTitle: "Eventos",
      noEventsYet:
        "Aún no se han registrado eventos para este run. Cuando el workflow avance, los verás aquí en orden cronológico.",
      stepsTitle: "Steps",
      noStepsYet: "Este workflow todavía no ha creado ningún step registrado en el motor.",
    },
    catalog: {
      title: "Ejecutar workflow",
      chooseOne: "Elige un workflow, rellena el input JSON y lánzalo.",
      inputInvalid: "Input JSON inválido",
      signalDataInvalid: "Signal data JSON inválido",
      signalNameRequired: "Indica signalName",
      inputJsonTitle: "Input (JSON)",
      inputJsonHelp: "Debe cumplir el inputSchema del servidor. Usa un ejemplo si existe.",
      loadExample: (n: number) => `Cargar ejemplo ${n}`,
      launch: "Lanzar workflow",
      launching: "Lanzando...",
      statePolling: "Estado (polling 2s)",
      loadingState: "Cargando estado…",
      sendSignal: "Enviar señal",
      pendingSignals: "Pendientes",
      send: "Enviar señal",
    },
    credentials: {
      title: "Credenciales de integraciones",
      subtitle: "Guarda configuración y secretos cifrados para Stripe, CRM, Twilio y KYC.",
      providers: "Providers",
      loading: "Cargando...",
      lastUpdated: "Última actualización",
      never: "nunca",
      missingRequired: (n: number) => `Faltan ${n} campo(s) obligatorio(s) para completar este provider.`,
      validation: "Validación",
      incompleteConfig: "Configuración incompleta",
      expectedSource: "Source esperado (borrador)",
      pendingRequired: "Pendiente (obligatorio)",
      optional: "Opcional",
      ok: "Correcto",
      jsonInvalidPrefix: "JSON inválido:",
      hasFormErrors: "Hay errores en el formulario. Revísalos antes de guardar.",
      saved: "Credenciales guardadas.",
      saveErrorPrefix: "Error al guardar:",
      show: "Mostrar",
      hide: "Ocultar",
      noGuidedForm: "Este provider no tiene formulario guiado aún. Puedes usar modo avanzado JSON.",
      advancedMode: "Modo avanzado (JSON)",
      configJson: "Config (JSON)",
      secretsJson: "Secrets (JSON cifrado en backend)",
      reload: "Recargar",
      save: "Guardar",
      saving: "Guardando...",
    },
    providerSchemas: {
      requiredField: "Campo obligatorio.",
    },
    designerConstants: {
      weekdays: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
    },
    designer: {
      title: "Crear workflow",
      loadingActivities: "Cargando catálogo de activities…",
      integrationsStatus: "Estado de integraciones",
      integrationsStatusLoadFailed: "No se pudo cargar estado:",
      integrationsStatusEmpty: "Sin datos de estado.",
      missing: "Falta",
      newWorkflow: "+ Crear workflow",
      templates: "Plantillas",
      createFromTemplate: "(crear desde plantilla…)",
      templateRequires: (label: string, missing: string) =>
        `La plantilla "${label}" requiere activities no registradas: ${missing}`,
      templatesRequireRegistered:
        "Una plantilla solo se aplica si sus activities requeridas están registradas en este entorno.",
      templateRunContextHint:
        "En inputs de steps puedes usar {{ run.workflowId }} y {{ run.runId }} (equivalente a ftn.workflowId() / ftn.runId()) para URLs de retorno o enlaces a /pagar.",
      loading: "Cargando…",
      noWorkflowsYet: "No hay workflows definidos aún.",
      lastRun: "Última ejecución:",
      lastError: "Último error:",
      editWorkflow: "Editar workflow",
      errorPrefix: "Error:",
      meta: "Meta",
      execution: "Ejecución",
      steps: "Steps",
      addStep: "+ Añadir step",
      needAtLeastOneStep: "Añade al menos un step para este workflow.",
      delete: "Eliminar",
      jsonInvalid: "JSON inválido",
      inputJsonInvalid: "JSON de input inválido",
      starting: "Iniciando…",
      runTest: "Ejecutar prueba (run)",
      saveWorkflow: "Guardar workflow",
      cancel: "Cancelar",
      chooseLeft:
        "Elige un workflow a la izquierda o crea uno nuevo para editar su definición JSON.",
      instant: "Instantánea (al crear)",
      weeklyConcrete: "Semanal (días concretos)",
      usedForInstantAndScheduled:
        "Se usa en la ejecución instantánea al crear y en cada run programado.",
      payloadPreview: "Payload que se enviará al guardar (revisión rápida).",
    },
  },
  en: {
    common: {
      back: "Back",
      loading: "Loading…",
      redirecting: "Redirecting…",
    },
    app: {
      authStatusFailed: "Could not check /auth/status:",
      registrationDisabled: "Registration is not enabled in this environment.",
      protectedNotFound: "This resource does not exist or you don’t have permission to access it.",
    },
    nav: {
      runs: "Runs",
      catalog: "Run workflow",
      designer: "Create workflow",
      credentials: "Credentials",
      logout: "Sign out",
    },
    auth: {
      signIn: "Sign in",
      signInToContinue: "Sign in to continue",
      username: "Username",
      password: "Password",
      enter: "Sign in",
      entering: "Signing in…",
      createAccount: "Create account",
      register: "Sign up",
      creatingAccount: "Creating account…",
      registerSubtitle: "Register to FTN",
      confirmPassword: "Confirm password",
      backToLogin: "Back to sign in",
      badCredentials: "Invalid username or password.",
      loginFailed: "Could not sign in.",
      passwordsNoMatch: "Passwords do not match.",
      usernameTaken: "That username is already taken.",
      invalidUserOrPass:
        "Check the username (3–64 characters, letters, numbers, _, ., -) and the password (min 10 characters).",
      registerFailed: "Could not complete registration.",
    },
    errors: {
      notFoundTitle: "404 — Resource unavailable",
      notFoundDesc: "This page does not exist or you don’t have permission to access it.",
      backHome: "Back to home",
    },
    payment: {
      missingParams: "Missing URL parameters to start the payment.",
      processingTitle: "Processing your payment…",
      processingBody: "We’ll redirect you to the payment gateway in a few seconds.",
      errorTitle: "Something went wrong",
      cannotStart: "Could not start the payment.",
      retry: "Retry",
      missingUrl: "The response does not include a payment URL.",
    },
    workflows: {
      title: "Workflows",
      loadingList: "Loading workflows…",
      loadingDetail: "Loading details…",
      selectOne: "Select a workflow to see details.",
      stateNotFound: "State not found.",
      filterAll: "All",
      searchPlaceholder: "Search by name, id…",
      emptyWithStatus: (status: string) => `No workflows with status "${status}".`,
      empty: "No workflows yet.",
      noneMatchSearch: "No workflow matches your search.",
      noDate: "no date",
      signals: "signals",
      retries: "retries",
      refresh: "Refresh",
      cancelRun: "Cancel run",
      cancelling: "Cancelling…",
      cancelPrompt: "Cancellation reason (optional):",
      exportJson: "Export JSON",
      started: "Started",
      completed: "Completed",
      failed: "Failed",
      reason: "Reason",
      cancelled: "Cancelled",
      cancelReason: "Cancellation reason",
      requestedBy: "Requested by",
      liveEvery: "Refreshing every 4 s",
      tabState: "State",
      tabEvents: "Events",
      tabSteps: "Steps",
      summary: "Summary",
      version: "Version",
      diagnostics: "Diagnostics",
      lastEvent: "Last event",
      pendingActivities: "Pending activities",
      noPendingActivities: "No pending activities right now.",
      completedActivities: "Completed activities",
      noCompletedActivities: "No activity has completed yet.",
      pendingTimers: "Pending timers",
      noPendingTimers: "No timers scheduled.",
      wakeAt: "Wake at",
      hideJson: "Hide JSON",
      showJson: "Show full JSON",
      eventsTitle: "Events",
      noEventsYet: "No events have been recorded for this run yet. As the workflow progresses, you’ll see them here.",
      stepsTitle: "Steps",
      noStepsYet: "This workflow hasn’t created any step records yet.",
    },
    catalog: {
      title: "Run workflow",
      chooseOne: "Choose a workflow, fill in the JSON input, and launch it.",
      inputInvalid: "Invalid input JSON",
      signalDataInvalid: "Invalid signal data JSON",
      signalNameRequired: "Provide signalName",
      inputJsonTitle: "Input (JSON)",
      inputJsonHelp: "Must satisfy the server inputSchema. Use an example if available.",
      loadExample: (n: number) => `Load example ${n}`,
      launch: "Launch workflow",
      launching: "Launching...",
      statePolling: "State (polling 2s)",
      loadingState: "Loading state…",
      sendSignal: "Send signal",
      pendingSignals: "Pending",
      send: "Send signal",
    },
    credentials: {
      title: "Integration credentials",
      subtitle: "Store encrypted configuration and secrets for Stripe, CRM, Twilio and KYC.",
      providers: "Providers",
      loading: "Loading...",
      lastUpdated: "Last updated",
      never: "never",
      missingRequired: (n: number) => `Missing ${n} required field(s) to complete this provider.`,
      validation: "Validation",
      incompleteConfig: "Incomplete configuration",
      expectedSource: "Expected source (draft)",
      pendingRequired: "Pending (required)",
      optional: "Optional",
      ok: "OK",
      jsonInvalidPrefix: "Invalid JSON:",
      hasFormErrors: "There are errors in the form. Fix them before saving.",
      saved: "Credentials saved.",
      saveErrorPrefix: "Save error:",
      show: "Show",
      hide: "Hide",
      noGuidedForm: "This provider has no guided form yet. You can use advanced JSON mode.",
      advancedMode: "Advanced mode (JSON)",
      configJson: "Config (JSON)",
      secretsJson: "Secrets (JSON encrypted in backend)",
      reload: "Reload",
      save: "Save",
      saving: "Saving...",
    },
    providerSchemas: {
      requiredField: "Required field.",
    },
    designerConstants: {
      weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    designer: {
      title: "Create workflow",
      loadingActivities: "Loading activities catalog…",
      integrationsStatus: "Integrations status",
      integrationsStatusLoadFailed: "Could not load status:",
      integrationsStatusEmpty: "No status data.",
      missing: "Missing",
      newWorkflow: "+ Create workflow",
      templates: "Templates",
      createFromTemplate: "(create from template…)",
      templateRequires: (label: string, missing: string) =>
        `Template "${label}" requires unregistered activities: ${missing}`,
      templatesRequireRegistered:
        "A template is applied only if its required activities are registered in this environment.",
      templateRunContextHint:
        "In step inputs you can use {{ run.workflowId }} and {{ run.runId }} (same as ftn.workflowId() / ftn.runId()) for return URLs or links to /pagar.",
      loading: "Loading…",
      noWorkflowsYet: "No workflows defined yet.",
      lastRun: "Last run:",
      lastError: "Last error:",
      editWorkflow: "Edit workflow",
      errorPrefix: "Error:",
      meta: "Meta",
      execution: "Execution",
      steps: "Steps",
      addStep: "+ Add step",
      needAtLeastOneStep: "Add at least one step for this workflow.",
      delete: "Delete",
      jsonInvalid: "Invalid JSON",
      inputJsonInvalid: "Invalid input JSON",
      starting: "Starting…",
      runTest: "Run test (run)",
      saveWorkflow: "Save workflow",
      cancel: "Cancel",
      chooseLeft: "Choose a workflow on the left or create a new one to edit its JSON definition.",
      instant: "Instant (on create)",
      weeklyConcrete: "Weekly (specific days)",
      usedForInstantAndScheduled: "Used for instant runs on create and for every scheduled run.",
      payloadPreview: "Payload that will be saved (quick review).",
    },
  },
} as const;

export type UiText = typeof uiText;

export function useUiText() {
  const [locale, setLocale] = useLocale();
  const t = uiText[locale];
  return { locale, setLocale, t };
}

