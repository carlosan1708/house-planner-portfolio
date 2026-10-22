import { describe, expect, it } from "vitest";
import { normalizeCrcAmountInput } from "@/lib/expense-input";

describe("expense payment amount input", () => {
  it.each([
    ["200000", "200000"],
    ["₡200.000", "200000"],
    ["CRC 200,000", "200000"],
    [" 1 900 000 ", "1900000"],
  ])("normalizes %s as whole colones", (input, expected) => {
    expect(normalizeCrcAmountInput(input)).toBe(expected);
  });
});
