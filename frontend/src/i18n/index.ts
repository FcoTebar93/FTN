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
      designer: "Designer",
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
      designer: "Designer",
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
  },
} as const;

export type UiText = typeof uiText;

export function useUiText() {
  const [locale, setLocale] = useLocale();
  const t = uiText[locale];
  return { locale, setLocale, t };
}

