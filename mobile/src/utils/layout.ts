import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Floating bottom navigation bar dimensions (see BottomTabs.tsx).
export const BOTTOM_NAV_HEIGHT = 70;
export const BOTTOM_NAV_BOTTOM_OFFSET = 9;
export const BOTTOM_NAV_HORIZONTAL_MARGIN = 12;
// Content width cap used on tablets (matches ProfileScreen's established maxWidth).
export const TABLET_CONTENT_MAX_WIDTH = 980;
// Widths >= this are treated as tablet layouts. All iPad models are >= 744pt
// and the largest phone is 440pt, so 600 cleanly separates the two classes.
export const TABLET_BREAKPOINT = 600;
// Cap for the floating bottom nav pill on tablets so it never spans the full width.
export const TABLET_NAV_MAX_WIDTH = 560;

export type ResponsiveLayout = {
  isTablet: boolean;
  /** Content width cap: "100%" on phones, min(width, 980) on tablets. */
  contentMaxWidth: number | "100%";
  /** Bottom padding screens need to keep content clear of the floating nav. */
  navClearance: number;
  /** Bottom offset for positioning the floating nav (safe inset + fixed offset). */
  navBottomInset: number;
  /** Width for the floating nav pill; undefined on phones (full-bleed with margins). */
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
    const navBottomInset = insets.bottom + BOTTOM_NAV_BOTTOM_OFFSET;
    // Extra 14pt breathing room so the last card is fully visible above the pill.
    const navClearance =
      BOTTOM_NAV_HEIGHT + BOTTOM_NAV_BOTTOM_OFFSET + insets.bottom + 14;
    return {
      isTablet,
      contentMaxWidth,
      navClearance,
      navBottomInset,
      navWidth: isTablet ? TABLET_NAV_MAX_WIDTH : undefined,
    };
  }, [width, isTablet, insets.bottom]);
}
