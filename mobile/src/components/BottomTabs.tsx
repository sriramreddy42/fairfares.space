import React, { useEffect, useRef } from "react";
import { Animated, Image, ImageSourcePropType, StyleSheet, Text, useColorScheme, View } from "react-native";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { FairFaresUser } from "../types";
import { AdaptiveGlassView } from "./AdaptiveGlassView";
import { TactilePressable } from "./TactilePressable";
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
  compact?: boolean;
  appearance?: "light" | "dark";
};

function visibleActiveTab(active: TabKey): VisibleTabKey {
  if (active === "housing") return "home";
  if (active === "gas") return "community";
  return active;
}

export function BottomTabs({ active, unreadCount, user, onChange, hidden = false, compact = false, appearance }: Props) {
  const layout = useResponsiveLayout();
  const systemColorScheme = useColorScheme();
  const colorScheme = appearance || systemColorScheme;
  const housingScale = useRef(new Animated.Value(1)).current;
  const compactMotion = useRef(new Animated.Value(compact ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(compactMotion, {
      toValue: compact ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [compact, compactMotion]);

  if (hidden) return null;

  const selected = visibleActiveTab(active);

  return (
    <>
    <View
      pointerEvents="none"
      style={[
        styles.systemNavigationSurface,
        colorScheme === "light" && styles.systemNavigationSurfaceLight,
        { height: layout.systemBottomInset },
      ]}
    />
    <Animated.View
      style={[
        styles.card,
        colorScheme === "light" && styles.cardLight,
        colorScheme !== "light" && styles.cardDark,
        {
          bottom: compactMotion.interpolate({
            inputRange: [0, 1],
            // Let the floating surface sit into the safe-area visual region;
            // controls remain above the home indicator while the dock reads
            // as anchored to the bottom edge rather than hovering over content.
            outputRange: [Math.max(6, layout.navBottomInset - 10), 5],
          }),
          height: compactMotion.interpolate({
            inputRange: [0, 1],
            outputRange: [68 + layout.navVisualOverlap, 52 + layout.navVisualOverlap],
          }),
        },
        layout.isTablet
          ? { width: layout.navWidth, alignSelf: "center" }
          : { left: BOTTOM_NAV_HORIZONTAL_MARGIN, right: BOTTOM_NAV_HORIZONTAL_MARGIN }
      ]}
      accessibilityRole="tablist"
    >
      <View pointerEvents="none" style={[styles.glassClip, colorScheme === "light" && styles.glassClipLight, colorScheme !== "light" && styles.glassClipDark]}>
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
      <View style={[styles.itemsRow, { paddingBottom: layout.navVisualOverlap }]}>
        {navigationItems.map((item) => {
          const isSelected = selected === item.key;
          return (
            <TactilePressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: isSelected }}
              pressScale={item.key === "community" ? 0.93 : 0.96}
              onPress={() => {
                onChange(item.key);
                if (item.key !== "home") return;
                housingScale.stopAnimation();
                housingScale.setValue(1);
                Animated.sequence([
                  // The dock also animates its height and labels on scroll,
                  // so keep this small tab feedback on the JS driver too.
                  // Mixing drivers on the same navigation tree crashes iOS.
                  Animated.timing(housingScale, { toValue: 1.16, duration: 130, useNativeDriver: false }),
                  Animated.spring(housingScale, { toValue: 1, friction: 4, tension: 150, useNativeDriver: false }),
                ]).start();
              }}
              style={[styles.touchTarget, item.key === "community" && styles.centerTouchTarget]}
            >
              <Animated.View style={[
                styles.itemContent,
                item.key === "community" && styles.centerItemContent,
                {
                  transform: [
                    { scale: item.key === "home" ? housingScale : 1 },
                    { translateY: compactMotion.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) },
                  ],
                },
              ]}>
                <Animated.View style={[
                  styles.iconFrame,
                  item.key === "community" && styles.centerIconFrame,
                  isSelected && styles.selectedItem,
                  item.key === "community" && isSelected && styles.selectedCenterItem,
                  item.key === "community" && {
                    transform: [{ scale: compactMotion.interpolate({ inputRange: [0, 1], outputRange: [1, 0.76] }) }],
                  },
                ]}>
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
                </Animated.View>
                <Animated.Text
                  numberOfLines={1}
                  style={[
                    styles.label,
                    isSelected && styles.selectedLabel,
                    item.key === "community" && styles.centerLabel,
                    {
                      opacity: compactMotion.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0.08, 0] }),
                      maxHeight: compactMotion.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
                      marginTop: compactMotion.interpolate({ inputRange: [0, 1], outputRange: [3, 0] }),
                    },
                  ]}
                >{item.label}</Animated.Text>
              </Animated.View>
            </TactilePressable>
          );
        })}
      </View>
    </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  systemNavigationSurface: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
  },
  systemNavigationSurfaceLight: {
    backgroundColor: "#f3f4f6",
  },
  card: {
    position: "absolute",
    borderRadius: 31,
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
  cardDark: { borderWidth: 0, backgroundColor: "#000000", shadowOpacity: 0.48, shadowRadius: 18 },
  glassClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 31,
    overflow: "hidden",
    // Native blur/liquid-glass can produce its first sampled frame only after
    // the underlying scroll view invalidates. Paint the stable material color
    // immediately so launch never exposes page content through an empty glass
    // surface; the native effect then enhances this base when ready.
    backgroundColor: theme.colors.panel,
  },
  glassClipLight: { backgroundColor: "rgba(255,255,255,0.96)" },
  glassClipDark: { backgroundColor: "#000000" },
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
    width: 58,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
  },
  centerItemContent: {
    height: 64,
    justifyContent: "center",
    paddingTop: 0,
  },
  selectedItem: {
    borderRadius: 20,
    backgroundColor: "rgba(37,61,52,0.82)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(38,201,144,0.54)",
    shadowColor: theme.colors.brand,
    shadowOpacity: 0.2,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  iconFrame: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  centerIconFrame: {
    width: 48,
    height: 48,
    marginTop: -14,
    borderRadius: 24,
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
    borderRadius: 24,
    backgroundColor: "#28c997",
    borderColor: "rgba(224,255,243,0.75)",
  },
  label: {
    color: theme.colors.muted,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  selectedLabel: { color: theme.colors.brand },
  centerLabel: { color: theme.colors.brand, marginTop: -1 },
  icon: {
    opacity: 1,
  },
  glyph: {
    color: theme.colors.muted,
    fontSize: 19,
    fontWeight: "700",
    width: 27,
    height: 27,
    lineHeight: 27,
    textAlign: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  centerGlyph: {
    width: 32,
    height: 32,
    lineHeight: 30,
    borderRadius: 16,
    borderWidth: 0,
    color: "#06291e",
    fontSize: 28,
    fontWeight: "700",
  },
  selectedGlyph: {
    color: theme.colors.brand,
    borderColor: theme.colors.brand,
  },
  selectedCenterGlyph: {
    color: "#06291e",
    borderColor: "transparent",
  },
  selectedIcon: {
    tintColor: theme.colors.brand,
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
    borderColor: theme.colors.brand,
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
    fontWeight: "700",
  },
});
