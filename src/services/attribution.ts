import { ATTRIBUTION, ATTRIBUTION_EN } from "../config/defaults.js";

export function getAttribution(lang: "ind" | "eng" = "ind"): string {
  return lang === "eng" ? ATTRIBUTION_EN : ATTRIBUTION;
}

export function appendAttribution(text: string, lang: "ind" | "eng" = "ind"): string {
  return `${text}\n\n---\n${getAttribution(lang)}`;
}
