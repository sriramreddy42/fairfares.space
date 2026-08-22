import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Image, ImageSourcePropType, Linking, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { createSupportTicket, getHousingActivity, getRentalBookings, getRideActivity, requestAccountDeletion as submitAccountDeletionRequest, updateMobileProfile } from "../api/client";
import { UserAvatar } from "../components/UserAvatar";
import { appAssets } from "../assets";
import { SectionHeader } from "../components/SectionHeader";
import { DateTimeField, todayLocalIso } from "../components/DateTimeField";
import { theme } from "../theme";
import { useResponsiveLayout } from "../utils/layout";
import { BootstrapPayload, HousingActivityPost, RentalServiceBooking, RidePost } from "../types";
import { pickCompressedImages } from "../utils/imageUpload";
import { syncChatIdentityRecovery } from "../utils/chatRecovery";

type Props = {
  data: BootstrapPayload | null;
  onLogin: () => void;
  onLogout: () => void;
  onProfileUpdated: (user: BootstrapPayload["user"]) => void;
  onOpenHousing?: () => void;
  onOpenRide?: (target?: "workspace" | "requests" | "listings", rideId?: string) => void;
  onOpenServices?: (bookingId?: string) => void;
  onOpenMessenger?: () => void;
  onOpenStaffPickup?: () => void;
  openProfileDetails?: boolean;
  onProfileDetailsOpened?: () => void;
};

const SUPPORT_TOPICS = ["App problem", "Account", "Payment", "Housing", "Carpool", "Rental", "Safety"];
type AccountHistorySection = "housing" | "carpool" | "rentals";
type CarpoolHistoryView = "listings" | "requests";
type AccountHistoryItem = { id: string; sourceId: string; title: string; meta: string; status: string; current: boolean; kind: string; editable: boolean };
const PAST_RIDE_STATUSES = new Set(["COMPLETED", "CANCELLED", "CANCELED", "EXPIRED", "DECLINED"]);
const PAST_RENTAL_STATUSES = new Set(["COMPLETED", "CANCELLED", "CANCELED", "RETURNED", "EXPIRED_HOLD"]);
const profileDraftKey = (userId: number) => `fairfares.mobile.profileDraft.${userId}`;

function firstInitial(name = "") {
  return name.trim().slice(0, 1).toUpperCase() || "F";
}

export function ProfileScreen({
  data,
  onLogin,
  onLogout,
  onProfileUpdated,
  onOpenHousing,
  onOpenRide,
  onOpenServices,
  onOpenMessenger,
  onOpenStaffPickup,
  openProfileDetails = false,
  onProfileDetailsOpened
}: Props) {
  const user = data?.user;
  const layout = useResponsiveLayout();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [dateOfBirth, setDateOfBirth] = useState(user?.dateOfBirth || "");
  const [profilePhoto, setProfilePhoto] = useState(user?.profilePhotoUrl || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [savingMode, setSavingMode] = useState<"photo" | "details" | "">("");
  const profileMutationRunningRef = useRef(false);
  const currentProfileUserIdRef = useRef(Number(user?.id || 0));
  currentProfileUserIdRef.current = Number(user?.id || 0);
  const saving = Boolean(savingMode);
  const [profileDirty, setProfileDirty] = useState(false);
  const draftUserIdRef = useRef<number | null>(null);
  const [rideActivity, setRideActivity] = useState<RidePost[]>([]);
  const [housingActivity, setHousingActivity] = useState<HousingActivityPost[]>([]);
  const [rentalActivity, setRentalActivity] = useState<RentalServiceBooking[]>([]);
  const [historySection, setHistorySection] = useState<AccountHistorySection | null>(null);
  const [carpoolHistoryView, setCarpoolHistoryView] = useState<CarpoolHistoryView>("listings");
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportTopic, setSupportTopic] = useState(SUPPORT_TOPICS[0]);
  const [supportMessage, setSupportMessage] = useState("");
  const [supportUrgent, setSupportUrgent] = useState(false);
  const [supportSending, setSupportSending] = useState(false);

  useEffect(() => {
    if (!openProfileDetails || !user) return;
    setProfileDetailsOpen(true);
    onProfileDetailsOpened?.();
  }, [onProfileDetailsOpened, openProfileDetails, user]);

  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (draftUserIdRef.current === nextUserId && profileDirty) return;
    draftUserIdRef.current = nextUserId;
    setName(user?.name || "");
    setEmail(user?.email || "");
    setPhone(user?.phone || "");
    setDateOfBirth(user?.dateOfBirth || "");
    setProfilePhoto(user?.profilePhotoUrl || "");
    setCurrentPassword("");
    setProfileDirty(false);
  }, [profileDirty, user?.id, user?.name, user?.email, user?.phone, user?.dateOfBirth, user?.profilePhotoUrl]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    AsyncStorage.getItem(profileDraftKey(user.id)).then((saved) => {
      if (cancelled || !saved) return;
      try {
        const draft = JSON.parse(saved) as { name?: string; email?: string; phone?: string; dateOfBirth?: string };
        setName(draft.name ?? user.name ?? "");
        setEmail(draft.email ?? user.email ?? "");
        setPhone(draft.phone ?? user.phone ?? "");
        setDateOfBirth(draft.dateOfBirth ?? user.dateOfBirth ?? "");
        // The server photo is authoritative. Persisting a photo data URL or an
        // old versioned URL here could overwrite the current avatar after a
        // relaunch even though every other screen had already refreshed.
        setProfilePhoto(user.profilePhotoUrl ?? "");
        setProfileDirty(true);
      } catch {
        void AsyncStorage.removeItem(profileDraftKey(user.id));
      }
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !profileDirty) return;
    const timer = setTimeout(() => {
      void AsyncStorage.setItem(profileDraftKey(user.id), JSON.stringify({ name, email, phone, dateOfBirth }));
    }, 250);
    return () => clearTimeout(timer);
  }, [dateOfBirth, email, name, phone, profileDirty, user?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadAccountActivity() {
      if (!user) {
        setRideActivity([]);
        setHousingActivity([]);
        setRentalActivity([]);
        return;
      }
      const [activityResult, housingResult, rentalResult] = await Promise.allSettled([getRideActivity(), getHousingActivity(), getRentalBookings()]);
      if (cancelled) return;
      setRideActivity(activityResult.status === "fulfilled" ? activityResult.value : []);
      setHousingActivity(housingResult.status === "fulfilled" ? housingResult.value : []);
      setRentalActivity(rentalResult.status === "fulfilled" ? rentalResult.value : []);
    }
    void loadAccountActivity();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const displayName = user?.name || "FairFares Guest";
  const sensitiveChanged = Boolean(user && (
    email.trim().toLowerCase() !== user.email.toLowerCase()
    || phone.replace(/\D/g, "") !== String(user.phone || "").replace(/\D/g, "")
  ));
  const completingInitialPhone = Boolean(user && !String(user.phone || "").replace(/\D/g, "") && phone.replace(/\D/g, ""));
  const canSaveProfile = Boolean(user && profileDirty && name.trim() && email.trim() && (!sensitiveChanged || completingInitialPhone || currentPassword.trim()) && !saving);
  const accountHistoryItems = useMemo<AccountHistoryItem[]>(() => {
    if (historySection === "housing") return housingActivity.map((post) => ({
      id: post.id,
      sourceId: post.id,
      title: post.title,
      meta: `${post.location} · ${post.modeLabel}`,
      status: post.expiryLabel,
      current: post.status === "ACTIVE" && post.expiryLabel !== "Expired",
      kind: /need|looking|request/i.test(post.modeLabel) ? "Request" : "Listing",
      editable: false
    }));
    if (historySection === "carpool") return rideActivity.filter((ride) => carpoolHistoryView === "listings"
      ? ride.activityRole === "MINE" && ride.role === "DRIVER"
      : !(ride.activityRole === "MINE" && ride.role === "DRIVER")
    ).map((ride) => {
      const status = String(ride.dispatchStatus || ride.status || "Active").replaceAll("_", " ");
      const requestType = ride.activityRole === "DRIVER_NOTIFICATION" ? "Received request" : "Your request";
      return {
        id: `${ride.activityRole || "ride"}-${ride.id}`,
        sourceId: ride.id,
        title: `${ride.origin || "Pickup"} → ${ride.destination || "Destination"}`,
        meta: [carpoolHistoryView === "requests" ? requestType : "Seat listing", ride.pickupDate || ride.startDate, ride.pickupTime].filter(Boolean).join(" · ") || "Timing open",
        status,
        current: !PAST_RIDE_STATUSES.has(status.toUpperCase()) && !ride.isExpired,
        kind: carpoolHistoryView === "listings" ? "Listing" : "Request",
        editable: ride.activityRole === "MINE"
      };
    });
    if (historySection === "rentals") return rentalActivity.map((booking) => {
      const status = String(booking.statusLabel || booking.status || "Current").replaceAll("_", " ");
      return {
        id: String(booking.id),
        sourceId: String(booking.id),
        title: booking.carName || "Rental car",
        meta: [booking.pickupDate, booking.pickupLocation].filter(Boolean).join(" · "),
        status,
        current: !PAST_RENTAL_STATUSES.has(String(booking.status || "").toUpperCase()),
        kind: "Booking",
        editable: true
      };
    });
    return [];
  }, [carpoolHistoryView, historySection, housingActivity, rentalActivity, rideActivity]);
  const currentHistoryItems = accountHistoryItems.filter((item) => item.current);
  const previousHistoryItems = accountHistoryItems.filter((item) => !item.current);
  const historyTitle = historySection === "housing" ? "Your listings" : historySection === "carpool" ? "Carpool history" : "Rental car history";
  const historyAction = historySection === "housing" ? onOpenHousing : historySection === "carpool" ? onOpenRide : onOpenServices;
  const profileLinks: Array<{ title: string; copy: string; icon?: ImageSourcePropType; glyph?: string; fullColor?: boolean; onPress?: () => void; requiresUser?: boolean; danger?: boolean }> = [
    { title: "Housing", copy: "Your posted rooms, homes, and roommate searches", icon: appAssets.serviceHome, onPress: () => user ? setHistorySection("housing") : onLogin() },
    { title: "Carpool", copy: "Your listings, requests, and previous trips", icon: appAssets.carpoolProfile, fullColor: true, onPress: () => { if (!user) return onLogin(); setCarpoolHistoryView("listings"); setHistorySection("carpool"); } },
    { title: "Rental Cars", copy: "Current and previous bookings", glyph: "🔑", onPress: () => user ? setHistorySection("rentals") : onLogin() },
    { title: "Chitthi", copy: "Current and previous conversations", icon: appAssets.chittiMascot, fullColor: true, onPress: onOpenMessenger },
    { title: "Report an issue", copy: "Send a tracked support or safety report", icon: appAssets.serviceSupport, onPress: () => user ? setSupportOpen(true) : onLogin() },
    { title: "Terms of Service", copy: "Rules for using FairFares", glyph: "§", onPress: () => void Linking.openURL("https://www.fairfare.space/terms") },
    { title: "Community Guidelines", copy: "Safety and conduct standards", glyph: "♢", onPress: () => void Linking.openURL("https://www.fairfare.space/community-guidelines") },
    { title: "Privacy Policy", copy: "Data use and protection", icon: appAssets.serviceEye, onPress: () => void Linking.openURL("https://www.fairfare.space/privacy") },
    { title: "Delete account", copy: "Request account and data deletion", glyph: "⌫", requiresUser: true, danger: true, onPress: requestAccountDeletion }
  ];

  function requestAccountDeletion() {
    if (!user) {
      onLogin();
      return;
    }
    Alert.alert(
      "Request account deletion?",
      "FairFares will verify the request, close access, and delete data that is not legally required for bookings, payments, safety, fraud prevention, or disputes.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Request deletion",
          style: "destructive",
          onPress: async () => {
            try {
              const result = await submitAccountDeletionRequest("DELETE");
              Alert.alert("Deletion request received", `${result.request.requestId}\nDue by ${result.request.deletionDueAt} UTC. A confirmation was sent to your account email.`);
            } catch (error) {
              Alert.alert("Request not sent", error instanceof Error ? error.message : "Please try again.", [
                { text: "Cancel", style: "cancel" },
                { text: "Email support", onPress: () => void Linking.openURL("mailto:hello@fairfare.space?subject=FairFares%20account%20deletion%20request") }
              ]);
            }
          }
        }
      ]
    );
  }

  async function choosePhoto() {
    if (!user) {
      onLogin();
      return;
    }
    if (profileMutationRunningRef.current) return;
    profileMutationRunningRef.current = true;
    setSavingMode("photo");
    const operationUserId = Number(user.id || 0);
    const previousPhoto = profilePhoto;
    let selectedPhoto = "";
    try {
      const picked = await pickCompressedImages(1, 720, 0.7);
      selectedPhoto = picked[0] || "";
      if (selectedPhoto && currentProfileUserIdRef.current === operationUserId) {
        // Show the selected image immediately, then replace the local data URL
        // with the authoritative versioned server URL. Requiring a second Save
        // tap left the Account header updated while the bottom tab, Chitthi,
        // and testimonials correctly continued showing the older saved photo.
        setProfilePhoto(selectedPhoto);
        const payload = await updateMobileProfile({ profilePhoto: selectedPhoto });
        if (currentProfileUserIdRef.current !== operationUserId || Number(payload.user?.id || 0) !== operationUserId) return;
        setProfilePhoto(payload.user?.profilePhotoUrl || "");
        onProfileUpdated(payload.user);
        Alert.alert("Profile photo updated", "Your new photo is now used across FairFares.");
      }
    } catch (error) {
      if (currentProfileUserIdRef.current !== operationUserId) return;
      setProfilePhoto((current) => !selectedPhoto || current === selectedPhoto ? previousPhoto : current);
      Alert.alert("Photo not saved", error instanceof Error ? error.message : "Could not save your profile photo.");
    } finally {
      profileMutationRunningRef.current = false;
      setSavingMode("");
    }
  }

  async function saveProfile() {
    if (!user) {
      onLogin();
      return;
    }
    if (profileMutationRunningRef.current) return;
    profileMutationRunningRef.current = true;
    setSavingMode("details");
    const operationUserId = Number(user.id || 0);
    try {
      const phoneChanged = phone.replace(/\D/g, "") !== String(user.phone || "").replace(/\D/g, "");
      const payload = await updateMobileProfile({
        name,
        email,
        phone,
        dateOfBirth,
        currentPassword,
      });
      if (currentProfileUserIdRef.current !== operationUserId || Number(payload.user?.id || 0) !== operationUserId) return;
      draftUserIdRef.current = payload.user?.id ?? user.id;
      setName(payload.user?.name || "");
      setEmail(payload.user?.email || "");
      setPhone(payload.user?.phone || "");
      setDateOfBirth(payload.user?.dateOfBirth || "");
      setProfilePhoto(payload.user?.profilePhotoUrl || "");
      onProfileUpdated(payload.user);
      setProfileDirty(false);
      void AsyncStorage.removeItem(profileDraftKey(user.id));
      if (payload.activationRequired) {
        Alert.alert("Verify your new email", payload.message || "Please activate your new email before logging in again.");
        onLogout();
      } else {
        if (phoneChanged && currentPassword) {
          await syncChatIdentityRecovery(Number(payload.user?.id || user.id), currentPassword).catch(() => undefined);
        }
        setCurrentPassword("");
        Alert.alert("Profile updated", payload.message || "Your FairFares profile was saved.");
      }
    } catch (error) {
      if (currentProfileUserIdRef.current !== operationUserId) return;
      Alert.alert("Profile not saved", error instanceof Error ? error.message : "Could not save your profile.");
    } finally {
      profileMutationRunningRef.current = false;
      setSavingMode("");
    }
  }

  async function submitIssue() {
    if (supportMessage.trim().length < 10) {
      Alert.alert("Add more detail", "Please describe what happened in at least 10 characters.");
      return;
    }
    setSupportSending(true);
    try {
      const result = await createSupportTicket(null, supportTopic, supportMessage.trim(), supportUrgent);
      setSupportOpen(false);
      setSupportMessage("");
      setSupportUrgent(false);
      Alert.alert("Issue reported", `${result.ticketId}\nPriority ${result.priority} · ${result.sla}`);
    } catch (error) {
      Alert.alert("Report not sent", error instanceof Error ? error.message : "Please try again.", [
        { text: "Cancel", style: "cancel" },
        { text: "Email support", onPress: () => void Linking.openURL("mailto:hello@fairfare.space?subject=FairFares%20support%20request") }
      ]);
    } finally {
      setSupportSending(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: layout.navClearance }
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <SectionHeader eyebrow="Account" title={displayName} />
          <View style={styles.badgeRow}>
            <View style={styles.badge}><Text style={styles.badgeText}>{user?.isVerified ? "Email verified" : "Email pending"}</Text></View>
            <View style={styles.badge}><Text style={styles.badgeText}>{user?.phone ? "Phone on file" : "Add phone"}</Text></View>
          </View>
        </View>
        <TouchableOpacity style={styles.avatar} onPress={choosePhoto} disabled={saving}>
          <UserAvatar
            photoUrl={profilePhoto}
            style={styles.avatarImage}
            imageStyle={styles.avatarImage}
            fallback={<Text style={styles.avatarText}>{firstInitial(displayName)}</Text>}
          />
        </TouchableOpacity>
      </View>

      {!user ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Login to personalize FairFares</Text>
          <Text style={styles.cardCopy}>Messaging, profile photos, listings, ride requests, and carpool tools need an account.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onLogin}>
            <Text style={styles.primaryButtonText}>Login / Sign up</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.profileDetailsHeader}
            onPress={() => setProfileDetailsOpen((current) => !current)}
            accessibilityRole="button"
            accessibilityState={{ expanded: profileDetailsOpen }}
          >
            <View style={styles.profileDetailsHeaderCopy}>
              <Text style={styles.cardTitle}>Profile details</Text>
              <Text style={styles.profileDetailsSummary}>{profileDetailsOpen ? "Hide personal information" : "Name, email, phone and profile photo"}</Text>
            </View>
            <Text style={styles.profileDetailsChevron}>{profileDetailsOpen ? "⌃" : "⌄"}</Text>
          </TouchableOpacity>
          {profileDetailsOpen ? <>
            <Text style={styles.label}>Full name</Text>
            <TextInput value={name} onChangeText={(value) => { setName(value); setProfileDirty(true); }} style={styles.input} placeholder="Your name" placeholderTextColor={theme.colors.muted} />
            <Text style={styles.label}>Email</Text>
            <TextInput value={email} onChangeText={(value) => { setEmail(value); setProfileDirty(true); }} style={styles.input} placeholder="Email" placeholderTextColor={theme.colors.muted} autoCapitalize="none" keyboardType="email-address" />
            <Text style={styles.label}>Phone</Text>
            <TextInput value={phone} onChangeText={(value) => { setPhone(value); setProfileDirty(true); }} style={styles.input} placeholder="Phone number, including +country code" placeholderTextColor={theme.colors.muted} keyboardType="phone-pad" autoComplete="tel" />
            {completingInitialPhone ? <Text style={styles.securityNote}>Include the country code, for example +1 303 555 0123 or +91 98765 43210.</Text> : null}
            <DateTimeField label="Birthday (optional)" value={dateOfBirth} mode="date" minimumDate="1906-01-01" maximumDate={todayLocalIso()} placeholder="Add birthday" onChange={(value) => { setDateOfBirth(value); setProfileDirty(true); }} />
            <Text style={styles.cardCopy}>Used only for birthday greetings and optional offers. You can remove it anytime.</Text>
            {dateOfBirth ? <TouchableOpacity style={styles.secondaryButton} onPress={() => { setDateOfBirth(""); setProfileDirty(true); }}><Text style={styles.secondaryButtonText}>Remove birthday</Text></TouchableOpacity> : null}
            {sensitiveChanged && !completingInitialPhone ? (
            <>
              <Text style={styles.securityNote}>Current password is required to change email or phone. Email changes require activation before the next login.</Text>
              <Text style={styles.label}>Current password</Text>
              <TextInput value={currentPassword} onChangeText={(value) => { setCurrentPassword(value); setProfileDirty(true); }} style={styles.input} placeholder="Current password" placeholderTextColor={theme.colors.muted} secureTextEntry />
            </>
            ) : null}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.secondaryButton} onPress={choosePhoto} disabled={saving}>
                <Text style={styles.secondaryButtonText}>{savingMode === "photo" ? "Saving photo…" : "Upload photo"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButton, !canSaveProfile && styles.disabled]} onPress={saveProfile} disabled={!canSaveProfile}>
                <Text style={styles.primaryButtonText}>{savingMode === "details" ? "Saving..." : profileDirty && sensitiveChanged && !completingInitialPhone && !currentPassword.trim() ? "Password required" : profileDirty ? "Save profile" : "Saved"}</Text>
              </TouchableOpacity>
            </View>
          </> : null}
        </View>
      )}

      {profileLinks.filter(({ requiresUser }) => !requiresUser || user).map(({ title, copy, icon, glyph, fullColor, onPress, danger }) => (
        <TouchableOpacity key={title} style={styles.menuRow} onPress={onPress}>
          <View style={[styles.menuIconCircle, danger && styles.menuDangerIconCircle]}>
            {icon ? (
              <Image source={icon} style={[styles.menuIcon, fullColor && styles.menuIconFullColor]} resizeMode="contain" />
            ) : (
              <Text style={[styles.menuGlyph, danger && styles.menuDangerGlyph]}>{glyph}</Text>
            )}
          </View>
          <View style={styles.menuTextBlock}>
            <Text style={[styles.menuTitle, danger && styles.menuDangerTitle]}>{title}</Text>
            <Text style={styles.menuCopy}>{copy}</Text>
          </View>
          <Text style={styles.menuChevron}>›</Text>
        </TouchableOpacity>
      ))}
      {user ? (
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>Log out of FairFares</Text>
        </TouchableOpacity>
      ) : null}
      <Modal visible={Boolean(historySection)} transparent animationType="slide" onRequestClose={() => setHistorySection(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.historySheet}>
            <View style={styles.supportHeader}>
              <View style={styles.supportHeaderCopy}>
                <Text style={styles.cardTitle}>{historyTitle}</Text>
                <Text style={styles.cardCopy}>{historySection === "housing" ? "Listings connected only to your FairFares account." : "Records connected only to your FairFares account."}</Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={() => setHistorySection(null)} accessibilityLabel="Close history">
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>
            {historySection === "carpool" ? (
              <View style={styles.historyTabs} accessibilityRole="tablist">
                {(["listings", "requests"] as CarpoolHistoryView[]).map((view) => {
                  const active = carpoolHistoryView === view;
                  const count = view === "listings"
                    ? rideActivity.filter((ride) => ride.activityRole === "MINE" && ride.role === "DRIVER").length
                    : rideActivity.filter((ride) => !(ride.activityRole === "MINE" && ride.role === "DRIVER")).length;
                  return (
                    <TouchableOpacity key={view} style={[styles.historyTab, active && styles.historyTabActive]} onPress={() => setCarpoolHistoryView(view)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                      <Text style={[styles.historyTabText, active && styles.historyTabTextActive]}>{view === "listings" ? "Listings" : "Requests"} · {count}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
            <ScrollView style={styles.historyScroll} contentContainerStyle={styles.historyContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.historySectionTitle}>Current · {currentHistoryItems.length}</Text>
              {currentHistoryItems.length ? currentHistoryItems.map((item) => (
                <View key={`current-${item.id}`} style={styles.historyRow}>
                  <View style={styles.historyRowCopy}><Text style={styles.historyKind}>{item.kind} · Current</Text><Text style={styles.historyItemTitle}>{item.title}</Text><Text style={styles.historyItemMeta}>{item.meta}</Text></View>
                  <View style={styles.historyRowActions}><Text style={styles.historyCurrentBadge}>{item.status}</Text><TouchableOpacity style={styles.historyEditButton} onPress={() => { setHistorySection(null); historySection === "carpool" ? onOpenRide?.(carpoolHistoryView, item.editable ? item.sourceId : undefined) : historySection === "rentals" ? onOpenServices?.(item.sourceId) : historyAction?.(); }}><Text style={styles.historyEditText}>{item.editable ? "Edit" : "Manage"}</Text></TouchableOpacity></View>
                </View>
              )) : <Text style={styles.historyEmpty}>No current records.</Text>}
              <Text style={styles.historySectionTitle}>Expired / completed · {previousHistoryItems.length}</Text>
              {previousHistoryItems.length ? previousHistoryItems.map((item) => (
                <View key={`previous-${item.id}`} style={styles.historyRow}>
                  <View style={styles.historyRowCopy}><Text style={styles.historyKind}>{item.kind} · Expired</Text><Text style={styles.historyItemTitle}>{item.title}</Text><Text style={styles.historyItemMeta}>{item.meta}</Text></View>
                  <Text style={styles.historyPreviousBadge}>{item.status}</Text>
                </View>
              )) : <Text style={styles.historyEmpty}>No previous records yet.</Text>}
            </ScrollView>
            <TouchableOpacity style={styles.historyManageButton} onPress={() => { setHistorySection(null); historySection === "carpool" ? onOpenRide?.(carpoolHistoryView) : historyAction?.(); }}>
              <Text style={styles.primaryButtonText}>Manage {historySection === "carpool" ? carpoolHistoryView : historySection === "rentals" ? "rentals" : "listings"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={supportOpen} transparent animationType="slide" onRequestClose={() => setSupportOpen(false)}>
        <View style={[styles.modalBackdrop, styles.supportModalBackdrop]}>
          <View style={styles.supportSheet}>
            <View style={styles.supportHeader}>
              <View style={styles.supportHeaderCopy}>
                <Text style={styles.cardTitle}>Report an issue</Text>
                <Text style={styles.cardCopy}>Tell us what happened. You will receive a ticket number.</Text>
              </View>
              <TouchableOpacity style={styles.closeButton} onPress={() => setSupportOpen(false)} accessibilityLabel="Close issue form">
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.supportScroll} contentContainerStyle={styles.supportContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>What is this about?</Text>
              <View style={styles.topicRow}>
                {SUPPORT_TOPICS.map((topic) => (
                  <TouchableOpacity key={topic} style={[styles.topicChip, topic === supportTopic && styles.topicChipActive]} onPress={() => setSupportTopic(topic)}>
                    <Text style={[styles.topicText, topic === supportTopic && styles.topicTextActive]}>{topic}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>What happened?</Text>
              <TextInput
                style={styles.supportInput}
                value={supportMessage}
                onChangeText={setSupportMessage}
                placeholder="Include the screen, action, error message, and what you expected."
                placeholderTextColor={theme.colors.muted}
                multiline
                maxLength={1500}
                textAlignVertical="top"
              />
              <Text style={styles.characterCount}>{supportMessage.length}/1500</Text>
              <View style={styles.urgentRow}>
                <View style={styles.privacyCopy}>
                  <Text style={styles.supportUrgentTitle}>Urgent safety concern</Text>
                  <Text style={styles.cardCopy}>Use only for an immediate safety or active-trip issue.</Text>
                </View>
                <Switch value={supportUrgent} onValueChange={setSupportUrgent} />
              </View>
              <TouchableOpacity style={[styles.primaryButton, (supportSending || supportMessage.trim().length < 10) && styles.disabled]} disabled={supportSending || supportMessage.trim().length < 10} onPress={() => void submitIssue()}>
                <Text style={styles.primaryButtonText}>{supportSending ? "Sending…" : "Send issue report"}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { width: "100%", maxWidth: 980, alignSelf: "center", padding: 14, paddingBottom: 108, gap: 12 },
  hero: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  heroCopy: { flex: 1 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 6 },
  badge: { backgroundColor: theme.colors.panel2, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { color: theme.colors.soft, fontWeight: "700", fontSize: 11 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.line, overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  avatarText: { color: theme.colors.text, fontSize: 26, fontWeight: "800" },
  selector: { backgroundColor: theme.colors.panel2, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  selectorText: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  card: { ...theme.depth.card, padding: 14, gap: 8 },
  cardTitle: { color: theme.colors.text, ...theme.typography.sectionTitle },
  profileDetailsHeader: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  profileDetailsHeaderCopy: { flex: 1, minWidth: 0 },
  profileDetailsSummary: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  profileDetailsChevron: { color: theme.colors.soft, fontSize: 24, lineHeight: 26 },
  cardCopy: { color: theme.colors.muted, ...theme.typography.body },
  label: { color: theme.colors.muted, fontWeight: "700", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.5 },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, minHeight: 48, paddingHorizontal: 13, fontSize: 15 },
  securityNote: { color: theme.colors.soft, fontSize: 12, lineHeight: 17, fontWeight: "600", backgroundColor: "rgba(37,99,235,0.12)", borderRadius: theme.radius.md, padding: 10 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 4 },
  privacyRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.line },
  privacyCopy: { flex: 1 },
  primaryButton: { flex: 1, backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingVertical: 12, alignItems: "center" },
  primaryButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingVertical: 12, alignItems: "center" },
  secondaryButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.7 },
  logoutButton: { minHeight: 50, borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(248,113,113,0.5)", backgroundColor: "rgba(127,29,29,0.14)", alignItems: "center", justifyContent: "center", paddingHorizontal: 14, marginTop: 4 },
  logoutText: { color: "#f87171", fontWeight: "700", fontSize: 14 },
  activityCard: { backgroundColor: "#152219", borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "rgba(34,197,94,0.4)", gap: 8 },
  statusCard: { backgroundColor: theme.colors.panel, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: theme.colors.line, gap: 9 },
  statusTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  statusCopy: { flex: 1, minWidth: 0 },
  statusBadge: { borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line },
  statusBadgeReady: { backgroundColor: "rgba(34,197,94,0.22)", borderColor: "rgba(34,197,94,0.55)" },
  statusBadgeText: { color: theme.colors.text, fontSize: 11, fontWeight: "700" },
  linkRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  miniButton: { borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: theme.colors.panel2 },
  miniButtonText: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },
  metricRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { flexGrow: 1, minWidth: 105, borderWidth: 1, borderColor: "rgba(34,197,94,0.42)", borderRadius: theme.radius.md, paddingHorizontal: 11, paddingVertical: 8 },
  metricValue: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  metricLabel: { color: theme.colors.soft, fontWeight: "600", fontSize: 11, marginTop: 1 },
  menuRow: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, minHeight: 70, paddingHorizontal: 13, paddingVertical: 11, borderWidth: 1, borderColor: theme.colors.line, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 11 },
  menuIconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  menuIcon: { width: 23, height: 23, tintColor: theme.colors.soft },
  menuIconFullColor: { width: 27, height: 27, tintColor: undefined },
  menuGlyph: { color: theme.colors.soft, fontSize: 22, lineHeight: 25, fontWeight: "600" },
  menuDangerIconCircle: { backgroundColor: "rgba(248,113,113,0.10)" },
  menuDangerGlyph: { color: "#f87171" },
  menuTextBlock: { flex: 1, minWidth: 0 },
  menuTitle: { color: theme.colors.text, ...theme.typography.cardTitle },
  menuDangerTitle: { color: "#f87171" },
  menuCopy: { color: theme.colors.muted, ...theme.typography.caption, marginTop: 2 },
  menuChevron: { color: theme.colors.soft, fontSize: 24, fontWeight: "500" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.68)" },
  supportModalBackdrop: { justifyContent: "flex-start" },
  supportSheet: { flex: 1, width: "100%", backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, paddingTop: 52, paddingHorizontal: 18, paddingBottom: 18, gap: 14 },
  supportScroll: { flex: 1 },
  supportContent: { gap: 11, paddingBottom: 28 },
  historySheet: { height: "88%", backgroundColor: theme.colors.panel, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: theme.colors.line, padding: 18, paddingBottom: 28, gap: 14 },
  historyScroll: { flex: 1 },
  historyTabs: { flexDirection: "row", padding: 4, gap: 4, borderRadius: theme.radius.pill, backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line },
  historyTab: { flex: 1, minHeight: 40, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  historyTabActive: { backgroundColor: theme.colors.blue },
  historyTabText: { color: theme.colors.muted, fontSize: 13, fontWeight: "800" },
  historyTabTextActive: { color: theme.colors.text },
  historyContent: { gap: 9, paddingBottom: 16 },
  historySectionTitle: { color: theme.colors.soft, fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 },
  historyRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line },
  historyRowCopy: { flex: 1, minWidth: 0, gap: 3 },
  historyKind: { color: theme.colors.blue, fontSize: 10, lineHeight: 14, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
  historyRowActions: { alignItems: "flex-end", gap: 7 },
  historyEditButton: { minHeight: 30, minWidth: 54, paddingHorizontal: 12, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.blue },
  historyEditText: { color: theme.colors.text, fontSize: 12, fontWeight: "900" },
  historyItemTitle: { color: theme.colors.text, fontSize: 14, lineHeight: 19, fontWeight: "800" },
  historyItemMeta: { color: theme.colors.muted, fontSize: 12, lineHeight: 17 },
  historyCurrentBadge: { maxWidth: 100, color: "#4ade80", fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
  historyPreviousBadge: { maxWidth: 100, color: theme.colors.muted, fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
  historyEmpty: { color: theme.colors.muted, padding: 14, borderRadius: theme.radius.md, backgroundColor: theme.colors.panel2 },
  historyManageButton: { minHeight: 48, backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  supportHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  supportHeaderCopy: { flex: 1 },
  closeButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  closeButtonText: { color: theme.colors.text, fontSize: 27, lineHeight: 29 },
  topicRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  topicChip: { borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 11, paddingVertical: 8 },
  topicChipActive: { backgroundColor: theme.colors.blue, borderColor: theme.colors.blue },
  topicText: { color: theme.colors.soft, fontSize: 12, fontWeight: "700" },
  topicTextActive: { color: theme.colors.text },
  supportInput: { minHeight: 128, maxHeight: 220, borderRadius: theme.radius.md, backgroundColor: theme.colors.panel2, color: theme.colors.text, padding: 13, fontSize: 15, lineHeight: 21 },
  characterCount: { color: theme.colors.muted, fontSize: 11, textAlign: "right", marginTop: -7 },
  urgentRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(248,113,113,0.35)", backgroundColor: "rgba(127,29,29,0.10)", padding: 11 },
  supportUrgentTitle: { color: "#fca5a5", fontSize: 13, fontWeight: "700" },
});
