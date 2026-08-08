export const theme = {
  colors: {
    bg: "#0f0f10",
    panel: "#181819",
    panel2: "#242425",
    line: "#343436",
    text: "#f5f5f5",
    muted: "#aaaab0",
    soft: "#d7d7da",
    brand: "#18b884",
    accent: "#ff3b30",
    blue: "#4f7cff",
    green: "#5ec47a",
    warning: "#ff9f0a"
  },
  radius: {
    sm: 12,
    md: 18,
    lg: 26,
    pill: 999
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24
  },
  typography: {
    screenTitle: { fontSize: 24, lineHeight: 29, fontWeight: "700" as const },
    sectionTitle: { fontSize: 19, lineHeight: 24, fontWeight: "700" as const },
    cardTitle: { fontSize: 15, lineHeight: 20, fontWeight: "700" as const },
    body: { fontSize: 14, lineHeight: 19, fontWeight: "400" as const },
    bodyStrong: { fontSize: 14, lineHeight: 19, fontWeight: "600" as const },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" as const },
    button: { fontSize: 14, lineHeight: 18, fontWeight: "600" as const },
    eyebrow: { fontSize: 11, lineHeight: 15, fontWeight: "700" as const, letterSpacing: 0.7, textTransform: "uppercase" as const }
  },
  depth: {
    card: { backgroundColor: "#181819", borderColor: "#343436", borderWidth: 1, borderRadius: 18 },
    raised: { backgroundColor: "#242425", borderColor: "#3a3a3c", borderWidth: 1, borderRadius: 18 },
    input: { backgroundColor: "#242425", borderColor: "#3a3a3c", borderWidth: 1, borderRadius: 18 }
  }
};
