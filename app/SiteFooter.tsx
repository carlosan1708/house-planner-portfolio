export default function SiteFooter({ className = "", language = "en" }: { className?: string; language?: "en" | "es" }) {
  return (
    <footer className={`site-footer ${className}`.trim()}>
      <span>{language === "es" ? "Autor:" : "Author:"}</span>
      <a href="mailto:carlosan1708@gmail.com">carlosan1708@gmail.com</a>
    </footer>
  );
}
