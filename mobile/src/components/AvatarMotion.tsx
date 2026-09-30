import React, { ReactNode, useEffect } from "react";
import { StyleProp, ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  active?: boolean;
};

/** A restrained idle motion for prominent identity moments, never chat lists. */
export function AvatarMotion({ children, style, active = true }: Props) {
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!active || reduceMotion) {
      scale.value = withTiming(1, { duration: 120 });
      translateY.value = withTiming(0, { duration: 120 });
      return;
    }
    const timing = { duration: 2100, easing: Easing.inOut(Easing.ease) };
    scale.value = withRepeat(withSequence(withTiming(1.025, timing), withTiming(1, timing)), -1, false);
    translateY.value = withRepeat(withSequence(withTiming(-2, timing), withTiming(0, timing)), -1, false);
  }, [active, reduceMotion, scale, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }, { scale: scale.value }] }));
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
