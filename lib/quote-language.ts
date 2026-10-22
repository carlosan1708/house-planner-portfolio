export function calmQuoteRecommendation(value: string) {
  return value
    .replace(/^No aceptar como ([^.]+)\.\s*/i, "Antes de aceptar como $1, conviene aclarar estos puntos. ")
    .replace(/^No aceptar(?: esta cotización)?\.\s*/i, "Antes de aceptar, conviene aclarar los siguientes puntos. ")
    .replace(/\bEs imperativo aclarar\b/gi, "Conviene confirmar")
    .replace(/\bEs imperativo\b/gi, "Es importante")
    .replace(/\bse debe corregir urgentemente\b/gi, "conviene revisar con prioridad")
    .replace(/\bdebe corregirse urgentemente\b/gi, "conviene revisarlo con prioridad")
    .replace(/\bes insuficiente\b/gi, "podría no ser suficiente")
    .replace(/\bDo not accept as ([^.]+)\.\s*/i, "Before accepting as $1, clarify these points. ")
    .replace(/\bIt is imperative to clarify\b/gi, "It would be helpful to confirm")
    .replace(/\bmust be corrected urgently\b/gi, "should be reviewed as a priority")
    .replace(/\bis insufficient\b/gi, "may not be sufficient")
    .trim();
}

const delegatedComparisonPattern = /(?:\brecomendamos\b|\brecomienda\b|\bconviene\b|\bdebe\b|\bdeber(?:ía|ia)?\b|\bsugerimos\b|\brecommend\b|\bshould\b|\bsuggest\b)[\s\S]{0,180}\b(?:comparar|comparación|comparacion|contrastar|compare|comparison)\b/i;
const budgetComparisonPattern = /\b(?:presupuesto|budget)\b/i;

function comparisonExcerpt(value: string) {
  const cleaned = value
    .replace(/[*_#>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g);
  return (sentences?.slice(0, 2).map((sentence) => sentence.trim()).join(" ") || cleaned).slice(0, 700).trim();
}

export function quoteRecommendationForDisplay(input: {
  recommendation: string;
  webComparisonSummary?: string;
  budgetComparisonSummary?: string;
  language: "en" | "es";
}) {
  const recommendation = calmQuoteRecommendation(input.recommendation);
  const comparison = comparisonExcerpt(
    input.webComparisonSummary
    || (budgetComparisonPattern.test(recommendation) ? input.budgetComparisonSummary || "" : ""),
  );
  if (!comparison || !delegatedComparisonPattern.test(recommendation)) return recommendation;
  return input.language === "es"
    ? `La comparación ya fue realizada. ${comparison}`
    : `The comparison has already been completed. ${comparison}`;
}
