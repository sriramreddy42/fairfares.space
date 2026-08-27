import React, { ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, LayoutChangeEvent, Platform, StyleProp, View, ViewStyle } from "react-native";
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
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
  fallbackColor?: string;
  intensity?: number;
  blurTint?: "light" | "dark";
  interactive?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
};

export function AdaptiveGlassView({ children, style, tintColor = "#16221E", fallbackColor = "rgba(20,22,21,0.94)", intensity = 58, blurTint = "dark", interactive = false, onLayout }: Props) {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web" || typeof AccessibilityInfo.isReduceTransparencyEnabled !== "function") {
      setReduceTransparency(false);
      return;
    }
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setReduceTransparency);
    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduceTransparency);
    return () => subscription.remove();
  }, []);

  const NativeGlassView = glassEffectPackage?.GlassView;
  const nativeGlassAvailable = Boolean(NativeGlassView && glassEffectPackage?.isLiquidGlassAvailable() && glassEffectPackage?.isGlassEffectAPIAvailable());
  if (NativeGlassView && nativeGlassAvailable && !reduceTransparency) {
    return <NativeGlassView style={style} glassEffectStyle="regular" tintColor={tintColor} isInteractive={interactive} onLayout={onLayout}>{children}</NativeGlassView>;
  }
  if (reduceTransparency) {
    return <View style={[style, { backgroundColor: fallbackColor }]} onLayout={onLayout}>{children}</View>;
  }
  // Android's experimental BlurView samples the moving content underneath and
  // can render as a displaced, washed-out panel while lists are settling. Use
  // the same stable semantic material Android's own navigation surfaces use;
  // iOS keeps native liquid glass / blur where the compositor supports it.
  if (Platform.OS === "android") {
    return <View style={[style, { backgroundColor: fallbackColor }]} onLayout={onLayout}>{children}</View>;
  }
  return <BlurView style={style} intensity={intensity} tint={blurTint} onLayout={onLayout}>{children}</BlurView>;
}
