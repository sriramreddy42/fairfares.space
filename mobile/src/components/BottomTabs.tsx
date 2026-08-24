import React, { useRef } from "react";
import { Animated, Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { FairFaresUser } from "../types";
import { AdaptiveGlassView } from "./AdaptiveGlassView";
import { UserAvatar } from "./UserAvatar";
import {
  BOTTOM_NAV_HORIZONTAL_MARGIN,
  useResponsiveLayout,
} from "../utils/layout";

export type TabKey = "home" | "housing" | "community" | "services" | "activity" | "messenger" | "profile";

type VisibleTabKey = Exclude<TabKey, "housing">;

type NavigationItem = {
  key: VisibleTabKey;
  label: string;
  icon?: ImageSourcePropType;
  glyph?: string;
  width: number;
  height: number;
};

const navigationItems: NavigationItem[] = [
  { key: "home", label: "Housing", icon: appAssets.navHome, width: 25, height: 25 },
  { key: "activity", label: "Activity", icon: appAssets.navActivity, width: 25, height: 25 },
  { key: "community", label: "Ask", glyph: "+", width: 30, height: 30 },
  { key: "messenger", label: "Chitthi", icon: appAssets.chittiMascot, width: 31, height: 35 },
  { key: "profile", label: "Account", icon: appAssets.profile, width: 25, height: 25 },
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
  const housingScale = useRef(new Animated.Value(1)).current;

  if (hidden) return null;

  const selected = visibleActiveTab(active);

  return (
    <View
      style={[
        styles.card,
        { bottom: layout.navBottomInset },
        layout.isTablet
          ? { width: layout.navWidth, alignSelf: "center" }
          : { left: BOTTOM_NAV_HORIZONTAL_MARGIN, right: BOTTOM_NAV_HORIZONTAL_MARGIN }
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
              onPress={() => {
                onChange(item.key);
                if (item.key !== "home") return;
                housingScale.stopAnimation();
                housingScale.setValue(1);
                Animated.sequence([
                  Animated.timing(housingScale, { toValue: 1.16, duration: 130, useNativeDriver: true }),
                  Animated.spring(housingScale, { toValue: 1, friction: 4, tension: 150, useNativeDriver: true }),
                ]).start();
              }}
              style={[styles.touchTarget, item.key === "community" && styles.centerTouchTarget]}
            >
              <Animated.View style={[
                styles.itemContent,
                item.key === "community" && styles.centerItemContent,
                item.key === "home" && { transform: [{ scale: housingScale }] },
              ]}>
                <View style={[styles.iconFrame, item.key === "community" && styles.centerIconFrame, isSelected && styles.selectedItem, item.key === "community" && isSelected && styles.selectedCenterItem]}>
                  {item.key === "profile" && user?.profilePhotoUrl ? (
                    <UserAvatar
                      photoUrl={user.profilePhotoUrl}
                      style={[styles.profileAvatar, isSelected && styles.selectedProfileAvatar]}
                      imageStyle={styles.profileAvatarImage}
                    />
                  ) : item.glyph ? (
                    <Text style={[styles.glyph, item.key === "community" && styles.centerGlyph, isSelected && styles.selectedGlyph, item.key === "community" && isSelected && styles.selectedCenterGlyph]}>{item.glyph}</Text>
                  ) : (
                    <Image
                      source={item.icon!}
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
                <Text numberOfLines={1} style={[styles.label, item.key === "community" && styles.centerLabel, isSelected && styles.selectedLabel]}>
                  {item.label}
                </Text>
              </Animated.View>
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
  centerTouchTarget: {
    overflow: "visible",
  },
  itemContent: {
    width: 48,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  centerItemContent: {
    height: 70,
    justifyContent: "flex-start",
    paddingTop: 0,
  },
  selectedItem: {
    borderRadius: 20,
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
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  centerIconFrame: {
    width: 54,
    height: 54,
    marginTop: -13,
    borderRadius: 27,
    backgroundColor: theme.colors.brand,
    borderWidth: 3,
    borderColor: "#111715",
    shadowColor: theme.colors.brand,
    shadowOpacity: 0.34,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  selectedCenterItem: {
    borderRadius: 27,
    backgroundColor: "#28c997",
    borderColor: "#effff9",
  },
  icon: {
    opacity: 1,
  },
  glyph: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 19,
    fontWeight: "900",
    width: 27,
    height: 27,
    lineHeight: 27,
    textAlign: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.42)",
  },
  centerGlyph: {
    width: 36,
    height: 36,
    lineHeight: 33,
    borderRadius: 18,
    borderWidth: 0,
    color: "#06291e",
    fontSize: 31,
    fontWeight: "700",
  },
  selectedGlyph: {
    color: "#F0C671",
    borderColor: "#F0C671",
  },
  selectedCenterGlyph: {
    color: "#06291e",
    borderColor: "transparent",
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
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  centerLabel: {
    marginTop: 0,
    color: "#D8FFF0",
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
