import React from "react";
import { Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
  if (hidden) {
    return null;
  }

  return (
    <AdaptiveGlassView style={[styles.bar, active === "messenger" && styles.chittiBar]} tintColor={active === "messenger" ? "#08281C" : "#171918"} fallbackColor={active === "messenger" ? "rgba(3,16,15,0.97)" : "rgba(25,25,25,0.96)"} interactive>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity key={tab.key} style={[styles.item, isActive && styles.activeItem, isActive && tab.key === "messenger" && styles.chittiItem]} onPress={() => onChange(tab.key)}>
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
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
    height: 64,
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
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderWidth: 1,
    borderColor: "transparent"
  },
  activeItem: {
    borderColor: "rgba(255,255,255,0.30)",
    backgroundColor: "rgba(255,255,255,0.11)",
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 }
  },
  chittiItem: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "rgba(18,92,49,0.78)",
    borderWidth: 1,
    borderColor: "rgba(79,195,94,0.44)",
    transform: [{ scale: 1.02 }],
    shadowColor: "#35d06f",
    shadowOpacity: 0.23,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5
  },
  active: {
    borderRadius: 28
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
