import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";

const services = ["Car Rentals", "Housing", "Explorer", "Deals", "Events", "Local Services", "Jobs", "Care Services"];

export function ServicesScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionHeader eyebrow="More" title="FairFares services" />
      <View style={styles.grid}>
        {services.map((service) => (
          <TouchableOpacity key={service} style={styles.tile} onPress={() => Alert.alert(service, `${service} native flow will open here.`)}>
            <View style={styles.icon}><Text style={styles.iconText}>{service.slice(0, 2).toUpperCase()}</Text></View>
            <Text style={styles.label}>{service}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.md, paddingBottom: 126 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  tile: { width: "47%", backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.line, alignItems: "center", gap: 14 },
  icon: { width: 70, height: 70, borderRadius: theme.radius.md, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  iconText: { color: theme.colors.text, fontWeight: "900" },
  label: { color: theme.colors.text, fontWeight: "900", fontSize: 16, textAlign: "center" }
});
