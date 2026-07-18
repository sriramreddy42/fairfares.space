import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, ImageSourcePropType, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getRentalBookings, requestRentalCancellation } from "../api/client";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { Car, RentalSearchInput, RentalServiceBooking, ServiceItem } from "../types";

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

function bookingTitle(booking: RentalServiceBooking | null) {
  if (!booking) return "Select rental booking";
  return `${booking.carName || "Rental car"} - ${booking.pickupDate || "Pickup pending"}`;
}

function appendManageTarget(url: string, agent: string, hash: string) {
  if (!url) return "";
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}agent=${encodeURIComponent(agent)}#${hash}`;
}

export function ServicesScreen(_props: Props) {
  const [bookings, setBookings] = useState<RentalServiceBooking[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [bookingMenuOpen, setBookingMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadBookings() {
    setBusy(true);
    setError("");
    try {
      const rows = await getRentalBookings();
      setBookings(rows);
      setSelectedBookingId((current) => current || rows[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load rental bookings.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadBookings();
  }, []);

  const selectedBooking = useMemo(
    () => bookings.find((booking) => booking.id === selectedBookingId) || bookings[0] || null,
    [bookings, selectedBookingId]
  );

  function requireBooking(action: (booking: RentalServiceBooking) => void) {
    if (!selectedBooking) {
      Alert.alert("Choose a booking", "Select one of your rental car bookings first.");
      return;
    }
    action(selectedBooking);
  }

  function openManage(agent: string, hash: string) {
    requireBooking((booking) => {
      const url = appendManageTarget(booking.manageUrl, agent, hash);
      if (!url) {
        Alert.alert("Booking link unavailable", "This booking does not have a manage-booking link yet.");
        return;
      }
      void Linking.openURL(url);
    });
  }

  function cancelSelectedBooking() {
    requireBooking((booking) => {
      Alert.alert(
        "Cancel reservation",
        `Send a cancellation request for ${booking.carName}?`,
        [
          { text: "Keep booking", style: "cancel" },
          {
            text: "Request cancel",
            style: "destructive",
            onPress: async () => {
              setBusy(true);
              try {
                const result = await requestRentalCancellation(booking.id);
                Alert.alert("Cancellation request", result.message || "Request sent.");
                await loadBookings();
              } catch (cancelError) {
                Alert.alert("Could not cancel", cancelError instanceof Error ? cancelError.message : "Try again.");
              } finally {
                setBusy(false);
              }
            }
          }
        ]
      );
    });
  }

  const actions: ServiceAction[] = [
    {
      label: "Modify Reservation",
      icon: appAssets.serviceModify,
      onPress: () => openManage("modify", "modify")
    },
    {
      label: "Cancel Reservation",
      icon: appAssets.serviceCancel,
      onPress: cancelSelectedBooking
    },
    {
      label: "Download Invoice",
      icon: appAssets.serviceInvoice,
      primary: true,
      onPress: () => requireBooking((booking) => {
        if (booking.invoiceUrl) {
          void Linking.openURL(booking.invoiceUrl);
          return;
        }
        openManage("documents", "documents");
      })
    },
    {
      label: "View Details",
      icon: appAssets.serviceEye,
      onPress: () => requireBooking(() => setDetailsOpen(true))
    }
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Services</Text>
        <Text style={styles.title}>Rental Cars</Text>
        <Text style={styles.subtitle}>Select a booking, then manage changes, cancellation, invoice, or trip details.</Text>
      </View>

      <View style={styles.bookingPanel}>
        <Text style={styles.fieldLabel}>Rental booking</Text>
        <TouchableOpacity style={styles.bookingSelect} onPress={() => setBookingMenuOpen((open) => !open)} activeOpacity={0.82}>
          <View style={styles.bookingSelectText}>
            <Text style={styles.bookingTitle} numberOfLines={1}>{bookingTitle(selectedBooking)}</Text>
            <Text style={styles.bookingMeta} numberOfLines={1}>
              {selectedBooking ? `${selectedBooking.statusLabel} - ${selectedBooking.totalLabel}` : busy ? "Loading bookings..." : "Sign in and book a rental car first"}
            </Text>
          </View>
          <Text style={styles.chevron}>{bookingMenuOpen ? "up" : "down"}</Text>
        </TouchableOpacity>
        {bookingMenuOpen ? (
          <View style={styles.bookingMenu}>
            {bookings.length ? bookings.map((booking) => (
              <TouchableOpacity
                key={booking.id}
                style={[styles.bookingOption, selectedBooking?.id === booking.id && styles.selectedBookingOption]}
                onPress={() => {
                  setSelectedBookingId(booking.id);
                  setBookingMenuOpen(false);
                }}
              >
                <Text style={styles.bookingOptionTitle} numberOfLines={1}>{booking.carName}</Text>
                <Text style={styles.bookingOptionMeta} numberOfLines={1}>{booking.pickupDate} - {booking.returnDate} · {booking.statusLabel}</Text>
              </TouchableOpacity>
            )) : (
              <Text style={styles.emptyText}>{error || "No rental bookings found yet."}</Text>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.actionGrid}>
        {actions.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={[styles.actionButton, action.primary && styles.primaryAction]}
            onPress={action.onPress}
            activeOpacity={0.78}
          >
            <Image source={action.icon} style={styles.actionIcon} resizeMode="contain" />
            <Text style={styles.actionLabel} numberOfLines={2}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Modal visible={detailsOpen} transparent animationType="fade" onRequestClose={() => setDetailsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.detailsCard}>
            <View style={styles.detailsHeader}>
              <Text style={styles.detailsTitle}>Booking details</Text>
              <TouchableOpacity style={styles.closeButton} onPress={() => setDetailsOpen(false)}>
                <Text style={styles.closeText}>X</Text>
              </TouchableOpacity>
            </View>
            {selectedBooking ? (
              <View style={styles.detailsBody}>
                <Text style={styles.detailsCar}>{selectedBooking.carName}</Text>
                <Text style={styles.detailsLine}>Booking: {selectedBooking.id}</Text>
                <Text style={styles.detailsLine}>Status: {selectedBooking.statusLabel}</Text>
                <Text style={styles.detailsLine}>Payment: {selectedBooking.paymentLabel}</Text>
                <Text style={styles.detailsLine}>Pickup: {selectedBooking.pickupLocation}</Text>
                <Text style={styles.detailsLine}>{selectedBooking.pickupDate} at {selectedBooking.pickupTime}</Text>
                <Text style={styles.detailsLine}>Return: {selectedBooking.returnLocation}</Text>
                <Text style={styles.detailsLine}>{selectedBooking.returnDate} at {selectedBooking.returnTime}</Text>
                <View style={styles.amountGrid}>
                  <View style={styles.amountPill}>
                    <Text style={styles.amountLabel}>Total</Text>
                    <Text style={styles.amountValue}>{selectedBooking.totalLabel}</Text>
                  </View>
                  <View style={styles.amountPill}>
                    <Text style={styles.amountLabel}>Due pickup</Text>
                    <Text style={styles.amountValue}>{selectedBooking.dueAtPickupLabel}</Text>
                  </View>
                </View>
              </View>
            ) : (
              <Text style={styles.emptyText}>Select a booking first.</Text>
            )}
          </View>
        </View>
      </Modal>
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
    gap: 6
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
    fontSize: 48,
    fontWeight: "900"
  },
  subtitle: {
    color: theme.colors.muted,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21
  },
  bookingPanel: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(17,24,39,0.72)",
    padding: 14,
    gap: 10
  },
  fieldLabel: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  bookingSelect: {
    minHeight: 66,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  bookingSelectText: {
    flex: 1,
    gap: 4
  },
  bookingTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: "900"
  },
  bookingMeta: {
    color: theme.colors.muted,
    fontSize: 13,
    fontWeight: "800"
  },
  chevron: {
    color: theme.colors.accent,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  bookingMenu: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)"
  },
  bookingOption: {
    padding: 13,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    gap: 4
  },
  selectedBookingOption: {
    backgroundColor: "rgba(80,124,255,0.28)"
  },
  bookingOptionTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "900"
  },
  bookingOptionMeta: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  emptyText: {
    color: theme.colors.muted,
    fontSize: 14,
    fontWeight: "800",
    padding: 14
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
    paddingHorizontal: 12,
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
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    padding: 18
  },
  detailsCard: {
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(17,24,39,0.96)",
    padding: 18,
    gap: 14
  },
  detailsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  detailsTitle: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: "900"
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center"
  },
  closeText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  detailsBody: {
    gap: 8
  },
  detailsCar: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "900"
  },
  detailsLine: {
    color: theme.colors.muted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20
  },
  amountGrid: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8
  },
  amountPill: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.07)",
    padding: 12,
    gap: 4
  },
  amountLabel: {
    color: theme.colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  amountValue: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "900"
  }
});
