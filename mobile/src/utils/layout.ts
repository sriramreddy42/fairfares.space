import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Fixed bottom navigation bar dimensions (see BottomTabs.tsx).
export const BOTTOM_NAV_HEIGHT = 76;
export const BOTTOM_NAV_BOTTOM_OFFSET = 0;
// Content width cap used on tablets (matches ProfileScreen's established maxWidth).
export const TABLET_CONTENT_MAX_WIDTH = 980;
// Widths >= this are treated as tablet layouts. All iPad models are >= 744pt
// and the largest phone is 440pt, so 600 cleanly separates the two classes.
export const TABLET_BREAKPOINT = 600;
// Cap the fixed tab bar on tablets so its five equal touch targets stay comfortable.
export const TABLET_NAV_MAX_WIDTH = 600;

export type ResponsiveLayout = {
  isTablet: boolean;
  /** Content width cap: "100%" on phones, min(width, 980) on tablets. */
  contentMaxWidth: number | "100%";
  /** Bottom padding screens need to keep content clear of the fixed nav. */
  navClearance: number;
  /** Bottom offset for positioning the fixed nav. */
  navBottomInset: number;
  /** Width for the fixed nav; undefined on phones (full width). */
  navWidth: number | undefined;
};

export function useResponsiveLayout(): ResponsiveLayout {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isTablet = width >= TABLET_BREAKPOINT;

  return useMemo(() => {
    const contentMaxWidth: number | "100%" = isTablet
      ? Math.min(width, TABLET_CONTENT_MAX_WIDTH)
      : "100%";
    // App.tsx already applies the bottom safe area to its root SafeAreaView.
    // Adding insets.bottom here again lifts the bar by a second home-indicator
    // inset and left an unintended empty band below it.
    const navBottomInset = BOTTOM_NAV_BOTTOM_OFFSET;
    // Extra 14pt breathing room so the last card is fully visible above the bar.
    const navClearance =
      BOTTOM_NAV_HEIGHT + BOTTOM_NAV_BOTTOM_OFFSET + 14;
    return {
      isTablet,
      contentMaxWidth,
      navClearance,
      navBottomInset,
      navWidth: isTablet ? TABLET_NAV_MAX_WIDTH : undefined,
    };
  }, [width, isTablet, insets.bottom]);
}
