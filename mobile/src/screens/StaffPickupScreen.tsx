import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { createSecurityDepositCheckout, getStaffPickupBookings } from "../api/client";
import { theme } from "../theme";
import { StaffPickupBooking } from "../types";

type Props = { onClose: () => void };

export function StaffPickupScreen({ onClose }: Props) {
  const [pickups, setPickups] = useState<StaffPickupBooking[]>([]);
  const [configured, setConfigured] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyBookingId, setBusyBookingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const payload = await getStaffPickupBookings();
      setPickups(payload.pickups || []);
      setConfigured(Boolean(payload.deposit.configured));
    } catch (error) {
      Alert.alert("Pickup list unavailable", error instanceof Error ? error.message : "Could not load confirmed pickups.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  async function openDepositCheckout(booking: StaffPickupBooking) {
    setBusyBookingId(booking.id);
    try {
      const checkout = await createSecurityDepositCheckout(booking.id);
      if (!checkout.url || !(await Linking.canOpenURL(checkout.url))) throw new Error("Stripe did not return a valid checkout link.");
      await Linking.openURL(checkout.url);
    } catch (error) {
      Alert.alert("Deposit checkout unavailable", error instanceof Error ? error.message : "Could not open Stripe checkout.");
    } finally {
      setBusyBookingId(null);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backButton}><Text style={styles.backText}>‹</Text></TouchableOpacity>
        <View style={styles.flex}><Text style={styles.eyebrow}>STAFF WORKSPACE</Text><Text style={styles.title}>Confirmed pickups</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.text} />}>
        <View style={[styles.statusCard, configured ? styles.statusReady : styles.statusBlocked]}>
          <Text style={styles.statusTitle}>{configured ? "Stripe deposit checkout ready" : "Stripe setup required"}</Text>
          <Text style={styles.body}>The customer authorizes the refundable hold using Stripe Checkout, card, Apple Pay, or Google Pay. Return here after checkout; the webhook updates the status.</Text>
        </View>
        {pickups.map((booking) => {
          const authorized = booking.depositStatus === "AUTHORIZED";
          const busy = busyBookingId === booking.id;
          return (
            <View key={booking.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}><Text style={styles.bookingId}>{booking.bookingId}</Text><Text style={styles.cardTitle}>{booking.carName}</Text></View>
                <View style={[styles.badge, authorized && styles.badgeReady]}><Text style={styles.badgeText}>{authorized ? "Authorized" : "Deposit needed"}</Text></View>
              </View>
              <Text style={styles.body}>{booking.customerName} · {booking.customerEmail}</Text>
              <Text style={styles.body}>{booking.pickupDate} · {booking.pickupTime}</Text>
              <Text style={styles.amount}>${booking.depositAmount.toFixed(2)} refundable authorization hold</Text>
              <TouchableOpacity style={[styles.payButton, (authorized || busy || !configured) && styles.disabled]} disabled={authorized || busy || !configured} onPress={() => void openDepositCheckout(booking)}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.payButtonText}>{authorized ? "Deposit authorized" : "Open secure Stripe checkout"}</Text>}
              </TouchableOpacity>
            </View>
          );
        })}
        {!refreshing && pickups.length === 0 ? <View style={styles.centerCard}><Text style={styles.cardTitle}>No confirmed pickups</Text><Text style={styles.body}>Only paid, confirmed bookings appear here.</Text></View> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg }, header: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.panel2 }, backText: { color: theme.colors.text, fontSize: 34, lineHeight: 38 },
  eyebrow: { color: "#4ade80", ...theme.typography.eyebrow }, title: { color: theme.colors.text, ...theme.typography.sectionTitle }, content: { padding: 14, paddingBottom: 48, gap: 12, width: "100%", maxWidth: 760, alignSelf: "center" },
  statusCard: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 7 }, statusReady: { backgroundColor: "rgba(21,128,61,0.18)", borderColor: "rgba(74,222,128,0.5)" }, statusBlocked: { backgroundColor: "rgba(127,29,29,0.18)", borderColor: "rgba(248,113,113,0.5)" }, statusTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  card: { ...theme.depth.card, padding: 14, gap: 8 }, centerCard: { margin: 14, ...theme.depth.card, padding: 20, gap: 8 }, rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }, flex: { flex: 1, minWidth: 0 },
  bookingId: { color: "#4ade80", fontSize: 11, letterSpacing: 0.5, fontWeight: "700" }, cardTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" }, body: { color: theme.colors.muted, fontSize: 13, lineHeight: 18 }, amount: { color: theme.colors.text, fontSize: 14, fontWeight: "700", marginTop: 3 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "rgba(245,158,11,0.18)", borderWidth: 1, borderColor: "rgba(245,158,11,0.45)" }, badgeReady: { backgroundColor: "rgba(34,197,94,0.18)", borderColor: "rgba(34,197,94,0.5)" }, badgeText: { color: theme.colors.text, fontSize: 10, fontWeight: "700" },
  payButton: { minHeight: 50, borderRadius: 999, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center", marginTop: 4 }, payButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" }, disabled: { opacity: 0.5 }
});
