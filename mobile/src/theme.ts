import { Appearance, DynamicColorIOS, NativeModules, Platform, PlatformColor } from "react-native";

export type AppAppearancePreference = "system" | "light" | "dark";

export function setPlatformAppearance(preference: AppAppearancePreference) {
  if (Platform.OS === "android") {
    NativeModules.FairFaresTheme?.setMode(preference);
    return;
  }
  Appearance.setColorScheme(preference === "system" ? null : preference);
}

function adaptiveColor(light: string, dark: string, androidResource: string) {
  if (Platform.OS === "ios") return DynamicColorIOS({ light, dark });
  if (Platform.OS === "android") return PlatformColor(androidResource);
  return dark;
}

export const theme = {
  colors: {
    bg: adaptiveColor("#f3f4f6", "#0f0f10", "@color/ff_background"),
    panel: adaptiveColor("rgba(255,255,255,0.92)", "rgba(24,24,25,0.92)", "@color/ff_surface"),
    panel2: adaptiveColor("rgba(240,242,245,0.90)", "rgba(36,36,37,0.90)", "@color/ff_surface_variant"),
    line: adaptiveColor("#dddfe2", "#343436", "@color/ff_outline"),
    text: adaptiveColor("#050505", "#f5f5f5", "@color/ff_on_background"),
    muted: adaptiveColor("#65676b", "#aaaab0", "@color/ff_on_surface_variant"),
    soft: adaptiveColor("#1c1e21", "#d7d7da", "@color/ff_on_surface"),
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
    card: { backgroundColor: adaptiveColor("rgba(255,255,255,0.92)", "rgba(24,24,25,0.92)", "@color/ff_surface"), borderColor: adaptiveColor("rgba(255,255,255,0.72)", "rgba(255,255,255,0.10)", "@color/ff_outline"), borderWidth: 1, borderRadius: 18, shadowColor: "#101828", shadowOpacity: Platform.OS === "android" ? 0 : 0.14, shadowRadius: 15, shadowOffset: { width: 0, height: 8 }, elevation: Platform.OS === "android" ? 0 : 6 },
    raised: { backgroundColor: adaptiveColor("rgba(255,255,255,0.86)", "rgba(36,36,37,0.90)", "@color/ff_surface_variant"), borderColor: adaptiveColor("rgba(255,255,255,0.68)", "rgba(255,255,255,0.12)", "@color/ff_outline"), borderWidth: 1, borderRadius: 18, shadowColor: "#101828", shadowOpacity: Platform.OS === "android" ? 0 : 0.11, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: Platform.OS === "android" ? 0 : 4 },
    input: { backgroundColor: adaptiveColor("rgba(255,255,255,0.78)", "rgba(36,36,37,0.86)", "@color/ff_surface_variant"), borderColor: adaptiveColor("rgba(255,255,255,0.62)", "rgba(255,255,255,0.10)", "@color/ff_outline"), borderWidth: 1, borderRadius: 18 }
  }
};
