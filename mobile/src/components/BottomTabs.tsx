import React from "react";
import { Image, ImageSourcePropType, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { appAssets } from "../assets";
import { theme } from "../theme";

export type TabKey = "home" | "housing" | "services" | "activity" | "messenger" | "profile";

const tabs: Array<{
  key: TabKey;
  label: string;
  icon?: ImageSourcePropType;
  iconSize?: number;
  custom?: "home" | "services" | "activity";
}> = [
  { key: "home", label: "Home", custom: "home" },
  { key: "services", label: "Services", custom: "services" },
  { key: "activity", label: "Activity", custom: "activity" },
  { key: "messenger", label: "Fchat", icon: appAssets.fchat, iconSize: 31 },
  { key: "profile", label: "Account", icon: appAssets.profile, iconSize: 28 }
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
              {tab.icon ? (
                <Image
                  source={tab.icon}
                  style={[styles.iconImage, tab.iconSize ? { width: tab.iconSize, height: tab.iconSize } : null]}
                  resizeMode="contain"
                />
              ) : tab.custom === "home" ? (
                <HomeIcon active={isActive} />
              ) : tab.custom === "services" ? (
                <ServicesIcon active={isActive} />
              ) : (
                <ActivityIcon active={isActive} />
              )}
              {tab.key === "messenger" && unreadCount > 0 ? <Text style={styles.badge}>{unreadCount}</Text> : null}
            </View>
            <Text style={[styles.label, isActive && styles.activeLabel]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  const color = active ? theme.colors.text : theme.colors.muted;
  return (
    <View style={styles.homeIcon}>
      <View style={[styles.homeRoof, { borderBottomColor: color }]} />
      <View style={[styles.homeBody, { borderColor: color }]}>
        <View style={[styles.homeDoor, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

function ServicesIcon({ active }: { active: boolean }) {
  const color = active ? theme.colors.text : theme.colors.muted;
  return (
    <View style={styles.dotsGrid}>
      {Array.from({ length: 9 }).map((_, index) => (
        <View key={index} style={[styles.dot, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

function ActivityIcon({ active }: { active: boolean }) {
  const color = active ? theme.colors.text : theme.colors.muted;
  return (
    <View style={[styles.activityIcon, { borderColor: color }]}>
      <View style={[styles.activityLine, { backgroundColor: color }]} />
      <View style={[styles.activityLine, { backgroundColor: color }]} />
      <View style={[styles.activityShortLine, { backgroundColor: color }]} />
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
  homeIcon: {
    width: 25,
    height: 25,
    alignItems: "center",
    justifyContent: "flex-end"
  },
  homeRoof: {
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginBottom: -1
  },
  homeBody: {
    width: 17,
    height: 13,
    borderWidth: 2,
    borderTopWidth: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 1
  },
  homeDoor: {
    width: 5,
    height: 7,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2
  },
  dotsGrid: {
    width: 25,
    height: 25,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 3
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3
  },
  activityIcon: {
    width: 22,
    height: 24,
    borderWidth: 2,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingTop: 5,
    gap: 3
  },
  activityLine: {
    height: 2,
    borderRadius: 2
  },
  activityShortLine: {
    width: 8,
    height: 2,
    borderRadius: 2
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
