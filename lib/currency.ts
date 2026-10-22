/** Project denomination is independent of the interface language. Legacy projects use CRC. */
export const PROJECT_CURRENCIES = ["USD", "CRC"] as const;
export type ProjectCurrency = (typeof PROJECT_CURRENCIES)[number];

export function isProjectCurrency(value: unknown): value is ProjectCurrency {
  return value === "USD" || value === "CRC";
}

export function projectCurrency(value: unknown): ProjectCurrency {
  return isProjectCurrency(value) ? value : "CRC";
}

export function currencyNumberFormat(currency: ProjectCurrency, decimals = false) {
  return `${currency === "USD" ? "$" : "₡"}#,##0${decimals ? ".00" : ""}`;
}

/** Excel locale directives such as [$-409] do not denote dollar amounts. */
export function currencyFromNumberFormat(format: string): ProjectCurrency | null {
  const value = format.replace(/\[\$-[^\]]*\]/g, "");
  if (/%/.test(value)) return null;
  if (/₡|CRC/i.test(value)) return "CRC";
  if (/\$|USD/i.test(value)) return "USD";
  return null;
}
