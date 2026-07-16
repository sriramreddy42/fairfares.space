import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { theme } from "../theme";

export type TabKey = "home" | "housing" | "services" | "messenger" | "profile";

const tabs: Array<{ key: TabKey; label: string; symbol: string }> = [
  { key: "home", label: "Home", symbol: "H" },
  { key: "housing", label: "Housing", symbol: "B" },
  { key: "services", label: "Services", symbol: "S" },
  { key: "messenger", label: "Chats", symbol: "M" },
  { key: "profile", label: "Profile", symbol: "P" }
];

type Props = {
  active: TabKey;
  unreadCount: number;
  onChange: (tab: TabKey) => void;
};

export function BottomTabs({ active, unreadCount, onChange }: Props) {
  return (
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity key={tab.key} style={[styles.item, isActive && styles.active]} onPress={() => onChange(tab.key)}>
            <View style={[styles.icon, isActive && styles.activeIcon]}>
              <Text style={[styles.symbol, isActive && styles.activeSymbol]}>{tab.symbol}</Text>
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
    left: 18,
    right: 18,
    bottom: 22,
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
    backgroundColor: theme.colors.panel2,
    borderRadius: 28,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  icon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center"
  },
  activeIcon: {
    backgroundColor: theme.colors.text,
    borderRadius: 16
  },
  symbol: {
    color: theme.colors.muted,
    fontWeight: "900"
  },
  activeSymbol: {
    color: theme.colors.bg
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
