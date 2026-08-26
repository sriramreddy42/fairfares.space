import { DynamicColorIOS, Platform, PlatformColor } from "react-native";

function adaptiveColor(light: string, dark: string, androidRole: string) {
  if (Platform.OS === "ios") return DynamicColorIOS({ light, dark });
  if (Platform.OS === "android") return PlatformColor(androidRole);
  return dark;
}

export const theme = {
  colors: {
    bg: adaptiveColor("#e9edf2", "#0f0f10", "?android:attr/colorBackground"),
    panel: adaptiveColor("rgba(255,255,255,0.92)", "rgba(24,24,25,0.92)", "?android:attr/colorBackgroundFloating"),
    panel2: adaptiveColor("rgba(240,242,245,0.90)", "rgba(36,36,37,0.90)", "?android:attr/colorBackgroundFloating"),
    line: adaptiveColor("#dddfe2", "#343436", "?android:attr/colorControlNormal"),
    text: adaptiveColor("#050505", "#f5f5f5", "?android:attr/textColorPrimary"),
    muted: adaptiveColor("#65676b", "#aaaab0", "?android:attr/textColorSecondary"),
    soft: adaptiveColor("#1c1e21", "#d7d7da", "?android:attr/textColorPrimary"),
    brand: "#18b884",
    accent: "#ff3b30",
    blue: "#1877f2",
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
    card: { backgroundColor: adaptiveColor("rgba(255,255,255,0.92)", "rgba(24,24,25,0.92)", "?android:attr/colorBackgroundFloating"), borderColor: adaptiveColor("rgba(255,255,255,0.72)", "rgba(255,255,255,0.10)", "?android:attr/colorControlNormal"), borderWidth: 1, borderRadius: 18, shadowColor: "#101828", shadowOpacity: 0.14, shadowRadius: 15, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
    raised: { backgroundColor: adaptiveColor("rgba(255,255,255,0.86)", "rgba(36,36,37,0.90)", "?android:attr/colorBackgroundFloating"), borderColor: adaptiveColor("rgba(255,255,255,0.68)", "rgba(255,255,255,0.12)", "?android:attr/colorControlNormal"), borderWidth: 1, borderRadius: 18, shadowColor: "#101828", shadowOpacity: 0.11, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
    input: { backgroundColor: adaptiveColor("rgba(255,255,255,0.78)", "rgba(36,36,37,0.86)", "?android:attr/colorBackgroundFloating"), borderColor: adaptiveColor("rgba(255,255,255,0.62)", "rgba(255,255,255,0.10)", "?android:attr/colorControlNormal"), borderWidth: 1, borderRadius: 18 }
  }
};
