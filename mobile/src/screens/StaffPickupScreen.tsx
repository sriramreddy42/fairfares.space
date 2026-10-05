import React, { useCallback, useEffect, useState } from "react";
import * as ImageManipulator from "expo-image-manipulator";
import { ActivityIndicator, Alert, AppState, Image, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authenticatedAssetSource, getStaffPickupBookings, reviewRentalHandoff, staffHandoffPhotoUrl, staffPrivateHandoffPhotoUrl, startStaffIdentityVerification, submitStaffHandoffInspection } from "../api/client";
import { theme } from "../theme";
import { StaffPickupBooking } from "../types";
import { takeChatPhoto } from "../utils/imageUpload";

type Props = { onClose: () => void };
type PhotoKey = "front" | "back" | "left" | "right" | "odometer" | "fuel" | "interiorFront" | "interiorRear";
const photoSteps: Array<{ key: PhotoKey; label: string }> = [{ key: "front", label: "Front" }, { key: "back", label: "Rear" }, { key: "left", label: "Driver" }, { key: "right", label: "Passenger" }, { key: "odometer", label: "Odometer" }, { key: "fuel", label: "Fuel" }, { key: "interiorFront", label: "Front interior" }, { key: "interiorRear", label: "Rear / cargo" }];
const maxExistingDamagePhotos = 10;
const returnIssueOptions = [
  ["DAMAGE", "Damage"], ["FUEL", "Fuel"], ["CLEANING", "Cleaning"], ["SMOKING", "Smoking"],
  ["KEYS_ACCESSORIES", "Keys / accessories"], ["LATE_RETURN", "Late return"], ["TOLLS_TICKETS", "Tolls / tickets"], ["OTHER", "Other"],
] as const;
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
  const [photoViewer, setPhotoViewer] = useState<{ booking: StaffPickupBooking; phase: "pickup" | "return" } | null>(null);
  const [licenseViewer, setLicenseViewer] = useState<StaffPickupBooking | null>(null);

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
    const interval = setInterval(() => void refresh(), 20000);
    return () => { subscription.remove(); clearInterval(interval); };
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
          const canReconcileOfflineReturn = Boolean(booking.canReconcileOfflineReturn);
          return (
            <View key={booking.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}><Text style={styles.bookingId}>{booking.bookingId}</Text><Text style={styles.cardTitle}>{booking.carName}</Text></View>
                <View style={[styles.badge, (authorized || pickupSubmitted || returnSubmitted) && styles.badgeReady]}><Text style={styles.badgeText}>{booking.bookingStatus.replaceAll("_", " ")}</Text></View>
              </View>
              <Text style={styles.body}>{booking.customerName} · {booking.customerEmail}</Text>
              <Text style={styles.body}>{booking.pickupDate} · {booking.pickupTime}</Text>
              <Text style={styles.amount}>{authorized ? `$${depositAmount.toFixed(2)} refundable authorization: authorized` : `$${depositAmount.toFixed(2)} optional refundable authorization`}</Text>
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
                <View style={[styles.waitingCard, booking.pickupAcceptanceStatus === "ACCEPTED" && styles.acceptedCard]}>
                  <Text style={styles.identityTitle}>{booking.pickupAcceptanceStatus === "ACCEPTED" ? "Renter accepted the pickup condition" : "Waiting for renter acceptance"}</Text>
                  <Text style={styles.body}>{booking.pickupAcceptanceStatus === "ACCEPTED" ? "Review evidence and release the vehicle." : "The renter was notified to review vehicle photos and e-sign in their FairFares rental booking."}</Text>
                </View>
                {booking.pickupEvidenceComplete ? <TouchableOpacity style={styles.photoViewerButton} onPress={() => setPhotoViewer({ booking, phase: "pickup" })}><Text style={styles.photoViewerButtonText}>View pickup evidence</Text></TouchableOpacity> : null}
                {booking.pickupLicenseCaptured ? <TouchableOpacity style={styles.photoViewerButton} onPress={() => setLicenseViewer(booking)}><Text style={styles.photoViewerButtonText}>View driver licence</Text></TouchableOpacity> : null}
                <Text style={styles.body}>This is the final pickup step: staff hands the vehicle to the renter and starts the rental. It does not record the return.</Text>
                <TouchableOpacity style={[styles.payButton, (busy || !booking.pickupEvidenceComplete || !identityVerified || booking.pickupAcceptanceStatus !== "ACCEPTED") && styles.disabled]} disabled={busy || !booking.pickupEvidenceComplete || !identityVerified || booking.pickupAcceptanceStatus !== "ACCEPTED"} onPress={() => void reviewHandoff(booking, "APPROVE_PICKUP")}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.payButtonText}>Release vehicle to renter</Text>}
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
              {booking.pickupEvidenceComplete ? <TouchableOpacity style={styles.photoViewerButton} onPress={() => setPhotoViewer({ booking, phase: "pickup" })}><Text style={styles.photoViewerButtonText}>View pickup photos</Text></TouchableOpacity> : null}
              {booking.returnEvidenceComplete ? <TouchableOpacity style={styles.photoViewerButton} onPress={() => setPhotoViewer({ booking, phase: "return" })}><Text style={styles.photoViewerButtonText}>View return photos</Text></TouchableOpacity> : null}
              {canReconcileOfflineReturn ? <TouchableOpacity style={[styles.offlineReturnButton, busy && styles.disabled]} disabled={busy} onPress={() => confirmOfflineReturn(booking)}>
                <Text style={styles.offlineReturnButtonText}>Record past offline return</Text>
              </TouchableOpacity> : null}
            </View>
          );
        })}
        {!refreshing && pickups.length === 0 ? <View style={styles.centerCard}><Text style={styles.cardTitle}>{bookingLookup ? "Booking not found in handoffs" : "No handoffs awaiting action"}</Text><Text style={styles.body}>{bookingLookup ? lookupDetail || "Check the booking number and status." : "Paid pickups and active return reviews appear here."}</Text></View> : null}
      </ScrollView>
      <InspectionModal inspection={inspection} onClose={() => setInspection(null)} onSaved={async () => { setInspection(null); await refresh(); }} onViewPickupEvidence={(booking) => setPhotoViewer({ booking, phase: "pickup" })} />
      <HandoffPhotoViewer viewer={photoViewer} onClose={() => setPhotoViewer(null)} />
      <LicenseViewer booking={licenseViewer} onClose={() => setLicenseViewer(null)} />
    </View>
  );
}

function HandoffPhotoViewer({ viewer, onClose }: { viewer: { booking: StaffPickupBooking; phase: "pickup" | "return" } | null; onClose: () => void }) {
  const safeAreaInsets = useSafeAreaInsets();
  const entries = viewer ? [
    ...photoSteps.map(({ key, label }) => ({ id: key, label, url: staffHandoffPhotoUrl(viewer.booking.id, viewer.phase, key) })),
    ...(viewer.phase === "pickup" ? Array.from({ length: Math.min(maxExistingDamagePhotos, Number(viewer.booking.pickupExistingDamagePhotoCount || 0)) }, (_, index) => ({ id: `existingDamage${index + 1}`, label: `Existing damage ${index + 1}`, url: staffPrivateHandoffPhotoUrl(viewer.booking.id, `pickup_existing_damage_${index + 1}_image`) })) : Array.from({ length: Math.min(maxExistingDamagePhotos, Number(viewer.booking.returnDamagePhotoCount || 0)) }, (_, index) => ({ id: `returnDamage${index + 1}`, label: `Damage close-up ${index + 1}`, url: staffPrivateHandoffPhotoUrl(viewer.booking.id, `return_damage_${index + 1}_image`) }))),
  ] : [];
  return <Modal visible={Boolean(viewer)} animationType="slide" onRequestClose={onClose}><View style={styles.screen}><View style={[styles.header, { minHeight: 72 + safeAreaInsets.top, paddingTop: safeAreaInsets.top }]}><TouchableOpacity onPress={onClose} style={styles.backButton} accessibilityLabel="Close photos"><Text style={styles.backText}>‹</Text></TouchableOpacity><View style={styles.flex}><Text style={styles.eyebrow}>PRIVATE STAFF EVIDENCE</Text><Text style={styles.title}>{viewer?.phase === "pickup" ? "Pickup photos" : "Return photos"}</Text></View></View><ScrollView contentContainerStyle={styles.photoViewerGrid}>{entries.map(({ id, label, url }) => <View key={id} style={styles.photoViewerCard}><Text style={styles.photoViewerLabel}>{label}</Text><Image source={authenticatedAssetSource(url)} style={styles.photoViewerImage} resizeMode="cover" /></View>)}</ScrollView></View></Modal>;
}

function LicenseViewer({ booking, onClose }: { booking: StaffPickupBooking | null; onClose: () => void }) {
  const safeAreaInsets = useSafeAreaInsets();
  return <Modal visible={Boolean(booking)} animationType="slide" onRequestClose={onClose}><View style={styles.screen}><View style={[styles.header, { minHeight: 72 + safeAreaInsets.top, paddingTop: safeAreaInsets.top }]}><TouchableOpacity onPress={onClose} style={styles.backButton}><Text style={styles.backText}>‹</Text></TouchableOpacity><View style={styles.flex}><Text style={styles.eyebrow}>PRIVATE STAFF DOCUMENT</Text><Text style={styles.title}>Driver licence</Text></View></View><ScrollView contentContainerStyle={styles.photoViewerGrid}>{booking ? [{ field: "pickup_license_front_image", label: "Front" }, { field: "pickup_license_back_image", label: "Back" }].map(({ field, label }) => <View key={field} style={styles.photoViewerCard}><Text style={styles.photoViewerLabel}>{label}</Text><Image source={authenticatedAssetSource(staffPrivateHandoffPhotoUrl(booking.id, field))} style={styles.photoViewerImage} resizeMode="cover" /></View>) : null}</ScrollView></View></Modal>;
}

function InspectionModal({ inspection, onClose, onSaved, onViewPickupEvidence }: { inspection: { booking: StaffPickupBooking; phase: "pickup" | "return" } | null; onClose: () => void; onSaved: () => Promise<void>; onViewPickupEvidence: (booking: StaffPickupBooking) => void }) {
  const safeAreaInsets = useSafeAreaInsets();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  const [odometer, setOdometer] = useState(""); const [fuel, setFuel] = useState("FULL"); const [customer, setCustomer] = useState(""); const [staff, setStaff] = useState("");
  const [condition, setCondition] = useState("ACCEPTABLE"); const [damage, setDamage] = useState("NO"); const [notes, setNotes] = useState(""); const [photos, setPhotos] = useState<Record<PhotoKey, string>>(emptyPhotos()); const [licensePhotos, setLicensePhotos] = useState({ front: "", back: "" }); const [existingDamage, setExistingDamage] = useState<"NONE" | "RECORDED">("NONE"); const [existingDamageNotes, setExistingDamageNotes] = useState(""); const [existingDamagePhotos, setExistingDamagePhotos] = useState<string[]>([]); const [actualReturnLocation, setActualReturnLocation] = useState(""); const [keysConfirmed, setKeysConfirmed] = useState<"RETURNED" | "MISSING">("RETURNED"); const [cleanliness, setCleanliness] = useState<"CLEAN" | "NEEDS_CLEANING">("CLEAN"); const [smoking, setSmoking] = useState<"NO" | "YES">("NO"); const [issueTypes, setIssueTypes] = useState<string[]>([]); const [returnDamagePhotos, setReturnDamagePhotos] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!inspection) return;
    setDate(new Date().toISOString().slice(0, 10)); setTime(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })); setOdometer(""); setFuel("FULL"); setCustomer(""); setStaff(""); setCondition("ACCEPTABLE"); setDamage("NO"); setNotes(""); setPhotos(emptyPhotos()); setLicensePhotos({ front: "", back: "" }); setExistingDamage("NONE"); setExistingDamageNotes(""); setExistingDamagePhotos([]); setActualReturnLocation(inspection.phase === "return" ? inspection.booking.returnLocation || inspection.booking.pickupLocation : ""); setKeysConfirmed("RETURNED"); setCleanliness("CLEAN"); setSmoking("NO"); setIssueTypes([]); setReturnDamagePhotos([]);
  }, [inspection?.booking.id, inspection?.phase]);
  async function capture(key: PhotoKey) {
    const selected = await takeChatPhoto(1280, 0.62, 500_000); if (!selected) return;
    const source = await selected.preparation; const image = await ImageManipulator.manipulateAsync(source.uri, [{ resize: { width: 1280 } }], { compress: 0.62, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    if (image.base64) setPhotos((value) => ({ ...value, [key]: "data:image/jpeg;base64," + image.base64 }));
  }
  async function captureLicense(side: "front" | "back") { const selected = await takeChatPhoto(1280, 0.62, 500_000); if (!selected) return; const image = await ImageManipulator.manipulateAsync((await selected.preparation).uri, [{ resize: { width: 1280 } }], { compress: 0.62, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (image.base64) setLicensePhotos((value) => ({ ...value, [side]: `data:image/jpeg;base64,${image.base64}` })); }
  async function captureExistingDamage() { if (existingDamagePhotos.length >= maxExistingDamagePhotos) return; const selected = await takeChatPhoto(1280, 0.62, 500_000); if (!selected) return; const image = await ImageManipulator.manipulateAsync((await selected.preparation).uri, [{ resize: { width: 1280 } }], { compress: 0.62, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (image.base64) setExistingDamagePhotos((value) => [...value, `data:image/jpeg;base64,${image.base64}`].slice(0, maxExistingDamagePhotos)); }
  async function captureReturnDamage() { if (returnDamagePhotos.length >= maxExistingDamagePhotos) return; const selected = await takeChatPhoto(1280, 0.62, 500_000); if (!selected) return; const image = await ImageManipulator.manipulateAsync((await selected.preparation).uri, [{ resize: { width: 1280 } }], { compress: 0.62, format: ImageManipulator.SaveFormat.JPEG, base64: true }); if (image.base64) setReturnDamagePhotos((value) => [...value, `data:image/jpeg;base64,${image.base64}`].slice(0, maxExistingDamagePhotos)); }
  async function save() {
    if (!inspection) return;
    const pickup = inspection.phase === "pickup";
    if (!date || !time || !odometer || !fuel || !staff || (!pickup && !customer) || photoSteps.some(({ key }) => !photos[key])) { Alert.alert("Complete the inspection", pickup ? "Date, time, odometer, fuel, staff signature, and all eight vehicle photos are required." : "Date, time, odometer, fuel, both signatures, and all eight photos are required."); return; }
    if (pickup && (!licensePhotos.front || !licensePhotos.back)) { Alert.alert("Driver licence required", "Capture the renter's driver licence front and back."); return; }
    if (pickup && existingDamage === "RECORDED" && (!existingDamageNotes || !existingDamagePhotos.length)) { Alert.alert("Existing damage", "Add notes and at least one photo for existing damage."); return; }
    const hasReturnIssue = !pickup && (condition !== "ACCEPTABLE" || damage !== "NO" || keysConfirmed !== "RETURNED" || cleanliness !== "CLEAN" || smoking !== "NO" || issueTypes.length > 0);
    if (!pickup && !actualReturnLocation.trim()) { Alert.alert("Confirm return location", "Enter the location where staff received the vehicle."); return; }
    if (hasReturnIssue && !notes.trim()) { Alert.alert("Add notes", "Describe the return issue before saving it."); return; }
    if (!pickup && (damage === "YES" || issueTypes.includes("DAMAGE")) && !returnDamagePhotos.length) { Alert.alert("Damage photos required", "Add at least one damage close-up for a damage return."); return; }
    setBusy(true);
    try { const result = await submitStaffHandoffInspection({ bookingId: inspection.booking.id, phase: inspection.phase, actualDate: date, actualTime: time, odometer, fuelLevel: fuel, customerSignature: pickup ? "" : customer, staffSignature: staff, photos, licensePhotos: pickup ? licensePhotos : undefined, existingDamageStatus: pickup ? existingDamage : undefined, existingDamageNotes: pickup ? existingDamageNotes : undefined, existingDamagePhotos: pickup ? existingDamagePhotos : undefined, conditionStatus: condition, newDamageFound: damage, actualReturnLocation: pickup ? undefined : actualReturnLocation.trim(), keysConfirmed: pickup ? undefined : keysConfirmed, cleanlinessStatus: pickup ? undefined : cleanliness, smokingStatus: pickup ? undefined : smoking, issueTypes: pickup ? undefined : issueTypes, returnDamagePhotos: pickup ? undefined : returnDamagePhotos, chargeNotes: notes }); Alert.alert(pickup ? "Acceptance requested" : "Inspection saved", result.message); await onSaved(); }
    catch (error) { Alert.alert("Could not save inspection", error instanceof Error ? error.message : "Try again."); } finally { setBusy(false); }
  }
  const scheduledLocation = inspection?.phase === "return" ? inspection.booking.returnLocation || inspection.booking.pickupLocation : inspection?.booking.pickupLocation;
  return <Modal visible={Boolean(inspection)} animationType="slide" onRequestClose={onClose}><View style={styles.screen}><View style={[styles.header, { minHeight: 72 + safeAreaInsets.top, paddingTop: safeAreaInsets.top }]}><TouchableOpacity onPress={onClose} style={styles.backButton}><Text style={styles.backText}>‹</Text></TouchableOpacity><View style={styles.flex}><Text style={styles.eyebrow}>STAFF INSPECTION</Text><Text style={styles.title}>{inspection?.phase === "pickup" ? "Pickup and release" : "Return inspection"}</Text></View></View><ScrollView contentContainerStyle={styles.content}>{inspection ? <View style={styles.handoffSummary}><Text style={styles.handoffSummaryTitle}>{inspection.booking.carName} · {inspection.booking.bookingId}</Text><Text style={styles.handoffSummaryLabel}>{inspection.phase === "pickup" ? "Scheduled pickup location" : "Scheduled return location"}</Text><Text style={styles.handoffSummaryLocation}>{scheduledLocation || "Location not set"}</Text>{inspection.phase === "return" && inspection.booking.pickupEvidenceComplete ? <TouchableOpacity style={styles.photoViewerButton} onPress={() => onViewPickupEvidence(inspection.booking)}><Text style={styles.photoViewerButtonText}>Review pickup record and damage photos</Text></TouchableOpacity> : null}</View> : null}<TextInput style={styles.formInput} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" /><TextInput style={styles.formInput} value={time} onChangeText={setTime} placeholder="Time" /><TextInput style={styles.formInput} value={odometer} onChangeText={setOdometer} placeholder="Odometer" keyboardType="number-pad" /><TextInput style={styles.formInput} value={fuel} onChangeText={setFuel} placeholder="Fuel / charge level" />{inspection?.phase === "return" ? <TextInput style={styles.formInput} value={actualReturnLocation} onChangeText={setActualReturnLocation} placeholder="Actual return location" /> : null}{inspection?.phase === "return" ? <TextInput style={styles.formInput} value={customer} onChangeText={setCustomer} placeholder="Renter signature" /> : null}<TextInput style={styles.formInput} value={staff} onChangeText={setStaff} placeholder="Staff signature" />{inspection?.phase === "pickup" ? <><Text style={styles.sectionTitle}>Driver licence</Text><Text style={styles.body}>Staff capture only. These images remain private to staff.</Text><View style={styles.photoGrid}>{(["front", "back"] as const).map((side) => <TouchableOpacity key={side} style={[styles.photoButton, licensePhotos[side] && styles.photoSaved]} onPress={() => void captureLicense(side)}><Text style={styles.photoText}>{licensePhotos[side] ? `✓ Licence ${side}` : `Licence ${side}`}</Text></TouchableOpacity>)}</View><Text style={styles.sectionTitle}>Existing vehicle condition</Text><View style={styles.choiceRow}>{(["NONE", "RECORDED"] as const).map((value) => <TouchableOpacity key={value} style={[styles.choiceButton, existingDamage === value && styles.photoSaved]} onPress={() => setExistingDamage(value)}><Text style={styles.photoText}>{value === "NONE" ? "No existing damage" : "Existing damage"}</Text></TouchableOpacity>)}</View>{existingDamage === "RECORDED" ? <><TextInput style={[styles.formInput, styles.notes]} value={existingDamageNotes} onChangeText={setExistingDamageNotes} multiline placeholder="Describe existing scratches, dents, or other condition" /><TouchableOpacity style={[styles.photoViewerButton, existingDamagePhotos.length >= maxExistingDamagePhotos && styles.disabled]} disabled={existingDamagePhotos.length >= maxExistingDamagePhotos} onPress={() => void captureExistingDamage()}><Text style={styles.photoViewerButtonText}>{existingDamagePhotos.length ? `Add damage photo (${existingDamagePhotos.length}/${maxExistingDamagePhotos})` : "Take existing-damage photo (0/10)"}</Text></TouchableOpacity></> : null}</> : <><Text style={styles.sectionTitle}>Return checks</Text><View style={styles.choiceRow}>{(["ACCEPTABLE", "DAMAGE_NOTED"] as const).map((value) => <TouchableOpacity key={value} style={[styles.choiceButton, condition === value && styles.photoSaved]} onPress={() => { setCondition(value); setDamage(value === "DAMAGE_NOTED" ? "YES" : "NO"); }}><Text style={styles.photoText}>{value === "ACCEPTABLE" ? "Condition clear" : "Damage noted"}</Text></TouchableOpacity>)}</View><View style={styles.choiceRow}>{(["RETURNED", "MISSING"] as const).map((value) => <TouchableOpacity key={value} style={[styles.choiceButton, keysConfirmed === value && styles.photoSaved]} onPress={() => setKeysConfirmed(value)}><Text style={styles.photoText}>{value === "RETURNED" ? "Keys returned" : "Keys / item missing"}</Text></TouchableOpacity>)}</View><View style={styles.choiceRow}>{(["CLEAN", "NEEDS_CLEANING"] as const).map((value) => <TouchableOpacity key={value} style={[styles.choiceButton, cleanliness === value && styles.photoSaved]} onPress={() => setCleanliness(value)}><Text style={styles.photoText}>{value === "CLEAN" ? "Clean" : "Needs cleaning"}</Text></TouchableOpacity>)}</View><View style={styles.choiceRow}>{(["NO", "YES"] as const).map((value) => <TouchableOpacity key={value} style={[styles.choiceButton, smoking === value && styles.photoSaved]} onPress={() => setSmoking(value)}><Text style={styles.photoText}>{value === "NO" ? "No smoking issue" : "Smoking issue"}</Text></TouchableOpacity>)}</View><Text style={styles.sectionTitle}>Issue types, if any</Text><View style={styles.choiceWrap}>{returnIssueOptions.map(([value, label]) => <TouchableOpacity key={value} style={[styles.issueChoiceButton, issueTypes.includes(value) && styles.photoSaved]} onPress={() => setIssueTypes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])}><Text style={styles.photoText}>{issueTypes.includes(value) ? "✓ " : ""}{label}</Text></TouchableOpacity>)}</View>{(damage === "YES" || condition === "DAMAGE_NOTED" || issueTypes.includes("DAMAGE")) ? <TouchableOpacity style={[styles.photoViewerButton, returnDamagePhotos.length >= maxExistingDamagePhotos && styles.disabled]} disabled={returnDamagePhotos.length >= maxExistingDamagePhotos} onPress={() => void captureReturnDamage()}><Text style={styles.photoViewerButtonText}>{returnDamagePhotos.length ? `Add damage close-up (${returnDamagePhotos.length}/${maxExistingDamagePhotos})` : "Take damage close-up (0/10)"}</Text></TouchableOpacity> : null}<TextInput style={[styles.formInput, styles.notes]} value={notes} onChangeText={setNotes} multiline placeholder="Required only when an issue is selected" /></>}<Text style={styles.sectionTitle}>Required vehicle photos</Text><View style={styles.photoGrid}>{photoSteps.map(({ key, label }) => <TouchableOpacity key={key} style={[styles.photoButton, photos[key] && styles.photoSaved]} onPress={() => void capture(key)}><Text style={styles.photoText}>{photos[key] ? "✓ " + label : label}</Text></TouchableOpacity>)}</View><TouchableOpacity style={styles.payButton} disabled={busy} onPress={() => void save()}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.payButtonText}>{inspection?.phase === "pickup" ? "Send pickup acceptance" : "Save return inspection"}</Text>}</TouchableOpacity></ScrollView></View></Modal>;
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
  ,handoffSummary: { borderWidth: 1, borderColor: "rgba(74,222,128,0.5)", backgroundColor: "rgba(34,197,94,0.10)", borderRadius: 14, padding: 13, gap: 4 }
  ,handoffSummaryTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "800" }
  ,handoffSummaryLabel: { color: theme.colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 }
  ,handoffSummaryLocation: { color: theme.colors.text, fontSize: 15, fontWeight: "700", lineHeight: 21 }
  ,photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
  ,photoButton: { width: "48%", minHeight: 48, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12, alignItems: "center", justifyContent: "center" }
  ,photoSaved: { borderColor: "#4ade80", backgroundColor: "rgba(34,197,94,0.12)" }
  ,photoText: { color: theme.colors.text, fontSize: 12, fontWeight: "700", textAlign: "center" }
  ,choiceRow: { flexDirection: "row", gap: 8 }
  ,choiceButton: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }
  ,choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
  ,issueChoiceButton: { minHeight: 42, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }
  ,acceptedCard: { backgroundColor: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.40)" }
  ,photoViewerButton: { minHeight: 46, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.blue, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }
  ,photoViewerButtonText: { color: theme.colors.blue, fontSize: 13, fontWeight: "800" }
  ,photoViewerGrid: { padding: 14, paddingBottom: 48, gap: 12 }
  ,photoViewerCard: { ...theme.depth.card, overflow: "hidden" }
  ,photoViewerLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "800", padding: 12 }
  ,photoViewerImage: { width: "100%", aspectRatio: 4 / 3, backgroundColor: theme.colors.panel2 }
});
