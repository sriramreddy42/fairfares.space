import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { createSecurityDepositCheckout, getStaffPickupBookings, reviewRentalHandoff, startStaffIdentityVerification } from "../api/client";
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

  async function reviewHandoff(booking: StaffPickupBooking, action: "APPROVE_PICKUP" | "APPROVE_RETURN" | "HOLD_RETURN" | "RECONCILE_OFFLINE_RETURN", reason = "") {
    setBusyBookingId(booking.id);
    try {
      const result = await reviewRentalHandoff(booking.id, action, "", reason);
      Alert.alert("Rental handoff", result.message);
      await refresh();
    } catch (error) {
      Alert.alert("Review could not be saved", error instanceof Error ? error.message : "Try again.");
    } finally {
      setBusyBookingId(null);
    }
  }

  function confirmOfflineReturn(booking: StaffPickupBooking) {
    const reason = "Vehicle was returned outside the app; the digital pickup and return inspection was not captured.";
    Alert.alert(
      "Record offline return?",
      `This records ${booking.carName} as returned without inspection evidence, makes it available, and releases the $${Number(booking.depositAmount || 250).toFixed(2)} authorization. The exception will be saved in the booking audit notes.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Record and release", style: "destructive", onPress: () => void reviewHandoff(booking, "RECONCILE_OFFLINE_RETURN", reason) },
      ],
    );
  }

  async function openIdentityVerification(booking: StaffPickupBooking) {
    setBusyBookingId(booking.id);
    try {
      const result = await startStaffIdentityVerification(booking.id);
      if (result.verified) {
        Alert.alert("Identity verified", result.message);
        await refresh();
        return;
      }
      if (!result.url || !(await Linking.canOpenURL(result.url))) throw new Error("Stripe did not return a valid identity verification link.");
      await Linking.openURL(result.url);
    } catch (error) {
      Alert.alert("Identity verification unavailable", error instanceof Error ? error.message : "Could not open Stripe Identity.");
    } finally {
      setBusyBookingId(null);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backButton}><Text style={styles.backText}>‹</Text></TouchableOpacity>
        <View style={styles.flex}><Text style={styles.eyebrow}>STAFF WORKSPACE</Text><Text style={styles.title}>Rental handoffs</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.text} />}>
        <View style={[styles.statusCard, configured ? styles.statusReady : styles.statusBlocked]}>
          <Text style={styles.statusTitle}>{configured ? "Pickup and return review" : "Stripe setup required"}</Text>
          <Text style={styles.body}>Review customer-submitted condition evidence before releasing a vehicle or accepting its return.</Text>
        </View>
        {pickups.map((booking) => {
          const depositAmount = Number(booking.depositAmount || 250);
          const authorized = booking.depositStatus === "AUTHORIZED";
          const busy = busyBookingId === booking.id;
          const pickupSubmitted = booking.bookingStatus === "PICKUP_SUBMITTED";
          const returnSubmitted = booking.bookingStatus === "RETURN_SUBMITTED";
          const returnHeld = booking.returnReviewStatus === "CHARGES_PENDING";
          const identityVerified = booking.identityStatus === "VERIFIED";
          return (
            <View key={booking.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}><Text style={styles.bookingId}>{booking.bookingId}</Text><Text style={styles.cardTitle}>{booking.carName}</Text></View>
                <View style={[styles.badge, (authorized || pickupSubmitted || returnSubmitted) && styles.badgeReady]}><Text style={styles.badgeText}>{booking.bookingStatus.replaceAll("_", " ")}</Text></View>
              </View>
              <Text style={styles.body}>{booking.customerName} · {booking.customerEmail}</Text>
              <Text style={styles.body}>{booking.pickupDate} · {booking.pickupTime}</Text>
              <Text style={styles.amount}>${depositAmount.toFixed(2)} refundable authorization hold</Text>
              <View style={[styles.identityCard, identityVerified && styles.identityCardVerified]}>
                <Text style={styles.identityTitle}>{booking.identityTitle || (identityVerified ? "Identity verified" : "Identity verification required")}</Text>
                <Text style={styles.body}>{booking.identityMessage || "Verify the customer's driving license and selfie before vehicle release."}</Text>
                {!identityVerified && booking.bookingStatus !== "PICKED_UP" && booking.bookingStatus !== "RETURN_SUBMITTED" ? (
                  <TouchableOpacity style={[styles.identityButton, busy && styles.disabled]} disabled={busy} onPress={() => void openIdentityVerification(booking)}>
                    <Text style={styles.identityButtonText}>Start Stripe Identity</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {pickupSubmitted ? <>
                <Text style={styles.body}>{booking.pickupEvidenceComplete ? "Pickup evidence complete" : "Pickup evidence incomplete"}</Text>
                <TouchableOpacity style={[styles.payButton, (busy || !booking.pickupEvidenceComplete || !identityVerified) && styles.disabled]} disabled={busy || !booking.pickupEvidenceComplete || !identityVerified} onPress={() => void reviewHandoff(booking, "APPROVE_PICKUP")}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.payButtonText}>Approve vehicle release</Text>}
                </TouchableOpacity>
              </> : returnSubmitted ? <>
                <Text style={styles.body}>{returnHeld ? "Held for damage or charge review. Complete the review in the admin workspace." : booking.returnEvidenceComplete ? "Return evidence complete" : "Return evidence incomplete"}</Text>
                {!returnHeld ? <View style={styles.reviewActions}>
                  <TouchableOpacity style={[styles.payButton, styles.reviewButton, (busy || !booking.returnEvidenceComplete) && styles.disabled]} disabled={busy || !booking.returnEvidenceComplete} onPress={() => void reviewHandoff(booking, "APPROVE_RETURN")}><Text style={styles.payButtonText}>Approve return</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.holdButton, styles.reviewButton, busy && styles.disabled]} disabled={busy} onPress={() => void reviewHandoff(booking, "HOLD_RETURN")}><Text style={styles.payButtonText}>Hold for review</Text></TouchableOpacity>
                </View> : null}
              </> : booking.bookingStatus === "CONFIRMED" ? (
                authorized ? <>
                  <View style={styles.waitingCard}><Text style={styles.identityTitle}>Waiting for pickup inspection</Text><Text style={styles.body}>The renter has not submitted the digital vehicle handoff.</Text></View>
                  <TouchableOpacity style={[styles.holdButton, busy && styles.disabled]} disabled={busy} onPress={() => confirmOfflineReturn(booking)}>
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.payButtonText}>Record offline return</Text>}
                  </TouchableOpacity>
                </> : <TouchableOpacity style={[styles.payButton, (busy || !configured) && styles.disabled]} disabled={busy || !configured} onPress={() => void openDepositCheckout(booking)}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.payButtonText}>Open secure deposit checkout</Text>}
                </TouchableOpacity>
              ) : <Text style={styles.body}>Rental active. Waiting for the customer to submit the return.</Text>}
            </View>
          );
        })}
        {!refreshing && pickups.length === 0 ? <View style={styles.centerCard}><Text style={styles.cardTitle}>No handoffs awaiting action</Text><Text style={styles.body}>Paid pickups and active return reviews appear here.</Text></View> : null}
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
  payButton: { minHeight: 50, borderRadius: 999, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center", marginTop: 4 }, payButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" }, disabled: { opacity: 0.5 },
  waitingCard: { borderRadius: 14, padding: 12, gap: 4, backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" },
  identityCard: { borderRadius: 14, borderWidth: 1, borderColor: "rgba(245,158,11,0.45)", backgroundColor: "rgba(245,158,11,0.10)", padding: 11, gap: 6 },
  identityCardVerified: { borderColor: "rgba(34,197,94,0.45)", backgroundColor: "rgba(34,197,94,0.10)" },
  identityTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "800" },
  identityButton: { minHeight: 42, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  identityButtonText: { color: theme.colors.brand, fontSize: 13, fontWeight: "800" },
  reviewActions: { flexDirection: "row", gap: 8 }, reviewButton: { flex: 1 }, holdButton: { minHeight: 50, borderRadius: 999, backgroundColor: "#a16207", alignItems: "center", justifyContent: "center", marginTop: 4 }
});
