export function normalizeCrcAmountInput(value: string) {
  return value.replace(/[^\d]/g, "");
}
