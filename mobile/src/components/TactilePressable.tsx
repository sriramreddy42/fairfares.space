import React, { ReactNode, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  GestureResponderEvent,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from "react-native";

type Props = Omit<PressableProps, "children" | "style" | "onPressIn" | "onPressOut"> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Keep press feedback small enough that cards never appear to jump. */
  pressScale?: number;
  onPressIn?: (event: GestureResponderEvent) => void;
  onPressOut?: (event: GestureResponderEvent) => void;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Shared physical press feedback for the app's main controls.
 *
 * Touchable opacity alone confirms a tap only by fading. This component gives
 * controls a short direct-manipulation response and returns with a restrained
 * spring. It honours the system Reduce Motion preference at runtime.
 */
export function TactilePressable({ children, style, pressScale = 0.97, disabled, onPressIn, onPressOut, ...props }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    const applyPreference = (enabled: boolean) => {
      if (!active) return;
      setReduceMotion(enabled);
      if (enabled) {
        scale.stopAnimation();
        scale.setValue(1);
      }
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(applyPreference).catch(() => applyPreference(false));
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", applyPreference);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [scale]);

  const settle = () => {
    if (reduceMotion) return;
    scale.stopAnimation();
    Animated.spring(scale, {
      toValue: 1,
      tension: 260,
      friction: 17,
      useNativeDriver: true,
    }).start();
  };

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      style={[style, { transform: [{ scale }] }]}
      onPressIn={(event) => {
        if (!disabled && !reduceMotion) {
          scale.stopAnimation();
          Animated.timing(scale, { toValue: pressScale, duration: 90, useNativeDriver: true }).start();
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        settle();
        onPressOut?.(event);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
