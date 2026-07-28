import React from "react";
import { Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { appAssets } from "../assets";
import { theme } from "../theme";

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
  { key: "messenger", label: "Fchat", icon: appAssets.fchat, iconWidth: 34, iconHeight: 25 },
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
                  { width: tab.iconWidth, height: tab.iconHeight },
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
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
    height: 64,
    backgroundColor: "rgba(25,25,25,0.96)",
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "#2e2e2f",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 6
  },
  item: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    minWidth: 48
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
    fontSize: 10,
    fontWeight: "800"
  },
  activeLabel: {
    color: theme.colors.text
  },
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
