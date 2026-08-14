import React from "react";
import { Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { AdaptiveGlassView } from "./AdaptiveGlassView";

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
  { key: "home", label: "Home", icon: appAssets.navHome, width: 25, height: 25 },
  { key: "services", label: "Services", icon: appAssets.navServices, width: 25, height: 25 },
  { key: "activity", label: "Activity", icon: appAssets.navActivity, width: 25, height: 25 },
  { key: "messenger", label: "Chitthi", icon: appAssets.chittiMascot, width: 31, height: 35 },
  { key: "profile", label: "Account", icon: appAssets.profile, width: 25, height: 25 },
];

type Props = {
  active: TabKey;
  unreadCount: number;
  onChange: (tab: TabKey) => void;
  hidden?: boolean;
};

function visibleActiveTab(active: TabKey): VisibleTabKey {
  return active === "housing" ? "home" : active;
}

export function BottomTabs({ active, unreadCount, onChange, hidden = false }: Props) {
  if (hidden) return null;

  const selected = visibleActiveTab(active);

  return (
    <View style={styles.card} accessibilityRole="tablist">
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
      <View style={styles.itemsRow}>
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
              style={styles.touchTarget}
            >
              <View style={[styles.itemContent, isSelected && styles.selectedItem]}>
                <View style={[styles.iconFrame, item.key === "messenger" && styles.chitthiIconFrame]}>
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
    left: 12,
    right: 12,
    bottom: 9,
    height: 70,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "transparent",
    shadowColor: "#000000",
    shadowOpacity: 0.42,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  glassClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 35,
    overflow: "hidden",
    // Native blur/liquid-glass can produce its first sampled frame only after
    // the underlying scroll view invalidates. Paint the stable material color
    // immediately so launch never exposes page content through an empty glass
    // surface; the native effect then enhances this base when ready.
    backgroundColor: "rgba(20,21,21,0.94)",
  },
  glassTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(11,15,14,0.44)",
  },
  glassTopHighlight: {
    position: "absolute",
    top: 1,
    left: 22,
    right: 22,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  glassBottomShade: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 0,
    height: 20,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.14)",
  },
  itemsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  touchTarget: {
    flex: 1,
    height: "100%",
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  itemContent: {
    width: 54,
    height: 56,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  selectedItem: {
    backgroundColor: "#111715",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(236,190,103,0.72)",
    shadowColor: "#F0C671",
    shadowOpacity: 0.2,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  iconFrame: {
    width: 38,
    height: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  chitthiIconFrame: {
    height: 33,
  },
  icon: {
    opacity: 1,
  },
  selectedIcon: {
    tintColor: "#F0C671",
  },
  unselectedIcon: {
    opacity: 0.68,
  },
  label: {
    color: "#A8A8A8",
    fontSize: 9.5,
    lineHeight: 12,
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
