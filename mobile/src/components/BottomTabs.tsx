import React from "react";
import { Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { appAssets } from "../assets";
import { theme } from "../theme";

export type TabKey = "home" | "housing" | "services" | "activity" | "messenger" | "profile";

const tabs: Array<{
  key: TabKey;
  label: string;
  icon: ImageSourcePropType;
  iconSize?: number;
}> = [
  { key: "home", label: "Home", icon: appAssets.navHome, iconSize: 29 },
  { key: "services", label: "Services", icon: appAssets.navServices, iconSize: 30 },
  { key: "activity", label: "Activity", icon: appAssets.navActivity, iconSize: 30 },
  { key: "messenger", label: "Fchat", icon: appAssets.fchat, iconSize: 32 },
  { key: "profile", label: "Account", icon: appAssets.profile, iconSize: 30 }
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
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity key={tab.key} style={styles.item} onPress={() => onChange(tab.key)}>
            <View style={styles.icon}>
              <Image
                source={tab.icon}
                style={[
                  styles.iconImage,
                  tab.iconSize ? { width: tab.iconSize, height: tab.iconSize } : null,
                  !isActive && styles.inactiveIcon
                ]}
                resizeMode="contain"
              />
              {tab.key === "messenger" && unreadCount > 0 ? <Text style={styles.badge}>{unreadCount}</Text> : null}
            </View>
            <Text style={[styles.label, isActive && styles.activeLabel]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    marginHorizontal: 18,
    marginTop: 4,
    marginBottom: 14,
    height: 76,
    backgroundColor: "#191919",
    borderRadius: 36,
    borderWidth: 1,
    borderColor: "#2e2e2f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 8
  },
  item: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minWidth: 54
  },
  active: {
    borderRadius: 28
  },
  icon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center"
  },
  activeIcon: {},
  iconImage: {
    width: 23,
    height: 23
  },
  inactiveIcon: {
    opacity: 0.72
  },
  label: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: "800"
  },
  activeLabel: {
    color: theme.colors.text
  },
  badge: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: theme.colors.accent,
    color: theme.colors.text,
    borderRadius: 10,
    minWidth: 18,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden"
  }
});
