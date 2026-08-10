import React, { useEffect, useRef, useState } from "react";
import { Animated, Image, ImageSourcePropType, LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { AdaptiveGlassView } from "./AdaptiveGlassView";

export type TabKey = "home" | "housing" | "services" | "activity" | "messenger" | "profile";

const tabs: Array<{
  key: TabKey;
  label: string;
  icon: ImageSourcePropType;
  iconWidth: number;
  iconHeight: number;
}> = [
  { key: "home", label: "Home", icon: appAssets.navHome, iconWidth: 25, iconHeight: 25 },
  { key: "services", label: "Services", icon: appAssets.navServices, iconWidth: 25, iconHeight: 25 },
  { key: "activity", label: "Activity", icon: appAssets.navActivity, iconWidth: 25, iconHeight: 25 },
  { key: "messenger", label: "Chitthi", icon: appAssets.chittiMascot, iconWidth: 33, iconHeight: 38 },
  { key: "profile", label: "Account", icon: appAssets.profile, iconWidth: 25, iconHeight: 25 }
];

type Props = {
  active: TabKey;
  unreadCount: number;
  onChange: (tab: TabKey) => void;
  hidden?: boolean;
};

export function BottomTabs({ active, unreadCount, onChange, hidden = false }: Props) {
  const [barWidth, setBarWidth] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorStretch = useRef(new Animated.Value(1)).current;
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.key === active));

  useEffect(() => {
    if (!barWidth) return;
    const slotWidth = (barWidth - 12) / tabs.length;
    const targetX = 6 + slotWidth * activeIndex + (slotWidth - 64) / 2;
    Animated.parallel([
      Animated.spring(indicatorX, {
        toValue: targetX,
        damping: 18,
        stiffness: 155,
        mass: 0.72,
        useNativeDriver: true
      }),
      Animated.sequence([
        Animated.timing(indicatorStretch, { toValue: 1.28, duration: 110, useNativeDriver: true }),
        Animated.spring(indicatorStretch, { toValue: 1, damping: 12, stiffness: 190, useNativeDriver: true })
      ])
    ]).start();
  }, [activeIndex, barWidth, indicatorStretch, indicatorX]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setBarWidth(width);
    const slotWidth = (width - 12) / tabs.length;
    indicatorX.setValue(6 + slotWidth * activeIndex + (slotWidth - 64) / 2);
  };

  if (hidden) {
    return null;
  }

  return (
    <AdaptiveGlassView style={[styles.bar, active === "messenger" && styles.chittiBar]} tintColor={active === "messenger" ? "#08281C" : "#171918"} fallbackColor={active === "messenger" ? "rgba(3,16,15,0.97)" : "rgba(25,25,25,0.96)"} interactive onLayout={handleLayout}>
      {barWidth > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.indicatorMotion, { transform: [{ translateX: indicatorX }, { scaleX: indicatorStretch }] }]}>
          <AdaptiveGlassView
            style={[styles.liquidIndicator, active === "messenger" && styles.chittiIndicator]}
            tintColor={active === "messenger" ? "#17653C" : "#FFFFFF"}
            fallbackColor={active === "messenger" ? "rgba(24,111,61,0.68)" : "rgba(255,255,255,0.13)"}
            intensity={72}
          />
        </Animated.View>
      ) : null}
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity key={tab.key} style={styles.item} onPress={() => onChange(tab.key)}>
            <View style={[styles.icon, tab.key === "messenger" && styles.chittiIcon]}>
              <Image
                source={tab.icon}
                style={[
                  styles.iconImage,
                  { width: tab.iconWidth, height: tab.iconHeight },
                  !isActive && styles.inactiveIcon,
                  active === "messenger" && tab.key !== "messenger" && styles.chittiNavIcon
                ]}
                resizeMode="contain"
              />
              {tab.key === "messenger" && unreadCount > 0 ? <Text style={styles.badge}>{unreadCount}</Text> : null}
            </View>
            <Text style={[styles.label, active === "messenger" && styles.chittiLabel, isActive && styles.activeLabel, isActive && tab.key === "messenger" && styles.chittiActiveLabel]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </AdaptiveGlassView>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    height: 72,
    backgroundColor: "transparent",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2e2e2f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 6,
    overflow: "hidden"
  },
  chittiBar: {
    backgroundColor: "transparent",
    borderColor: "rgba(220,171,84,0.26)"
  },
  item: {
    width: 60,
    height: 60,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    zIndex: 1
  },
  indicatorMotion: {
    position: "absolute",
    left: 0,
    top: 9,
    width: 64,
    height: 54
  },
  liquidIndicator: {
    flex: 1,
    borderRadius: 19,
    backgroundColor: "transparent",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.22)",
    overflow: "hidden"
  },
  chittiIndicator: {
    borderColor: "rgba(91,211,118,0.40)"
  },
  icon: {
    width: 38,
    height: 26,
    alignItems: "center",
    justifyContent: "center"
  },
  chittiIcon: { height: 34 },
  activeIcon: {},
  iconImage: {
    width: 23,
    height: 23
  },
  inactiveIcon: {
    opacity: 0.72
  },
  chittiNavIcon: { tintColor: "#e4b45f", opacity: 0.9 },
  label: {
    color: theme.colors.muted,
    fontSize: 10,
    fontWeight: "800"
  },
  activeLabel: {
    color: theme.colors.text
  },
  chittiLabel: { color: "#d6a95c", fontWeight: "600" },
  chittiActiveLabel: { color: "#f0c671", fontSize: 9 },
  badge: {
    position: "absolute",
    top: -7,
    right: -7,
    backgroundColor: theme.colors.accent,
    color: theme.colors.text,
    borderRadius: 10,
    minWidth: 16,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden"
  }
});
