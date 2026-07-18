import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  ImageSourcePropType,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import {
  createRentalSupportTicket,
  emailRentalDocuments,
  getRentalBookings,
  requestRentalCancellation,
  requestRentalModification,
  setAuthToken,
  updateMobileStudentVerification
} from "../api/client";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { Car, FairFaresUser, RentalSearchInput, RentalServiceBooking, ServiceItem } from "../types";

export type ServiceKey = "cars" | "deals" | "explorer" | "housing" | "local";

type Props = {
  cars: Car[];
  services: ServiceItem[];
  user: FairFaresUser | null;
  selected: ServiceKey;
  onSelect: (service: ServiceKey) => void;
  onOpenHousing: () => void;
  onRequireLogin: () => void;
  onBookCar: (car: Car, details?: Partial<RentalSearchInput>, paymentOption?: "hold" | "full") => void;
};

type ServiceAction = {
  label: string;
  icon: ImageSourcePropType;
  primary?: boolean;
  onPress: () => void;
};

type PanelMode = "modify" | "cancel" | "documents" | "details" | "support" | null;

function bookingTitle(booking: RentalServiceBooking | null) {
  if (!booking) return "Select rental booking";
  return `${booking.carName || "Rental car"} - ${booking.pickupDate || "Pickup pending"}`;
}

function selectedBookingCopy(booking: RentalServiceBooking | null, busy: boolean) {
  if (booking) return `${booking.statusLabel} - ${booking.totalLabel}`;
  if (busy) return "Loading bookings...";
  return "Login to view or manage rental bookings";
}

function mergeBooking(rows: RentalServiceBooking[], updated?: RentalServiceBooking) {
  if (!updated) return rows;
  return rows.map((booking) => (booking.id === updated.id ? updated : booking));
}

export function ServicesScreen({ user, onRequireLogin }: Props) {
  const [bookings, setBookings] = useState<RentalServiceBooking[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [bookingMenuOpen, setBookingMenuOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [returnLocation, setReturnLocation] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [returnTime, setReturnTime] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState(0);
  const [additionalDriverRequested, setAdditionalDriverRequested] = useState(false);
  const [additionalDriverName, setAdditionalDriverName] = useState("");
  const [additionalDriverAge, setAdditionalDriverAge] = useState("25+");
  const [modifyNote, setModifyNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [refundMethod, setRefundMethod] = useState("Original payment method");
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [documentEmail, setDocumentEmail] = useState("");
  const [selectedDocumentSetId, setSelectedDocumentSetId] = useState<number | null>(null);
  const [selectedDocName, setSelectedDocName] = useState("Invoice / Receipt");
  const [detailsTab, setDetailsTab] = useState<"student" | "saved" | "status" | "housing">("student");
  const [studentEmail, setStudentEmail] = useState("");
  const [studentId, setStudentId] = useState("");
  const [supportTopic, setSupportTopic] = useState("Rental support");
  const [supportMessage, setSupportMessage] = useState("");

  async function loadBookings() {
    if (!user) {
      setBookings([]);
      setSelectedBookingId("");
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const rows = await getRentalBookings();
      setBookings(rows);
      setSelectedBookingId((current) => current || rows[0]?.id || "");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Could not load rental bookings.";
      if (/login is required|401|unauthorized|not authorized/i.test(message)) {
        setAuthToken("");
        setBookings([]);
        setSelectedBookingId("");
        setError("Login again to view and manage your rental bookings.");
        onRequireLogin();
      } else if (/could not connect|failed to fetch|network request failed/i.test(message)) {
        setError("We could not refresh your rental bookings. Check your connection and try again.");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadBookings();
  }, [user?.id]);

  const selectedBooking = useMemo(
    () => bookings.find((booking) => booking.id === selectedBookingId) || bookings[0] || null,
    [bookings, selectedBookingId]
  );

  useEffect(() => {
    if (!selectedBooking) return;
    setPickupLocation(selectedBooking.pickupLocation || "");
    setReturnLocation(selectedBooking.returnLocation || "");
    setPickupDate(selectedBooking.pickupDate || "");
    setReturnDate(selectedBooking.returnDate || "");
    setPickupTime(selectedBooking.pickupTime || "");
    setReturnTime(selectedBooking.returnTime || "");
    setSelectedVehicleId(0);
    setAdditionalDriverRequested(false);
    setAdditionalDriverName("");
    setAdditionalDriverAge("25+");
    setCancelReason("Customer cancellation request");
    setCancelNote("");
    setRefundMethod("Original payment method");
    setCancelConfirmed(false);
    setDocumentEmail("");
    setSelectedDocumentSetId(selectedBooking.documents?.[0]?.id ?? null);
    setSelectedDocName("Invoice / Receipt");
    setDetailsTab("student");
    setStudentEmail(selectedBooking.student?.email || "");
    setStudentId(selectedBooking.student?.id || "");
    setModifyNote("");
    setSupportTopic("Rental support");
    setSupportMessage("");
  }, [selectedBooking?.id]);

  function requireBooking(action: (booking: RentalServiceBooking) => void) {
    if (!user) {
      onRequireLogin();
      return;
    }
    if (!selectedBooking) {
      Alert.alert("No rental bookings yet", "Book a rental car first, then your reservation tools will appear here.");
      return;
    }
    action(selectedBooking);
  }

  function openPanel(mode: PanelMode) {
    requireBooking(() => setPanelMode(mode));
  }

  async function submitModification() {
    if (!selectedBooking) return;
    setBusy(true);
    try {
      const result = await requestRentalModification(selectedBooking.id, {
        pickupLocation,
        returnLocation,
        pickupDate,
        returnDate,
        pickupTime,
        returnTime,
        vehicleId: selectedVehicleId || undefined,
        additionalDriverRequested,
        additionalDriverName,
        additionalDriverAge,
        note: modifyNote
      });
      setBookings((rows) => mergeBooking(rows, result.booking));
      setPanelMode("details");
      Alert.alert("Modification request", result.message || "Your modification request was saved.");
    } catch (modifyError) {
      Alert.alert("Could not modify", modifyError instanceof Error ? modifyError.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCancellation() {
    if (!selectedBooking) return;
    if (!cancelConfirmed) {
      Alert.alert("Confirm cancellation", "Please confirm that this booking should be sent for cancellation approval.");
      return;
    }
    setBusy(true);
    try {
      const result = await requestRentalCancellation(
        selectedBooking.id,
        cancelReason || "Customer cancellation request",
        cancelNote,
        refundMethod
      );
      setBookings((rows) => mergeBooking(rows, result.booking));
      setPanelMode("details");
      Alert.alert("Cancellation request", result.message || "Request sent.");
    } catch (cancelError) {
      Alert.alert("Could not cancel", cancelError instanceof Error ? cancelError.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendDocuments() {
    if (!selectedBooking) return;
    if (selectedBooking.invoiceUrl) {
      await Linking.openURL(selectedBooking.invoiceUrl);
      return;
    }
    setBusy(true);
    try {
      const result = await emailRentalDocuments(String(selectedDocumentSetId || selectedBooking.id), documentEmail);
      Alert.alert("Rental documents", result.message || "Documents were emailed.");
    } catch (documentError) {
      Alert.alert("Documents unavailable", documentError instanceof Error ? documentError.message : "Try again after pickup is completed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitSupportTicket(urgent = false) {
    if (!selectedBooking) return;
    setBusy(true);
    try {
      const result = await createRentalSupportTicket(
        selectedBooking.id,
        supportTopic || "Rental support",
        supportMessage || "Customer requested help from the FairFares mobile app.",
        urgent
      );
      setPanelMode("details");
      Alert.alert("Support ticket created", result.message || `Ticket ${result.ticketId} created.`);
    } catch (supportError) {
      Alert.alert("Could not create ticket", supportError instanceof Error ? supportError.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitStudentVerification() {
    setBusy(true);
    try {
      const result = await updateMobileStudentVerification(studentEmail, studentId);
      Alert.alert("Student verification", result.message || "Check your .edu inbox for the verification link.");
      await loadBookings();
    } catch (studentError) {
      Alert.alert("Could not update", studentError instanceof Error ? studentError.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  const actions: ServiceAction[] = [
    {
      label: "Modify Reservation",
      icon: appAssets.serviceModify,
      onPress: () => openPanel("modify")
    },
    {
      label: "Cancel Reservation",
      icon: appAssets.serviceCancel,
      onPress: () => openPanel("cancel")
    },
    {
      label: "Download Invoice",
      icon: appAssets.serviceInvoice,
      primary: true,
      onPress: () => openPanel("documents")
    },
    {
      label: "View Details",
      icon: appAssets.serviceEye,
      onPress: () => openPanel("details")
    }
  ];

  const selectedDocumentSet = selectedBooking?.documents?.find((item) => item.id === selectedDocumentSetId)
    || selectedBooking?.documents?.[0]
    || null;
  const selectedDocument = selectedDocumentSet?.docs?.[selectedDocName] || null;
  const selectedUpgrade = selectedBooking?.upgradeOptions?.find((option) => option.id === selectedVehicleId) || null;
  const estimatedPrice = selectedUpgrade?.estimatedTotalLabel || selectedBooking?.totalLabel || "";

  return (
    <>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Services</Text>
          <Text style={styles.title}>Rental Cars</Text>
          <Text style={styles.subtitle}>Select a booking, then manage changes, cancellation, invoice, or trip details.</Text>
        </View>

        <View style={styles.bookingPanel}>
          <Text style={styles.fieldLabel}>Rental booking</Text>
          <TouchableOpacity
            style={styles.bookingSelect}
            onPress={() => (user ? setBookingMenuOpen((open) => !open) : onRequireLogin())}
            activeOpacity={0.82}
          >
            <View style={styles.bookingSelectText}>
              <Text style={styles.bookingTitle} numberOfLines={1}>{bookingTitle(selectedBooking)}</Text>
              <Text style={styles.bookingMeta} numberOfLines={1}>{selectedBookingCopy(selectedBooking, busy)}</Text>
            </View>
            <Text style={styles.chevron}>{bookingMenuOpen ? "Up" : "Down"}</Text>
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
      </ScrollView>

      <Modal visible={panelMode !== null} transparent animationType="fade" onRequestClose={() => setPanelMode(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.detailsCard}>
            <View style={styles.detailsHeader}>
              <Text style={styles.detailsTitle}>{panelTitle(panelMode)}</Text>
              <TouchableOpacity style={styles.closeButton} onPress={() => setPanelMode(null)}>
                <Text style={styles.closeText}>X</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.panelContent} showsVerticalScrollIndicator={false}>
              {selectedBooking && panelMode === "modify" ? (
                <>
                  <Text style={styles.policyCopy}>Make changes to fit your plans. Date, location, vehicle, and additional-driver changes are sent to FairFares for review using the same booking flow as web.</Text>
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionTitle}>Change dates</Text>
                    <View style={styles.twoColumn}>
                      <InputField label="Pickup date" value={pickupDate} onChangeText={setPickupDate} placeholder="YYYY-MM-DD" />
                      <InputField label="Pickup time" value={pickupTime} onChangeText={setPickupTime} placeholder="10:00 AM" />
                    </View>
                    <View style={styles.twoColumn}>
                      <InputField label="Return date" value={returnDate} onChangeText={setReturnDate} placeholder="YYYY-MM-DD" />
                      <InputField label="Return time" value={returnTime} onChangeText={setReturnTime} placeholder="10:00 AM" />
                    </View>
                  </View>
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionTitle}>Change pickup location</Text>
                    <InputField label="Pickup location" value={pickupLocation} onChangeText={setPickupLocation} />
                    <InputField label="Drop-off location" value={returnLocation} onChangeText={setReturnLocation} />
                    <View style={styles.chipWrap}>
                      {(selectedBooking.locations || []).slice(0, 6).map((location) => (
                        <TouchableOpacity key={location} style={styles.choiceChip} onPress={() => { setPickupLocation(location); setReturnLocation(location); }}>
                          <Text style={styles.choiceChipText}>{location}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionTitle}>Upgrade vehicle</Text>
                    <ChoiceRow
                      label="No upgrade"
                      detail={`Keep current vehicle - ${selectedBooking.totalLabel}`}
                      selected={selectedVehicleId === 0}
                      onPress={() => setSelectedVehicleId(0)}
                    />
                    {(selectedBooking.upgradeOptions || []).map((option) => (
                      <ChoiceRow
                        key={option.id}
                        label={option.name}
                        detail={`${option.category} - ${option.dailyRange} - ${option.estimatedTotalLabel}`}
                        selected={selectedVehicleId === option.id}
                        onPress={() => setSelectedVehicleId(option.id)}
                      />
                    ))}
                  </View>
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionTitle}>Add additional driver</Text>
                    <ToggleRow
                      label="Add an additional driver"
                      selected={additionalDriverRequested}
                      onPress={() => setAdditionalDriverRequested((value) => !value)}
                    />
                    {additionalDriverRequested ? (
                      <>
                        <InputField label="Driver name" value={additionalDriverName} onChangeText={setAdditionalDriverName} placeholder="Enter full name" />
                        <View style={styles.chipWrap}>
                          {["21-24", "25+"].map((age) => (
                            <TouchableOpacity key={age} style={[styles.choiceChip, additionalDriverAge === age && styles.activeChoiceChip]} onPress={() => setAdditionalDriverAge(age)}>
                              <Text style={[styles.choiceChipText, additionalDriverAge === age && styles.activeChoiceChipText]}>{age}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    ) : null}
                  </View>
                  <View style={styles.modifySummary}>
                    <AmountPill label="Selected vehicle" value={selectedUpgrade?.name || selectedBooking.carName} />
                    <AmountPill label="Estimated price" value={estimatedPrice} />
                  </View>
                  <InputField label="Notes for FairFares" value={modifyNote} onChangeText={setModifyNote} multiline placeholder="Tell us what changed." />
                  <View style={styles.inlineActions}>
                    <SecondaryButton label="Reset changes" onPress={() => {
                      setPickupLocation(selectedBooking.pickupLocation || "");
                      setReturnLocation(selectedBooking.returnLocation || "");
                      setPickupDate(selectedBooking.pickupDate || "");
                      setReturnDate(selectedBooking.returnDate || "");
                      setPickupTime(selectedBooking.pickupTime || "");
                      setReturnTime(selectedBooking.returnTime || "");
                      setSelectedVehicleId(0);
                      setAdditionalDriverRequested(false);
                      setAdditionalDriverName("");
                      setAdditionalDriverAge("25+");
                      setModifyNote("");
                    }} />
                  </View>
                  <PrimaryButton label={busy ? "Saving..." : "Submit modification request"} onPress={submitModification} disabled={busy} />
                </>
              ) : null}

              {selectedBooking && panelMode === "cancel" ? (
                <>
                  <View style={styles.greenNote}>
                    <Text style={styles.greenNoteTitle}>Cancellation approval required</Text>
                    <Text style={styles.greenNoteBody}>Admin will review your request and confirm refund details.</Text>
                  </View>
                  <Summary booking={selectedBooking} />
                  <Text style={styles.fieldLabel}>Cancellation reason</Text>
                  <View style={styles.chipWrap}>
                    {["Plans changed", "Found a better price", "Need a different vehicle", "Booked by mistake"].map((reason) => (
                      <TouchableOpacity key={reason} style={[styles.choiceChip, cancelReason === reason && styles.activeChoiceChip]} onPress={() => setCancelReason(reason)}>
                        <Text style={[styles.choiceChipText, cancelReason === reason && styles.activeChoiceChipText]}>{reason}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.fieldLabel}>Refund method</Text>
                  <View style={styles.chipWrap}>
                    {["Original payment method", "FairFares travel credit"].map((method) => (
                      <TouchableOpacity key={method} style={[styles.choiceChip, refundMethod === method && styles.activeChoiceChip]} onPress={() => setRefundMethod(method)}>
                        <Text style={[styles.choiceChipText, refundMethod === method && styles.activeChoiceChipText]}>{method}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <InputField label="Optional note" value={cancelNote} onChangeText={setCancelNote} multiline placeholder="Add details for support" />
                  <View style={styles.refundBox}>
                    <Text style={styles.amountLabel}>Refund Amount (Est.)</Text>
                    <Text style={styles.refundAmount}>{selectedBooking.refund?.amountLabel || "$0.00"}</Text>
                    <Text style={styles.detailsLine}>{selectedBooking.refund?.note || "Admin will confirm refund details."}</Text>
                  </View>
                  <ToggleRow
                    label="I understand this sends the selected booking to admin for cancellation approval."
                    selected={cancelConfirmed}
                    onPress={() => setCancelConfirmed((value) => !value)}
                  />
                  <SecondaryButton label="Keep booking" onPress={() => setPanelMode(null)} />
                  <DangerButton label={busy ? "Sending..." : "Request cancellation"} onPress={submitCancellation} disabled={busy} />
                </>
              ) : null}

              {selectedBooking && panelMode === "documents" ? (
                <>
                  <View style={styles.greenNote}>
                    <Text style={styles.greenNoteTitle}>{selectedBooking.documentsLockedMessage || "Documents can be retrieved once pickup is completed."}</Text>
                  </View>
                  <InputField label="Send documents to" value={documentEmail} onChangeText={setDocumentEmail} placeholder="Email address" />
                  <Text style={styles.fieldLabel}>Choose booking documents</Text>
                  {(selectedBooking.documents || []).map((set) => (
                    <ChoiceRow
                      key={set.id}
                      label={`${set.statusLabel} - ${set.vehicle}`}
                      detail={`${set.dates}${set.locked ? " - Locked until pickup" : ""}`}
                      selected={(selectedDocumentSet?.id || 0) === set.id}
                      onPress={() => setSelectedDocumentSetId(set.id)}
                    />
                  ))}
                  <View style={styles.chipWrap}>
                    {["Invoice / Receipt", "Rental Agreement", "Taxes & Fees Breakdown"].map((name) => (
                      <TouchableOpacity key={name} style={[styles.choiceChip, selectedDocName === name && styles.activeChoiceChip]} onPress={() => setSelectedDocName(name)}>
                        <Text style={[styles.choiceChipText, selectedDocName === name && styles.activeChoiceChipText]}>{name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.documentBox}>
                    <Text style={styles.amountLabel}>{selectedDocument?.title || selectedDocName}</Text>
                    <Text style={styles.detailsLine}>{selectedDocument?.body || selectedBooking.invoiceNumber || "Documents are generated from admin booking records."}</Text>
                    <Text style={styles.detailsLine}>{selectedDocument?.status || (selectedDocumentSet?.locked ? selectedDocumentSet.lockMessage : "Ready when generated.")}</Text>
                  </View>
                  <PrimaryButton label={selectedBooking.invoiceUrl ? "Open invoice" : "Email rental documents"} onPress={sendDocuments} disabled={busy} />
                </>
              ) : null}

              {selectedBooking && panelMode === "details" ? (
                <>
                  <View style={styles.detailTabs}>
                    {[
                      ["student", "Student Verification"],
                      ["saved", "Saved Trips"],
                      ["status", "Live Status"],
                      ["housing", "Housing Posts"]
                    ].map(([key, label]) => (
                      <TouchableOpacity key={key} style={[styles.detailTab, detailsTab === key && styles.activeDetailTab]} onPress={() => setDetailsTab(key as typeof detailsTab)}>
                        <Text style={[styles.detailTabText, detailsTab === key && styles.activeDetailTabText]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {detailsTab === "student" ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.sectionTitle}>Student Verification</Text>
                      <View style={styles.greenNote}>
                        <Text style={styles.greenNoteTitle}>{selectedBooking.student?.statusLabel || "Student Verification Pending"}</Text>
                        <Text style={styles.greenNoteBody}>{selectedBooking.student?.discountLabel || "0% OFF"}</Text>
                      </View>
                      <InputField label="University email" value={studentEmail} onChangeText={setStudentEmail} placeholder="name@school.edu" />
                      <InputField label="Student ID" value={studentId} onChangeText={setStudentId} placeholder="STU-0000" />
                      <PrimaryButton label={busy ? "Saving..." : "Update verification"} onPress={submitStudentVerification} disabled={busy} />
                    </View>
                  ) : null}
                  {detailsTab === "saved" ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.sectionTitle}>Saved Trips</Text>
                      <View style={styles.amountGrid}>
                        <AmountPill label="Upcoming" value={String(selectedBooking.stats?.upcoming ?? 0)} />
                        <AmountPill label="Past" value={String(selectedBooking.stats?.past ?? 0)} />
                        <AmountPill label="Saved" value={String(selectedBooking.stats?.saved ?? 0)} />
                      </View>
                      <Summary booking={selectedBooking} />
                    </View>
                  ) : null}
                  {detailsTab === "status" ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.sectionTitle}>Live Rental Status</Text>
                      <View style={styles.greenNote}>
                        <Text style={styles.greenNoteTitle}>{selectedBooking.liveStatus?.title || "No active booking yet"}</Text>
                        <Text style={styles.greenNoteBody}>{selectedBooking.liveStatus?.body || "Book a car to see live pickup status here."}</Text>
                      </View>
                      <View style={styles.countdownRow}>
                        <AmountPill label="Days" value={selectedBooking.liveStatus?.days || "00"} />
                        <AmountPill label="Hours" value={selectedBooking.liveStatus?.hours || "00"} />
                        <AmountPill label="Mins" value={selectedBooking.liveStatus?.mins || "00"} />
                      </View>
                      <Text style={styles.detailsLine}>{selectedBooking.liveStatus?.instructions}</Text>
                    </View>
                  ) : null}
                  {detailsTab === "housing" ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.sectionTitle}>Housing Posts</Text>
                      <View style={styles.amountGrid}>
                        <AmountPill label="Active" value={String(selectedBooking.stats?.housingActive ?? 0)} />
                        <AmountPill label="Expired" value={String(selectedBooking.stats?.housingExpired ?? 0)} />
                      </View>
                      {(selectedBooking.housingPosts || []).length ? (selectedBooking.housingPosts || []).map((post) => (
                        <View key={post.id} style={styles.documentBox}>
                          <Text style={styles.detailsCar}>{post.title}</Text>
                          <Text style={styles.detailsLine}>{post.modeLabel} - {post.categoryLabel} - {post.location}</Text>
                          <Text style={styles.detailsLine}>{post.rent} - {post.expiryLabel}</Text>
                        </View>
                      )) : <Text style={styles.detailsLine}>No housing posts yet.</Text>}
                    </View>
                  ) : null}
                  <View style={styles.inlineActions}>
                    <SecondaryButton label="Support Center" onPress={() => setPanelMode("support")} />
                    {selectedBooking.manageUrl ? <SecondaryButton label="Open web details" onPress={() => Linking.openURL(selectedBooking.manageUrl)} /> : null}
                  </View>
                </>
              ) : null}

              {selectedBooking && panelMode === "support" ? (
                <>
                  <Text style={styles.policyCopy}>Create the same rental support ticket used by the web app. Urgent safety, pickup, lockout, or payment issues are escalated by priority.</Text>
                  <Summary booking={selectedBooking} />
                  <InputField label="Topic" value={supportTopic} onChangeText={setSupportTopic} />
                  <InputField label="Message" value={supportMessage} onChangeText={setSupportMessage} multiline placeholder="Tell us what you need help with." />
                  {(selectedBooking.supportTickets || []).length ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.sectionTitle}>Recent support</Text>
                      {(selectedBooking.supportTickets || []).map((ticket) => (
                        <Text key={ticket.ticketId} style={styles.detailsLine}>{ticket.ticketId} - {ticket.status} - {ticket.topic}</Text>
                      ))}
                    </View>
                  ) : null}
                  <View style={styles.inlineActions}>
                    <PrimaryButton label={busy ? "Sending..." : "Create ticket"} onPress={() => submitSupportTicket(false)} disabled={busy} />
                    <DangerButton label="Urgent" onPress={() => submitSupportTicket(true)} disabled={busy} />
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function panelTitle(mode: PanelMode) {
  if (mode === "modify") return "Modify reservation";
  if (mode === "cancel") return "Cancel reservation";
  if (mode === "documents") return "Invoice & documents";
  if (mode === "support") return "Support center";
  return "Booking details";
}

function InputField({
  label,
  value,
  onChangeText,
  multiline,
  placeholder
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.48)"
        multiline={multiline}
      />
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[styles.panelButton, disabled && styles.disabledButton]} onPress={onPress} disabled={disabled} activeOpacity={0.82}>
      <Text style={styles.panelButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function DangerButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[styles.panelButton, styles.dangerButton, disabled && styles.disabledButton]} onPress={onPress} disabled={disabled} activeOpacity={0.82}>
      <Text style={styles.panelButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.secondaryButton} onPress={onPress} activeOpacity={0.82}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function Summary({ booking }: { booking: RentalServiceBooking }) {
  return (
    <View style={styles.summaryBox}>
      <Text style={styles.detailsCar}>{booking.carName}</Text>
      <Text style={styles.detailsLine}>Booking: {booking.id}</Text>
      <Text style={styles.detailsLine}>Status: {booking.statusLabel}</Text>
      <Text style={styles.detailsLine}>Payment: {booking.paymentLabel}</Text>
    </View>
  );
}

function AmountPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.amountPill}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text style={styles.amountValue}>{value}</Text>
    </View>
  );
}

function ChoiceRow({
  label,
  detail,
  selected,
  onPress
}: {
  label: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.choiceRow, selected && styles.selectedChoiceRow]} onPress={onPress} activeOpacity={0.82}>
      <View style={styles.radioDot}>{selected ? <View style={styles.radioDotInner} /> : null}</View>
      <View style={styles.choiceRowCopy}>
        <Text style={styles.choiceRowLabel}>{label}</Text>
        <Text style={styles.choiceRowDetail}>{detail}</Text>
      </View>
    </TouchableOpacity>
  );
}

function ToggleRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.toggleRow} onPress={onPress} activeOpacity={0.82}>
      <View style={[styles.checkbox, selected && styles.checkedBox]}>{selected ? <Text style={styles.checkText}>✓</Text> : null}</View>
      <Text style={styles.toggleText}>{label}</Text>
    </TouchableOpacity>
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
    maxHeight: "88%",
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
    flex: 1,
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
  panelContent: {
    gap: 12,
    paddingBottom: 4
  },
  policyCopy: {
    color: theme.colors.muted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20
  },
  inputGroup: {
    flex: 1,
    gap: 7
  },
  input: {
    minHeight: 54,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "800",
    paddingHorizontal: 14
  },
  multilineInput: {
    minHeight: 96,
    paddingTop: 14,
    textAlignVertical: "top"
  },
  summaryBox: {
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.07)",
    padding: 14,
    gap: 6
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
  detailSection: {
    gap: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 14
  },
  twoColumn: {
    flexDirection: "row",
    gap: 10
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "900"
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
  },
  modifySummary: {
    flexDirection: "row",
    gap: 10
  },
  choiceRow: {
    minHeight: 70,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  selectedChoiceRow: {
    borderColor: theme.colors.blue,
    backgroundColor: "rgba(80,124,255,0.18)"
  },
  radioDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.64)",
    alignItems: "center",
    justifyContent: "center"
  },
  radioDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.blue
  },
  choiceRowCopy: {
    flex: 1,
    gap: 4
  },
  choiceRowLabel: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "900"
  },
  choiceRowDetail: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  choiceChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  activeChoiceChip: {
    backgroundColor: theme.colors.text,
    borderColor: theme.colors.text
  },
  choiceChipText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: "900"
  },
  activeChoiceChipText: {
    color: "#05070d"
  },
  toggleRow: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center"
  },
  checkedBox: {
    backgroundColor: theme.colors.blue,
    borderColor: theme.colors.blue
  },
  checkText: {
    color: theme.colors.text,
    fontWeight: "900"
  },
  toggleText: {
    color: theme.colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19
  },
  greenNote: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.28)",
    backgroundColor: "rgba(34,197,94,0.12)",
    padding: 14,
    gap: 4
  },
  greenNoteTitle: {
    color: "#bbf7d0",
    fontSize: 15,
    fontWeight: "900"
  },
  greenNoteBody: {
    color: "#dcfce7",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18
  },
  refundBox: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 14,
    gap: 5
  },
  refundAmount: {
    color: "#4ade80",
    fontSize: 24,
    fontWeight: "900"
  },
  detailTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  detailTab: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.05)"
  },
  activeDetailTab: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent
  },
  detailTabText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: "900"
  },
  activeDetailTabText: {
    color: theme.colors.text
  },
  countdownRow: {
    flexDirection: "row",
    gap: 8
  },
  documentBox: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 14,
    gap: 6
  },
  inlineActions: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap"
  },
  panelButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: theme.colors.blue,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    flex: 1
  },
  dangerButton: {
    backgroundColor: theme.colors.accent
  },
  disabledButton: {
    opacity: 0.58
  },
  panelButtonText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "900"
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flex: 1
  },
  secondaryButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "900"
  }
});
