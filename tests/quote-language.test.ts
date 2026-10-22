import { describe, expect, it } from "vitest";
import { calmQuoteRecommendation, quoteRecommendationForDisplay } from "@/lib/quote-language";

describe("quote recommendation tone", () => {
  it("turns abrupt Spanish recommendations into calm review guidance", () => {
    const result = calmQuoteRecommendation("No aceptar como un paquete eléctrico completo. Es imperativo aclarar si el cable MC sustituye el THHN. Además, se debe corregir urgentemente la cantidad, ya que 10 metros es insuficiente.");
    expect(result).toBe("Antes de aceptar como un paquete eléctrico completo, conviene aclarar estos puntos. Conviene confirmar si el cable MC sustituye el THHN. Además, conviene revisar con prioridad la cantidad, ya que 10 metros podría no ser suficiente.");
  });

  it("shows the completed comparison instead of delegating it to the owner", () => {
    const result = quoteRecommendationForDisplay({
      recommendation: "Recomendamos comparar esta cotización con precios actuales antes de decidir.",
      webComparisonSummary: "El cable THHN cotizado está 12% por encima del rango observado. La tubería PVC está dentro del rango.",
      language: "es",
    });
    expect(result).toBe("La comparación ya fue realizada. El cable THHN cotizado está 12% por encima del rango observado. La tubería PVC está dentro del rango.");
  });

  it("preserves recommendations that already state a comparison result", () => {
    const recommendation = "Comparada con el presupuesto oficial, la oferta está ₡125 000 por debajo y el alcance coincide.";
    expect(quoteRecommendationForDisplay({ recommendation, webComparisonSummary: "Rango verificado.", language: "es" })).toBe(recommendation);
  });

  it("uses the completed official-budget result for a stored delegated recommendation", () => {
    const result = quoteRecommendationForDisplay({
      recommendation: "Recomendamos solicitar datos adicionales para realizar una comparación precisa contra el presupuesto oficial.",
      budgetComparisonSummary: "Cableado: ₡80 000 por encima del objetivo.",
      language: "es",
    });
    expect(result).toBe("La comparación ya fue realizada. Cableado: ₡80 000 por encima del objetivo.");
  });
});
