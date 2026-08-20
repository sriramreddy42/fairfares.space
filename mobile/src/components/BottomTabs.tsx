import React from "react";
import { Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { FairFaresUser } from "../types";
import { AdaptiveGlassView } from "./AdaptiveGlassView";
import { UserAvatar } from "./UserAvatar";
import {
  BOTTOM_NAV_HEIGHT,
  useResponsiveLayout,
} from "../utils/layout";

export type TabKey = "home" | "housing" | "services" | "activity" | "messenger" | "profile";

type VisibleTabKey = Exclude<TabKey, "housing">;

type NavigationItem = {
  key: VisibleTabKey;
  label: string;
  icon: ImageSourcePropType;
  width: number;
  height: number;
};

const navigationItems: NavigationItem[] = [
  { key: "home", label: "Home", icon: appAssets.navHome, width: 26, height: 26 },
  { key: "services", label: "Services", icon: appAssets.navServices, width: 26, height: 26 },
  { key: "activity", label: "Activity", icon: appAssets.navActivity, width: 26, height: 26 },
  { key: "messenger", label: "Chitthi", icon: appAssets.chittiMascot, width: 29, height: 31 },
  { key: "profile", label: "Account", icon: appAssets.profile, width: 26, height: 26 },
];

type Props = {
  active: TabKey;
  unreadCount: number;
  user: FairFaresUser | null;
  onChange: (tab: TabKey) => void;
  hidden?: boolean;
};

function visibleActiveTab(active: TabKey): VisibleTabKey {
  return active === "housing" ? "home" : active;
}

export function BottomTabs({ active, unreadCount, user, onChange, hidden = false }: Props) {
  const layout = useResponsiveLayout();
  const safeAreaInsets = useSafeAreaInsets();
  if (hidden) return null;

  const selected = visibleActiveTab(active);

  return (
    <View
      style={[
        styles.card,
        {
          bottom: layout.navBottomInset - safeAreaInsets.bottom,
          height: BOTTOM_NAV_HEIGHT + safeAreaInsets.bottom,
        },
        layout.isTablet
          ? { width: layout.navWidth, alignSelf: "center" }
          : { left: 0, right: 0 }
      ]}
      accessibilityRole="tablist"
    >
      <View pointerEvents="none" style={styles.glassClip}>
        <AdaptiveGlassView
          style={StyleSheet.absoluteFill}
          intensity={72}
          tintColor="rgba(24,29,27,0.72)"
          fallbackColor="rgba(20,21,21,0.94)"
        />
        <View style={styles.glassTint} />
        <View style={styles.glassTopHighlight} />
        <View style={styles.glassBottomShade} />
      </View>
      <View style={[styles.itemsRow, { paddingBottom: safeAreaInsets.bottom }]}>
        {navigationItems.map((item) => {
          const isSelected = selected === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: isSelected }}
              activeOpacity={0.72}
              onPress={() => onChange(item.key)}
              hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
              style={styles.touchTarget}
            >
              <View style={[styles.itemContent, isSelected && styles.selectedItem]}>
                <View style={[styles.iconFrame, item.key === "messenger" && styles.chitthiIconFrame]}>
                  {item.key === "profile" && user?.profilePhotoUrl ? (
                    <UserAvatar
                      photoUrl={user.profilePhotoUrl}
                      style={[styles.profileAvatar, isSelected && styles.selectedProfileAvatar]}
                      imageStyle={styles.profileAvatarImage}
                    />
                  ) : (
                    <Image
                      source={item.icon}
                      resizeMode="contain"
                      style={[
                        styles.icon,
                        { width: item.width, height: item.height },
                        item.key !== "messenger" && isSelected && styles.selectedIcon,
                        !isSelected && styles.unselectedIcon,
                      ]}
                    />
                  )}
                  {item.key === "messenger" && unreadCount > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={[styles.label, isSelected && styles.selectedLabel]}>
                  {item.label}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.18)",
    backgroundColor: "transparent",
    elevation: 12,
  },
  glassClip: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    // Native blur/liquid-glass can produce its first sampled frame only after
    // the underlying scroll view invalidates. Paint the stable material color
    // immediately so launch never exposes page content through an empty glass
    // surface; the native effect then enhances this base when ready.
    backgroundColor: "rgba(14,18,17,0.97)",
  },
  glassTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7,12,10,0.34)",
  },
  glassTopHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  glassBottomShade: {
    display: "none",
  },
  itemsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  touchTarget: {
    flex: 1,
    height: "100%",
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 0,
  },
  itemContent: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  selectedItem: {
    backgroundColor: "transparent",
  },
  iconFrame: {
    width: 38,
    height: 31,
    alignItems: "center",
    justifyContent: "center",
  },
  chitthiIconFrame: {
    height: 31,
  },
  icon: {
    opacity: 1,
  },
  selectedIcon: {
    tintColor: "#F0C671",
  },
  profileAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
    opacity: 0.78,
  },
  selectedProfileAvatar: {
    borderColor: "#F0C671",
    opacity: 1,
  },
  profileAvatarImage: {
    width: "100%",
    height: "100%",
  },
  unselectedIcon: {
    opacity: 0.68,
  },
  label: {
    color: "#A8A8A8",
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  selectedLabel: {
    color: "#FFFFFF",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: theme.colors.text,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "900",
  },
});
