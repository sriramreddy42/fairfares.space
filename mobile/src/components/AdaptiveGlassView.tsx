import React, { ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, Platform, StyleProp, View, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";

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

  const nativeGlassAvailable = Platform.OS === "ios" && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  if (nativeGlassAvailable && !reduceTransparency) {
    return <GlassView style={style} glassEffectStyle="regular" tintColor={tintColor} isInteractive={interactive}>{children}</GlassView>;
  }
  if (reduceTransparency) {
    return <View style={[style, { backgroundColor: fallbackColor }]}>{children}</View>;
  }
  return <BlurView style={style} intensity={intensity} tint="dark" experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}>{children}</BlurView>;
}
