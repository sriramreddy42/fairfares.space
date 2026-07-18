import React from "react";
import { Alert, Image, ImageSourcePropType, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { Car, RentalSearchInput, ServiceItem } from "../types";

export type ServiceKey = "cars" | "deals" | "explorer" | "housing" | "local";

type Props = {
  cars: Car[];
  services: ServiceItem[];
  selected: ServiceKey;
  onSelect: (service: ServiceKey) => void;
  onOpenHousing: () => void;
  onBookCar: (car: Car, details?: Partial<RentalSearchInput>, paymentOption?: "hold" | "full") => void;
};

type ServiceAction = {
  label: string;
  icon: ImageSourcePropType;
  primary?: boolean;
  onPress: () => void;
};

export function ServicesScreen({ onOpenHousing }: Props) {
  const actions: ServiceAction[] = [
    {
      label: "Modify Reservation",
      icon: appAssets.serviceModify,
      onPress: () => Alert.alert("Modify reservation", "Request pickup date, return date, time, location, or vehicle changes from your rental booking.")
    },
    {
      label: "Cancel Reservation",
      icon: appAssets.serviceCancel,
      onPress: () => Alert.alert("Cancel reservation", "Cancellation requests are reviewed against pickup cutoff, payment status, no-show rules, and discount conditions.")
    },
    {
      label: "Download Invoice",
      icon: appAssets.serviceInvoice,
      primary: true,
      onPress: () => Alert.alert("Download invoice", "Invoice and receipt documents become available after payment confirmation.")
    },
    {
      label: "View Details",
      icon: appAssets.serviceEye,
      onPress: () => Alert.alert("View details", "Open the selected rental booking details, pickup instructions, payment status, and trip timing.")
    },
    {
      label: "Housing",
      icon: appAssets.serviceHome,
      onPress: onOpenHousing
    },
    {
      label: "Support Center",
      icon: appAssets.serviceSupport,
      onPress: () => Alert.alert("Support center", "FairFares support can help with pickup questions, payment status, document review, and rental changes.")
    }
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Services</Text>
        <Text style={styles.title}>Rental support</Text>
      </View>
      <View style={styles.actionGrid}>
        {actions.map((action, index) => (
          <TouchableOpacity
            key={`${action.label}-${index}`}
            style={[styles.actionButton, action.primary && styles.primaryAction]}
            onPress={action.onPress}
            activeOpacity={0.78}
          >
            <Image source={action.icon} style={styles.actionIcon} resizeMode="contain" />
            <Text style={styles.actionLabel} numberOfLines={2}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: 132,
    gap: 18
  },
  header: {
    gap: 4
  },
  eyebrow: {
    color: theme.colors.accent,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase"
  },
  title: {
    color: theme.colors.text,
    fontSize: 36,
    fontWeight: "900"
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14
  },
  actionButton: {
    width: "48%",
    minHeight: 132,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(17,24,39,0.82)",
    paddingHorizontal: 14,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.36,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 }
  },
  primaryAction: {
    backgroundColor: theme.colors.accent,
    borderColor: "rgba(255,255,255,0.26)",
    shadowColor: theme.colors.accent,
    shadowOpacity: 0.52
  },
  actionIcon: {
    width: 44,
    height: 44
  },
  actionLabel: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center"
  }
});
