import React, { ReactNode, useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, Easing, StyleProp, ViewStyle } from "react-native";

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  active?: boolean;
};

/** A restrained idle motion for prominent identity moments, never chat lists. */
export function AvatarMotion({ children, style, active = true }: Props) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    let loop: Animated.CompositeAnimation | null = null;
    const reset = () => {
      loop?.stop();
      progress.setValue(0);
    };
    const start = () => {
      if (!mounted || !active) {
        reset();
        return;
      }
      loop = Animated.loop(Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 2100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(progress, { toValue: 0, duration: 2100, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
      ]));
      loop.start();
    };
    // Motion is decorative, so reduce-motion users always receive a still avatar.
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) reset();
      else start();
    }).catch(start);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) => {
      if (reduced) reset();
      else start();
    });
    return () => {
      mounted = false;
      subscription.remove();
      loop?.stop();
    };
  }, [active, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] });
  return <Animated.View style={[style, { transform: [{ translateY }, { scale }] }]}>{children}</Animated.View>;
}
