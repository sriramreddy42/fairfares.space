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
