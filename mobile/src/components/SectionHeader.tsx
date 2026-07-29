import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

type Props = {
  eyebrow?: string;
  title: string;
  action?: string;
};

export function SectionHeader({ eyebrow, title, action }: Props) {
  return (
    <View style={styles.row}>
      <View>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {action ? <Text style={styles.action}>{action}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: theme.spacing.sm
  },
  eyebrow: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase"
  },
  title: {
    color: theme.colors.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "700"
  },
  action: {
    color: theme.colors.soft,
    fontSize: 15,
    fontWeight: "600"
  }
});
