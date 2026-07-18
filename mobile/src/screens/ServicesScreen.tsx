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
  requestRentalModification
} from "../api/client";
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

type PanelMode = "modify" | "cancel" | "documents" | "details" | "support" | null;

function bookingTitle(booking: RentalServiceBooking | null) {
  if (!booking) return "Select rental booking";
  return `${booking.carName || "Rental car"} - ${booking.pickupDate || "Pickup pending"}`;
}

function selectedBookingCopy(booking: RentalServiceBooking | null, busy: boolean) {
  if (booking) return `${booking.statusLabel} - ${booking.totalLabel}`;
  if (busy) return "Loading bookings...";
  return "Sign in and book a rental car first";
}

function mergeBooking(rows: RentalServiceBooking[], updated?: RentalServiceBooking) {
  if (!updated) return rows;
  return rows.map((booking) => (booking.id === updated.id ? updated : booking));
}

export function ServicesScreen(_props: Props) {
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
  const [modifyNote, setModifyNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [supportTopic, setSupportTopic] = useState("Rental support");
  const [supportMessage, setSupportMessage] = useState("");

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

  useEffect(() => {
    if (!selectedBooking) return;
    setPickupLocation(selectedBooking.pickupLocation || "");
    setReturnLocation(selectedBooking.returnLocation || "");
    setPickupDate(selectedBooking.pickupDate || "");
    setReturnDate(selectedBooking.returnDate || "");
    setPickupTime(selectedBooking.pickupTime || "");
    setReturnTime(selectedBooking.returnTime || "");
    setCancelReason("Customer cancellation request");
    setModifyNote("");
    setSupportTopic("Rental support");
    setSupportMessage("");
  }, [selectedBooking?.id]);

  function requireBooking(action: (booking: RentalServiceBooking) => void) {
    if (!selectedBooking) {
      Alert.alert("Choose a booking", "Select one of your rental car bookings first.");
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
    setBusy(true);
    try {
      const result = await requestRentalCancellation(selectedBooking.id, cancelReason || "Customer cancellation request");
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
      const result = await emailRentalDocuments(selectedBooking.id);
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
          <TouchableOpacity style={styles.bookingSelect} onPress={() => setBookingMenuOpen((open) => !open)} activeOpacity={0.82}>
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
                  <Text style={styles.policyCopy}>Request pickup, return, date, or time changes. FairFares recalculates the trip and flags the booking for review like the web manage-booking flow.</Text>
                  <InputField label="Pickup location" value={pickupLocation} onChangeText={setPickupLocation} />
                  <InputField label="Return location" value={returnLocation} onChangeText={setReturnLocation} />
                  <InputField label="Pickup date" value={pickupDate} onChangeText={setPickupDate} placeholder="YYYY-MM-DD" />
                  <InputField label="Return date" value={returnDate} onChangeText={setReturnDate} placeholder="YYYY-MM-DD" />
                  <InputField label="Pickup time" value={pickupTime} onChangeText={setPickupTime} placeholder="10:00 AM" />
                  <InputField label="Return time" value={returnTime} onChangeText={setReturnTime} placeholder="10:00 AM" />
                  <InputField label="Notes for FairFares" value={modifyNote} onChangeText={setModifyNote} multiline placeholder="Tell us what changed." />
                  <PrimaryButton label={busy ? "Saving..." : "Submit modification request"} onPress={submitModification} disabled={busy} />
                </>
              ) : null}

              {selectedBooking && panelMode === "cancel" ? (
                <>
                  <Text style={styles.policyCopy}>Cancel requests follow the web cancellation policy: eligible holds may cancel automatically; other bookings go to admin review with a support task.</Text>
                  <Summary booking={selectedBooking} />
                  <InputField label="Cancellation reason" value={cancelReason} onChangeText={setCancelReason} multiline />
                  <DangerButton label={busy ? "Sending..." : "Request cancellation"} onPress={submitCancellation} disabled={busy} />
                </>
              ) : null}

              {selectedBooking && panelMode === "documents" ? (
                <>
                  <Text style={styles.policyCopy}>Invoices and pickup documents are available after pickup is completed. Cancelled bookings keep documents for recordkeeping when generated.</Text>
                  <Summary booking={selectedBooking} />
                  <View style={styles.documentBox}>
                    <Text style={styles.amountLabel}>Invoice</Text>
                    <Text style={styles.detailsLine}>{selectedBooking.invoiceNumber || "No generated invoice number yet"}</Text>
                    <Text style={styles.detailsLine}>{selectedBooking.invoiceUrl ? "PDF is ready to open." : "Use email documents when the booking is eligible."}</Text>
                  </View>
                  <PrimaryButton label={selectedBooking.invoiceUrl ? "Open invoice" : "Email rental documents"} onPress={sendDocuments} disabled={busy} />
                </>
              ) : null}

              {selectedBooking && panelMode === "details" ? (
                <>
                  <Summary booking={selectedBooking} />
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionTitle}>Trip</Text>
                    <Text style={styles.detailsLine}>Pickup: {selectedBooking.pickupLocation}</Text>
                    <Text style={styles.detailsLine}>{selectedBooking.pickupDate} at {selectedBooking.pickupTime}</Text>
                    <Text style={styles.detailsLine}>Return: {selectedBooking.returnLocation}</Text>
                    <Text style={styles.detailsLine}>{selectedBooking.returnDate} at {selectedBooking.returnTime}</Text>
                  </View>
                  <View style={styles.detailSection}>
                    <Text style={styles.sectionTitle}>Payment</Text>
                    <View style={styles.amountGrid}>
                      <AmountPill label="Total" value={selectedBooking.totalLabel} />
                      <AmountPill label="Due pickup" value={selectedBooking.dueAtPickupLabel} />
                    </View>
                    <View style={styles.amountGrid}>
                      <AmountPill label="Due now" value={selectedBooking.dueNowLabel} />
                      <AmountPill label="Payment" value={selectedBooking.paymentLabel} />
                    </View>
                  </View>
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
