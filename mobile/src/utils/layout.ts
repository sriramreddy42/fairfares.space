import { useMemo } from "react";
import { useWindowDimensions } from "react-native";

// Floating bottom navigation bar dimensions (see BottomTabs.tsx).
export const BOTTOM_NAV_HEIGHT = 70;
// Sit flush with the app's bottom safe-area edge. The SafeAreaView already
// keeps the pill above the iOS home indicator and Android system navigation;
// an additional inset exposed a thin strip of page content below the pill.
export const BOTTOM_NAV_BOTTOM_OFFSET = 0;
export const BOTTOM_NAV_HORIZONTAL_MARGIN = 12;
// Content width cap used on tablets (matches ProfileScreen's established maxWidth).
export const TABLET_CONTENT_MAX_WIDTH = 980;
// Widths >= this are treated as tablet layouts. All iPad models are >= 744pt
// and the largest phone is 440pt, so 600 cleanly separates the two classes.
export const TABLET_BREAKPOINT = 600;
// Cap the floating tab bar on tablets so its five equal touch targets stay comfortable.
export const TABLET_NAV_MAX_WIDTH = 560;

export type ResponsiveLayout = {
  isTablet: boolean;
  /** Content width cap: "100%" on phones, min(width, 980) on tablets. */
  contentMaxWidth: number | "100%";
  /** Bottom padding screens need to keep content clear of the floating nav. */
  navClearance: number;
  /** Bottom offset for positioning the floating nav. */
  navBottomInset: number;
  /** Width for the floating nav; undefined on phones (full-bleed with margins). */
  navWidth: number | undefined;
};

export function useResponsiveLayout(): ResponsiveLayout {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;

  return useMemo(() => {
    const contentMaxWidth: number | "100%" = isTablet
      ? Math.min(width, TABLET_CONTENT_MAX_WIDTH)
      : "100%";
    // The root SafeAreaView already ends above Android's gesture/three-button
    // navigation area and the iOS home indicator. Never move controls back into
    // that protected area: the size of Android's system navigation can change
    // at runtime and negative offsets make the last tab partially untappable.
    const navBottomInset = BOTTOM_NAV_BOTTOM_OFFSET;
    // Extra 14pt breathing room so the last card is fully visible above the pill.
    const navClearance =
      BOTTOM_NAV_HEIGHT + BOTTOM_NAV_BOTTOM_OFFSET + 14;
    return {
      isTablet,
      contentMaxWidth,
      navClearance,
      navBottomInset,
      navWidth: isTablet ? TABLET_NAV_MAX_WIDTH : undefined,
    };
  }, [width, isTablet]);
}
