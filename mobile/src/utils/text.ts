export function avatarInitials(label: string, fallback = "F") {
  // NFKC turns mathematical/stylized letters such as 𝙎 into their readable
  // equivalents. Array.from then reads complete Unicode code points instead
  // of splitting surrogate pairs into the replacement glyph (�).
  const normalized = String(label || "").normalize("NFKC").trim();
  if (!normalized) return fallback;
  const initials = normalized
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part).find((character) => {
      const codePoint = character.codePointAt(0) || 0;
      const unpairedSurrogate = codePoint >= 0xD800 && codePoint <= 0xDFFF;
      return character !== "\uFFFD" && !unpairedSurrogate && Boolean(character.trim());
    }) || "")
    .join("")
    .toLocaleUpperCase();
  return initials || fallback;
}
