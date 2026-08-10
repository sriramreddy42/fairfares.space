import React, { ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, Platform, StyleProp, View, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { requireOptionalNativeModule } from "expo-modules-core";

type GlassEffectPackage = typeof import("expo-glass-effect");

let glassEffectPackage: GlassEffectPackage | null = null;
if (Platform.OS === "ios" && requireOptionalNativeModule("ExpoGlassEffect")) {
  try {
    glassEffectPackage = require("expo-glass-effect") as GlassEffectPackage;
  } catch {
    glassEffectPackage = null;
  }
}

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
  fallbackColor?: string;
  intensity?: number;
  interactive?: boolean;
};

export function AdaptiveGlassView({ children, style, tintColor = "#16221E", fallbackColor = "rgba(20,22,21,0.94)", intensity = 58, interactive = false }: Props) {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setReduceTransparency);
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduceTransparency);
    return () => subscription.remove();
  }, []);

  const NativeGlassView = glassEffectPackage?.GlassView;
  const nativeGlassAvailable = Boolean(NativeGlassView && glassEffectPackage?.isLiquidGlassAvailable() && glassEffectPackage?.isGlassEffectAPIAvailable());
  if (NativeGlassView && nativeGlassAvailable && !reduceTransparency) {
    return <NativeGlassView style={style} glassEffectStyle="regular" tintColor={tintColor} isInteractive={interactive}>{children}</NativeGlassView>;
  }
  if (reduceTransparency) {
    return <View style={[style, { backgroundColor: fallbackColor }]}>{children}</View>;
  }
  return <BlurView style={style} intensity={intensity} tint="dark" experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}>{children}</BlurView>;
}
