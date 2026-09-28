import React, { useCallback, useEffect, useState } from "react";
import * as ImageManipulator from "expo-image-manipulator";
import { ActivityIndicator, Alert, AppState, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { getStaffPickupBookings, reviewRentalHandoff, startStaffIdentityVerification, submitStaffHandoffInspection } from "../api/client";
import { theme } from "../theme";
import { StaffPickupBooking } from "../types";
import { takeChatPhoto } from "../utils/imageUpload";

type Props = { onClose: () => void };
type PhotoKey = "front" | "back" | "left" | "right" | "odometer" | "fuel" | "interiorFront" | "interiorRear";
const photoSteps: Array<{ key: PhotoKey; label: string }> = [{ key: "front", label: "Front" }, { key: "back", label: "Rear" }, { key: "left", label: "Driver" }, { key: "right", label: "Passenger" }, { key: "odometer", label: "Odometer" }, { key: "fuel", label: "Fuel" }, { key: "interiorFront", label: "Front interior" }, { key: "interiorRear", label: "Rear / cargo" }];
const emptyPhotos = (): Record<PhotoKey, string> => ({ front: "", back: "", left: "", right: "", odometer: "", fuel: "", interiorFront: "", interiorRear: "" });

export function StaffPickupScreen({ onClose }: Props) {
  const [pickups, setPickups] = useState<StaffPickupBooking[]>([]);
  const [configured, setConfigured] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyBookingId, setBusyBookingId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [bookingLookup, setBookingLookup] = useState("");
  const [lookupDetail, setLookupDetail] = useState("");
  const [inspection, setInspection] = useState<{ booking: StaffPickupBooking; phase: "pickup" | "return" } | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const payload = await getStaffPickupBookings(bookingLookup);
      setPickups(payload.pickups || []);
      setLookupDetail(payload.lookup ? `${payload.lookup.bookingId}: ${payload.lookup.found ? `${payload.lookup.status} / ${payload.lookup.paymentStatus} · Deposit ${payload.lookup.depositStatus} · Return review ${payload.lookup.returnReviewStatus}` : "No database record"}` : "");
      setConfigured(Boolean(payload.deposit.configured));
    } catch (error) {
      Alert.alert("Pickup list unavailable", error instanceof Error ? error.message : "Could not load confirmed pickups.");
    } finally {
      setRefreshing(false);
    }
  }, [bookingLookup]);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

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

  function openInspection(booking: StaffPickupBooking, phase: "pickup" | "return") {
    setInspection({ booking, phase });
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
      if (!result.requested) throw new Error(result.message || "Stripe could not prepare identity verification.");
      Alert.alert("Identity verification requested", result.message);
      await refresh();
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
        <View style={styles.searchRow}>
          <TextInput style={styles.searchInput} value={searchText} onChangeText={setSearchText} placeholder="Booking number" placeholderTextColor={theme.colors.muted} autoCapitalize="characters" returnKeyType="search" onSubmitEditing={() => setBookingLookup(searchText.trim().toUpperCase())} />
          <TouchableOpacity style={styles.searchButton} onPress={() => setBookingLookup(searchText.trim().toUpperCase())}><Text style={styles.searchButtonText}>Find</Text></TouchableOpacity>
        </View>
        <View style={[styles.statusCard, configured ? styles.statusReady : styles.statusBlocked]}>
          <Text style={styles.statusTitle}>{configured ? "Pickup and return review" : "Stripe setup required"}</Text>
          <Text style={styles.body}>Request renter identity verification, then record the staff pickup inspection before releasing a vehicle. Review customer return evidence at the end of the rental.</Text>
        </View>
        {pickups.map((booking) => {
          const depositAmount = Number(booking.depositAmount || 250);
          const authorized = booking.depositStatus === "AUTHORIZED";
          const busy = busyBookingId === booking.id;
          const pickupSubmitted = booking.bookingStatus === "PICKUP_SUBMITTED";
          const returnSubmitted = booking.bookingStatus === "RETURN_SUBMITTED";
          const returnHeld = booking.returnReviewStatus === "CHARGES_PENDING";
          const identityVerified = booking.identityStatus === "VERIFIED";
          const offlineReturnEligible = Boolean(booking.offlineReturnEligible);
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
                    <Text style={styles.identityButtonText}>Request Stripe Identity</Text>
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
                booking.paymentStatus !== "PAID" ? <View style={styles.waitingCard}><Text style={styles.identityTitle}>Waiting for full rental payment</Text><Text style={styles.body}>The reservation hold does not permit vehicle release.</Text></View>
                  : identityVerified ? <TouchableOpacity style={styles.payButton} onPress={() => openInspection(booking, "pickup")}><Text style={styles.payButtonText}>Start pickup inspection</Text></TouchableOpacity>
                    : <View style={styles.waitingCard}><Text style={styles.identityTitle}>Waiting for renter identity verification</Text><Text style={styles.body}>Request Stripe Identity, then have the renter complete the secure check on their phone.</Text></View>
              ) : booking.bookingStatus === "PICKED_UP" ? <TouchableOpacity style={styles.payButton} onPress={() => openInspection(booking, "return")}><Text style={styles.payButtonText}>Start return inspection</Text></TouchableOpacity> : <Text style={styles.body}>Rental active. Waiting for the scheduled return.</Text>}
              {offlineReturnEligible ? <TouchableOpacity style={[styles.offlineReturnButton, busy && styles.disabled]} disabled={busy} onPress={() => confirmOfflineReturn(booking)}>
                <Text style={styles.offlineReturnButtonText}>Record past offline return</Text>
              </TouchableOpacity> : null}
            </View>
          );
        })}
        {!refreshing && pickups.length === 0 ? <View style={styles.centerCard}><Text style={styles.cardTitle}>{bookingLookup ? "Booking not found in handoffs" : "No handoffs awaiting action"}</Text><Text style={styles.body}>{bookingLookup ? lookupDetail || "Check the booking number and status." : "Paid pickups and active return reviews appear here."}</Text></View> : null}
      </ScrollView>
      <InspectionModal inspection={inspection} onClose={() => setInspection(null)} onSaved={async () => { setInspection(null); await refresh(); }} />
    </View>
  );
}

function InspectionModal({ inspection, onClose, onSaved }: { inspection: { booking: StaffPickupBooking; phase: "pickup" | "return" } | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  const [odometer, setOdometer] = useState(""); const [fuel, setFuel] = useState("FULL"); const [customer, setCustomer] = useState(""); const [staff, setStaff] = useState("");
  const [condition, setCondition] = useState("ACCEPTABLE"); const [damage, setDamage] = useState("NO"); const [notes, setNotes] = useState(""); const [photos, setPhotos] = useState<Record<PhotoKey, string>>(emptyPhotos()); const [busy, setBusy] = useState(false);
  async function capture(key: PhotoKey) {
    const selected = await takeChatPhoto(1280, 0.62, 500_000); if (!selected) return;
    const source = await selected.preparation; const image = await ImageManipulator.manipulateAsync(source.uri, [{ resize: { width: 1280 } }], { compress: 0.62, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    if (image.base64) setPhotos((value) => ({ ...value, [key]: "data:image/jpeg;base64," + image.base64 }));
  }
  async function save() {
    if (!inspection) return;
    if (!date || !time || !odometer || !fuel || !customer || !staff || photoSteps.some(({ key }) => !photos[key])) { Alert.alert("Complete the inspection", "Date, time, odometer, fuel, both signatures, and all eight photos are required."); return; }
    if (inspection.phase === "return" && (condition !== "ACCEPTABLE" || damage !== "NO") && !notes) { Alert.alert("Add notes", "Add damage or issue notes before saving this return."); return; }
    setBusy(true);
    try { const result = await submitStaffHandoffInspection({ bookingId: inspection.booking.id, phase: inspection.phase, actualDate: date, actualTime: time, odometer, fuelLevel: fuel, customerSignature: customer, staffSignature: staff, photos, conditionStatus: condition, newDamageFound: damage, chargeNotes: notes }); Alert.alert("Inspection saved", result.message); await onSaved(); }
    catch (error) { Alert.alert("Could not save inspection", error instanceof Error ? error.message : "Try again."); } finally { setBusy(false); }
  }
  return <Modal visible={Boolean(inspection)} animationType="slide" onRequestClose={onClose}><View style={styles.screen}><View style={styles.header}><TouchableOpacity onPress={onClose} style={styles.backButton}><Text style={styles.backText}>‹</Text></TouchableOpacity><View style={styles.flex}><Text style={styles.eyebrow}>STAFF INSPECTION</Text><Text style={styles.title}>{inspection?.phase === "pickup" ? "Pickup and release" : "Return inspection"}</Text></View></View><ScrollView contentContainerStyle={styles.content}><TextInput style={styles.formInput} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" /><TextInput style={styles.formInput} value={time} onChangeText={setTime} placeholder="Time" /><TextInput style={styles.formInput} value={odometer} onChangeText={setOdometer} placeholder="Odometer" keyboardType="number-pad" /><TextInput style={styles.formInput} value={fuel} onChangeText={setFuel} placeholder="Fuel / charge level" /><TextInput style={styles.formInput} value={customer} onChangeText={setCustomer} placeholder="Renter signature" /><TextInput style={styles.formInput} value={staff} onChangeText={setStaff} placeholder="Staff signature" />{inspection?.phase === "return" ? <><TextInput style={styles.formInput} value={condition} onChangeText={setCondition} placeholder="Condition: ACCEPTABLE / DAMAGE_NOTED" /><TextInput style={styles.formInput} value={damage} onChangeText={setDamage} placeholder="New damage: NO / YES" /><TextInput style={[styles.formInput, styles.notes]} value={notes} onChangeText={setNotes} multiline placeholder="Damage or issue notes" /></> : null}<Text style={styles.sectionTitle}>Required vehicle photos</Text><View style={styles.photoGrid}>{photoSteps.map(({ key, label }) => <TouchableOpacity key={key} style={[styles.photoButton, photos[key] && styles.photoSaved]} onPress={() => void capture(key)}><Text style={styles.photoText}>{photos[key] ? "✓ " + label : label}</Text></TouchableOpacity>)}</View><TouchableOpacity style={styles.payButton} disabled={busy} onPress={() => void save()}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.payButtonText}>Save {inspection?.phase} inspection</Text>}</TouchableOpacity></ScrollView></View></Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg }, header: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.line },
  searchRow: { flexDirection: "row", gap: 8 }, searchInput: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.line, color: theme.colors.text, paddingHorizontal: 14 }, searchButton: { minWidth: 68, borderRadius: 12, backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center" }, searchButtonText: { color: "#fff", fontWeight: "700" },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.panel2 }, backText: { color: theme.colors.text, fontSize: 34, lineHeight: 38 },
  eyebrow: { color: "#4ade80", ...theme.typography.eyebrow }, title: { color: theme.colors.text, ...theme.typography.sectionTitle }, content: { padding: 14, paddingBottom: 48, gap: 12, width: "100%", maxWidth: 760, alignSelf: "center" },
  statusCard: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 7 }, statusReady: { backgroundColor: "rgba(21,128,61,0.18)", borderColor: "rgba(74,222,128,0.5)" }, statusBlocked: { backgroundColor: "rgba(127,29,29,0.18)", borderColor: "rgba(248,113,113,0.5)" }, statusTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  card: { ...theme.depth.card, padding: 14, gap: 8 }, centerCard: { margin: 14, ...theme.depth.card, padding: 20, gap: 8 }, rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }, flex: { flex: 1, minWidth: 0 },
  bookingId: { color: "#4ade80", fontSize: 11, letterSpacing: 0.5, fontWeight: "700" }, cardTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" }, body: { color: theme.colors.muted, fontSize: 13, lineHeight: 18 }, amount: { color: theme.colors.text, fontSize: 14, fontWeight: "700", marginTop: 3 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "rgba(245,158,11,0.18)", borderWidth: 1, borderColor: "rgba(245,158,11,0.45)" }, badgeReady: { backgroundColor: "rgba(34,197,94,0.18)", borderColor: "rgba(34,197,94,0.5)" }, badgeText: { color: theme.colors.text, fontSize: 10, fontWeight: "700" },
  payButton: { minHeight: 50, borderRadius: 999, backgroundColor: theme.colors.blue, alignItems: "center", justifyContent: "center", marginTop: 4 }, payButtonText: { color: "#fff", fontSize: 14, fontWeight: "700" }, disabled: { opacity: 0.5 },
  offlineReturnButton: { minHeight: 46, borderRadius: 999, borderWidth: 1, borderColor: "rgba(251, 146, 60, 0.8)", backgroundColor: "rgba(154, 52, 18, 0.18)", alignItems: "center", justifyContent: "center", marginTop: 4 }, offlineReturnButtonText: { color: "#fdba74", fontSize: 13, fontWeight: "800" },
  waitingCard: { borderRadius: 14, padding: 12, gap: 4, backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" },
  identityCard: { borderRadius: 14, borderWidth: 1, borderColor: "rgba(245,158,11,0.45)", backgroundColor: "rgba(245,158,11,0.10)", padding: 11, gap: 6 },
  identityCardVerified: { borderColor: "rgba(34,197,94,0.45)", backgroundColor: "rgba(34,197,94,0.10)" },
  identityTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "800" },
  sectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "800" },
  identityButton: { minHeight: 42, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  identityButtonText: { color: theme.colors.brand, fontSize: 13, fontWeight: "800" },
  reviewActions: { flexDirection: "row", gap: 8 }, reviewButton: { flex: 1 }, holdButton: { minHeight: 50, borderRadius: 999, backgroundColor: "#a16207", alignItems: "center", justifyContent: "center", marginTop: 4 }
  ,formInput: { minHeight: 48, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12, color: theme.colors.text, paddingHorizontal: 12, backgroundColor: theme.colors.panel2 }
  ,notes: { minHeight: 88, textAlignVertical: "top", paddingTop: 12 }
  ,photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
  ,photoButton: { width: "48%", minHeight: 48, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12, alignItems: "center", justifyContent: "center" }
  ,photoSaved: { borderColor: "#4ade80", backgroundColor: "rgba(34,197,94,0.12)" }
  ,photoText: { color: theme.colors.text, fontSize: 12, fontWeight: "700" }
});
