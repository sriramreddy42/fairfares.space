const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);

export function explicitUsState(value: string) {
  const matches = String(value || "").toUpperCase().matchAll(/(?:^|,\s*)([A-Z]{2})(?=\s*(?:,|\d{5}(?:-\d{4})?|$))/g);
  let state = "";
  for (const match of matches) {
    const candidate = match[1] || "";
    if (US_STATE_CODES.has(candidate)) state = candidate;
  }
  return state;
}

type DeviceAddress = {
  city?: string | null;
  district?: string | null;
  subregion?: string | null;
  region?: string | null;
  isoCountryCode?: string | null;
  country?: string | null;
};

const COUNTRY_NAMES: Record<string, string> = {
  IN: "India",
  US: "USA",
  CA: "Canada",
};

const LOCATION_COUNTRY_HINTS: Record<string, string[]> = {
  IN: ["india", "hyderabad", "telangana", "mumbai", "delhi", "bengaluru", "bangalore", "chennai", "kolkata", "pune", "ahmedabad", "jaipur", "gurugram", "gurgaon", "noida"],
  US: ["usa", "united states", "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "illinois", "new jersey", "new york", "texas", "washington", "denver", "san francisco", "san diego", "san antonio", "chicago", "dallas", "seattle", "miami"],
  CA: ["canada", "toronto", "vancouver", "montreal", "calgary", "ottawa", "edmonton"],
};

function cleanLocationPart(value?: string | null) {
  return String(value || "").trim();
}

function pushUnique(parts: string[], value?: string | null) {
  const clean = cleanLocationPart(value);
  if (!clean) return;
  if (parts.some((part) => part.toLocaleLowerCase() === clean.toLocaleLowerCase())) return;
  parts.push(clean);
}

export function deviceAddressCityLabel(address: DeviceAddress | null | undefined) {
  const locality = cleanLocationPart(address?.city || address?.district || address?.subregion);
  const countryCode = cleanLocationPart(address?.isoCountryCode).toUpperCase();
  const rawRegion = cleanLocationPart(address?.region);
  const region = countryCode && countryCode !== "US" && rawRegion.toUpperCase() === countryCode ? "" : rawRegion;
  const country = cleanLocationPart(address?.country) || COUNTRY_NAMES[countryCode] || countryCode;
  const parts: string[] = [];
  pushUnique(parts, locality);
  pushUnique(parts, region);
  if (countryCode && countryCode !== "US") pushUnique(parts, country);
  return parts.join(", ");
}

export function locationCountryCodeFromLabel(value: string | null | undefined) {
  const normalized = cleanLocationPart(value).toLocaleLowerCase();
  if (!normalized) return "";
  const explicitCountry = normalized.match(/(?:^|,\s*)(india|in|usa|us|united states|united states of america|canada|ca)\s*$/i)?.[1]?.toLocaleLowerCase();
  if (explicitCountry) {
    if ((explicitCountry === "in" || explicitCountry === "ca") && explicitUsState(value || "")) return "US";
    if (explicitCountry === "india" || explicitCountry === "in") return "IN";
    if (explicitCountry === "usa" || explicitCountry === "us" || explicitCountry.startsWith("united states")) return "US";
    if (explicitCountry === "canada" || explicitCountry === "ca") return "CA";
  }
  const tokenized = ` ${normalized.replace(/[^a-z0-9]+/g, " ")} `;
  for (const [countryCode, hints] of Object.entries(LOCATION_COUNTRY_HINTS)) {
    if (hints.some((hint) => tokenized.includes(` ${hint} `))) return countryCode;
  }
  return "";
}
