import { useMemo } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  /** Protected system area painted beneath the nav. */
  systemBottomInset: number;
  /** Visual-only extension toward the screen edge; tab controls stay inset. */
  navVisualOverlap: number;
  /** Width for the floating nav; undefined on phones (full-bleed with margins). */
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
    // Position the floating bar from the actual runtime system inset. Android
    // can switch between gesture navigation and three-button navigation while
    // the app is installed, so a fixed offset is not safe. A small Android
    // floor keeps the pill visually separated on devices that report zero
    // while their navigation bar animates in.
    const systemBottomInset = Math.max(0, insets.bottom);
    const navVisualOverlap = Platform.OS === "ios"
      ? Math.min(12, systemBottomInset)
      : Platform.OS === "android" && systemBottomInset <= 32
        ? Math.min(8, systemBottomInset)
        : 0;
    const navBottomInset = Math.max(
      systemBottomInset - navVisualOverlap,
      Platform.OS === "android" ? 6 : BOTTOM_NAV_BOTTOM_OFFSET,
    );
    // Extra 14pt breathing room so the last card is fully visible above the pill.
    const navClearance =
      BOTTOM_NAV_HEIGHT + systemBottomInset + 14;
    return {
      isTablet,
      contentMaxWidth,
      navClearance,
      navBottomInset,
      systemBottomInset,
      navVisualOverlap,
      navWidth: isTablet ? TABLET_NAV_MAX_WIDTH : undefined,
    };
  }, [width, isTablet, insets.bottom]);
}
