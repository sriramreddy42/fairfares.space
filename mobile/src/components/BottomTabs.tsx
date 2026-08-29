import React, { useRef } from "react";
import { Animated, Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from "react-native";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { FairFaresUser } from "../types";
import { AdaptiveGlassView } from "./AdaptiveGlassView";
import { UserAvatar } from "./UserAvatar";
import {
  BOTTOM_NAV_HORIZONTAL_MARGIN,
  useResponsiveLayout,
} from "../utils/layout";

export type TabKey = "home" | "housing" | "community" | "gas" | "services" | "activity" | "messenger" | "profile";

type VisibleTabKey = Exclude<TabKey, "housing" | "gas">;

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
  if (active === "housing") return "home";
  if (active === "gas") return "community";
  return active;
}

export function BottomTabs({ active, unreadCount, user, onChange, hidden = false }: Props) {
  const layout = useResponsiveLayout();
  const colorScheme = useColorScheme();
  const housingScale = useRef(new Animated.Value(1)).current;

  if (hidden) return null;

  const selected = visibleActiveTab(active);

  return (
    <View
      style={[
        styles.card,
        colorScheme === "light" && styles.cardLight,
        { bottom: layout.navBottomInset },
        layout.isTablet
          ? { width: layout.navWidth, alignSelf: "center" }
          : { left: BOTTOM_NAV_HORIZONTAL_MARGIN, right: BOTTOM_NAV_HORIZONTAL_MARGIN }
      ]}
      accessibilityRole="tablist"
    >
      <View pointerEvents="none" style={[styles.glassClip, colorScheme === "light" && styles.glassClipLight]}>
        <AdaptiveGlassView
          style={StyleSheet.absoluteFill}
          intensity={72}
          tintColor={colorScheme === "light" ? "rgba(255,255,255,0.94)" : "rgba(24,29,27,0.72)"}
          fallbackColor={colorScheme === "light" ? "#ffffff" : "rgba(20,21,21,0.94)"}
          blurTint={colorScheme === "light" ? "light" : "dark"}
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
                        item.key !== "messenger" && !isSelected && styles.unselectedIcon,
                        item.key === "messenger" && !isSelected && styles.unselectedFullColorIcon,
                        item.key !== "messenger" && { tintColor: isSelected ? "#1877f2" : colorScheme === "light" ? "#65676b" : "#aaaab0" },
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
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.panel,
    shadowColor: "#000000",
    shadowOpacity: 0.42,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  cardLight: { borderColor: "rgba(15,23,42,0.10)", backgroundColor: "rgba(255,255,255,0.96)", shadowColor: "#101828", shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 8 },
  glassClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 35,
    overflow: "hidden",
    // Native blur/liquid-glass can produce its first sampled frame only after
    // the underlying scroll view invalidates. Paint the stable material color
    // immediately so launch never exposes page content through an empty glass
    // surface; the native effect then enhances this base when ready.
    backgroundColor: theme.colors.panel,
  },
  glassClipLight: { backgroundColor: "rgba(255,255,255,0.96)" },
  glassTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  glassTopHighlight: {
    position: "absolute",
    top: 1,
    left: 22,
    right: 22,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.line,
  },
  glassBottomShade: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 0,
    height: 20,
    borderRadius: 20,
    backgroundColor: "transparent",
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
    backgroundColor: theme.colors.panel2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.blue,
    shadowColor: theme.colors.blue,
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
    borderColor: theme.colors.panel,
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
    color: theme.colors.muted,
    fontSize: 19,
    fontWeight: "900",
    width: 27,
    height: 27,
    lineHeight: 27,
    textAlign: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.line,
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
    color: theme.colors.blue,
    borderColor: theme.colors.blue,
  },
  selectedCenterGlyph: {
    color: "#06291e",
    borderColor: "transparent",
  },
  selectedIcon: {
    tintColor: theme.colors.blue,
  },
  profileAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.line,
    opacity: 0.78,
  },
  selectedProfileAvatar: {
    borderColor: theme.colors.blue,
    opacity: 1,
  },
  profileAvatarImage: {
    width: "100%",
    height: "100%",
  },
  unselectedIcon: {
    opacity: 1,
    tintColor: theme.colors.muted,
  },
  unselectedFullColorIcon: { opacity: 0.82 },
  label: {
    color: theme.colors.muted,
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  centerLabel: {
    marginTop: 0,
    color: theme.colors.brand,
  },
  selectedLabel: {
    color: theme.colors.blue,
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
