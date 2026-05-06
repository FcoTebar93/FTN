import { useUiText } from "./index";

type LanguageToggleButtonProps = {
  className?: string;
};

export function LanguageToggleButton({ className }: LanguageToggleButtonProps) {
  const { locale, setLocale } = useUiText();

  const isEs = locale === "es";
  const nextLocale = isEs ? "en" : "es";
  const label = isEs ? "Switch language to English" : "Cambiar idioma a español";
  const title = isEs ? "Switch to English" : "Cambiar a español";

  return (
    <button
      type="button"
      className={className ?? "lang-toggle-btn"}
      onClick={() => setLocale(nextLocale)}
      aria-label={label}
      title={title}
    >
      <span className="lang-toggle-emoji" aria-hidden="true">
        {isEs ? "🇪🇸" : "🇬🇧"}
      </span>
    </button>
  );
}

