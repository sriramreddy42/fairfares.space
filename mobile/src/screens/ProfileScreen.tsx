import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Image, ImageSourcePropType, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { absoluteAssetUrl, getRideActivity, getRideDriverProfile, updateMobileProfile } from "../api/client";
import { appAssets } from "../assets";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { BootstrapPayload, RideDriverProfile, RidePost } from "../types";
import { pickCompressedImages } from "../utils/imageUpload";

type Props = {
  data: BootstrapPayload | null;
  onLogin: () => void;
  onLogout: () => void;
  onProfileUpdated: (user: BootstrapPayload["user"]) => void;
  onOpenHousing?: () => void;
  onOpenRide?: () => void;
  onOpenServices?: () => void;
  onOpenMessenger?: () => void;
  onOpenActivity?: () => void;
  notificationsEnabled?: boolean;
  notificationStatus?: string;
  onToggleNotifications?: () => void;
};

const DRIVER_VERIFICATION_DAYS = 30;
const profileDraftKey = (userId: number) => `fairfares.mobile.profileDraft.${userId}`;

function firstInitial(name = "") {
  return name.trim().slice(0, 1).toUpperCase() || "F";
}

function verificationDaysLeft(profile: RideDriverProfile | null) {
  if (!profile?.readyForOffers) return null;
  const updated = profile.updatedAt ? new Date(profile.updatedAt) : null;
  if (!updated || Number.isNaN(updated.getTime())) return DRIVER_VERIFICATION_DAYS;
  const expiresAt = updated.getTime() + DRIVER_VERIFICATION_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
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
  onOpenActivity,
  notificationsEnabled = false,
  notificationStatus = "Available on the installed mobile app",
  onToggleNotifications
}: Props) {
  const user = data?.user;
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [profilePhoto, setProfilePhoto] = useState(user?.profilePhotoUrl || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const draftUserIdRef = useRef<number | null>(null);
  const [rideProfile, setRideProfile] = useState<RideDriverProfile | null>(null);
  const [rideActivity, setRideActivity] = useState<RidePost[]>([]);
  const [carpoolLoading, setCarpoolLoading] = useState(false);
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false);

  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (draftUserIdRef.current === nextUserId && profileDirty) return;
    draftUserIdRef.current = nextUserId;
    setName(user?.name || "");
    setEmail(user?.email || "");
    setPhone(user?.phone || "");
    setProfilePhoto(user?.profilePhotoUrl || "");
    setCurrentPassword("");
    setProfileDirty(false);
  }, [profileDirty, user?.id, user?.name, user?.email, user?.phone, user?.profilePhotoUrl]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    AsyncStorage.getItem(profileDraftKey(user.id)).then((saved) => {
      if (cancelled || !saved) return;
      try {
        const draft = JSON.parse(saved) as { name?: string; email?: string; phone?: string; profilePhoto?: string };
        setName(draft.name ?? user.name ?? "");
        setEmail(draft.email ?? user.email ?? "");
        setPhone(draft.phone ?? user.phone ?? "");
        setProfilePhoto(draft.profilePhoto ?? user.profilePhotoUrl ?? "");
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
      void AsyncStorage.setItem(profileDraftKey(user.id), JSON.stringify({ name, email, phone, profilePhoto }));
    }, 250);
    return () => clearTimeout(timer);
  }, [email, name, phone, profileDirty, profilePhoto, user?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadCarpoolProfile() {
      if (!user) {
        setRideProfile(null);
        setRideActivity([]);
        return;
      }
      setCarpoolLoading(true);
      const [profileResult, activityResult] = await Promise.allSettled([getRideDriverProfile(), getRideActivity()]);
      if (cancelled) return;
      setRideProfile(profileResult.status === "fulfilled" ? profileResult.value : null);
      setRideActivity(activityResult.status === "fulfilled" ? activityResult.value : []);
      setCarpoolLoading(false);
    }
    void loadCarpoolProfile();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const photoUri = useMemo(() => profilePhoto ? absoluteAssetUrl(profilePhoto) : "", [profilePhoto]);
  const displayName = user?.name || "FairFares Guest";
  const sensitiveChanged = Boolean(user && (email.trim().toLowerCase() !== user.email.toLowerCase() || phone.trim() !== (user.phone || "")));
  const canSaveProfile = Boolean(user && profileDirty && name.trim() && email.trim() && (!sensitiveChanged || currentPassword.trim()) && !saving);
  const listedRoutes = useMemo(
    () => rideActivity.filter((ride) => ride.activityRole === "MINE" && ride.role === "DRIVER"),
    [rideActivity]
  );
  const riderRequests = useMemo(
    () => Array.from(new Map(rideActivity.filter((ride) => ride.activityRole === "DRIVER_NOTIFICATION").map((ride) => [ride.id, ride])).values()),
    [rideActivity]
  );
  const daysLeft = verificationDaysLeft(rideProfile);
  const carpoolReady = Boolean(rideProfile?.readyForOffers && daysLeft !== 0);
  const missingProfileItems = rideProfile?.missing?.length ? rideProfile.missing.join(", ") : "vehicle, insurance, and service details";
  const profileLinks: Array<{ title: string; copy: string; icon: ImageSourcePropType; onPress?: () => void; requiresUser?: boolean; danger?: boolean }> = [
    { title: "Housing", copy: "Listings and roommate searches", icon: appAssets.bed, onPress: onOpenHousing },
    { title: "Carpool", copy: "Driver profile, routes and requests", icon: appAssets.ride, onPress: onOpenRide },
    { title: "Rental Cars", copy: "Bookings, invoices and support", icon: appAssets.serviceInvoice, onPress: onOpenServices },
    { title: "FChat", copy: "Messages and communities", icon: appAssets.fchat, onPress: onOpenMessenger },
    { title: "Help & Support", copy: "Questions, account help, safety concerns, or technical problems", icon: appAssets.serviceSupport, onPress: () => void Linking.openURL("mailto:hello@fairfare.space?subject=FairFares%20support%20request") },
    { title: "Privacy Policy", copy: "Data use and protection", icon: appAssets.serviceEye, onPress: () => void Linking.openURL("https://www.fairfare.space/privacy") },
    { title: "Delete account", copy: "Request account and data deletion", icon: appAssets.serviceCancel, requiresUser: true, danger: true, onPress: () => void Linking.openURL("mailto:hello@fairfare.space?subject=FairFares%20account%20deletion%20request") }
  ];

  async function choosePhoto() {
    if (!user) {
      onLogin();
      return;
    }
    try {
      const picked = await pickCompressedImages(1, 720, 0.7);
      if (picked[0]) {
        setProfilePhoto(picked[0]);
        setProfileDirty(true);
      }
    } catch (error) {
      Alert.alert("Photo not added", error instanceof Error ? error.message : "Could not add profile photo.");
    }
  }

  async function saveProfile() {
    if (!user) {
      onLogin();
      return;
    }
    setSaving(true);
    try {
      const payload = await updateMobileProfile({ name, email, phone, profilePhoto, currentPassword });
      draftUserIdRef.current = payload.user?.id ?? user.id;
      setName(payload.user?.name || "");
      setEmail(payload.user?.email || "");
      setPhone(payload.user?.phone || "");
      setProfilePhoto(payload.user?.profilePhotoUrl || "");
      onProfileUpdated(payload.user);
      setProfileDirty(false);
      void AsyncStorage.removeItem(profileDraftKey(user.id));
      if (payload.activationRequired) {
        Alert.alert("Verify your new email", payload.message || "Please activate your new email before logging in again.");
        onLogout();
      } else {
        setCurrentPassword("");
        Alert.alert("Profile updated", payload.message || "Your FairFares profile was saved.");
      }
    } catch (error) {
      Alert.alert("Profile not saved", error instanceof Error ? error.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <SectionHeader eyebrow="Account" title={displayName} />
          <View style={styles.badgeRow}>
            <View style={styles.badge}><Text style={styles.badgeText}>{user?.isVerified ? "Email verified" : "Email pending"}</Text></View>
            <View style={styles.badge}><Text style={styles.badgeText}>{user?.phone ? "Phone on file" : "Add phone"}</Text></View>
          </View>
        </View>
        <TouchableOpacity style={styles.avatar} onPress={choosePhoto}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{firstInitial(displayName)}</Text>
          )}
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
            <TextInput value={phone} onChangeText={(value) => { setPhone(value); setProfileDirty(true); }} style={styles.input} placeholder="Phone number" placeholderTextColor={theme.colors.muted} keyboardType="phone-pad" />
            {sensitiveChanged ? (
            <>
              <Text style={styles.securityNote}>Current password is required to change email or phone. Email changes require activation before the next login.</Text>
              <Text style={styles.label}>Current password</Text>
              <TextInput value={currentPassword} onChangeText={(value) => { setCurrentPassword(value); setProfileDirty(true); }} style={styles.input} placeholder="Current password" placeholderTextColor={theme.colors.muted} secureTextEntry />
            </>
            ) : null}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.secondaryButton} onPress={choosePhoto}>
                <Text style={styles.secondaryButtonText}>Upload photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButton, !canSaveProfile && styles.disabled]} onPress={saveProfile} disabled={!canSaveProfile}>
                <Text style={styles.primaryButtonText}>{saving ? "Saving..." : profileDirty && sensitiveChanged && !currentPassword.trim() ? "Password required" : profileDirty ? "Save profile" : "Saved"}</Text>
              </TouchableOpacity>
            </View>
          </> : null}
        </View>
      )}

      {user ? (
        <View style={styles.notificationCard}>
          <View style={styles.notificationCopy}>
            <Text style={styles.cardTitle}>Mobile notifications</Text>
            <Text style={styles.cardCopy}>{notificationStatus}</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="switch"
            accessibilityState={{ checked: notificationsEnabled }}
            style={[styles.notificationSwitch, notificationsEnabled && styles.notificationSwitchOn]}
            onPress={onToggleNotifications}
          >
            <View style={[styles.notificationKnob, notificationsEnabled && styles.notificationKnobOn]} />
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.activityCard}>
        <Text style={styles.cardTitle}>Your FairFares</Text>
        <Text style={styles.cardCopy}>Track housing posts, carpool activity, rental bookings, and FChat conversations from one account.</Text>
        <View style={styles.metricRow}>
          <View style={styles.metric}><Text style={styles.metricValue}>{data?.dashboard.housingPosts || 0}</Text><Text style={styles.metricLabel}>Housing posts</Text></View>
          <View style={styles.metric}><Text style={styles.metricValue}>{data?.dashboard.messages || 0}</Text><Text style={styles.metricLabel}>Messages</Text></View>
        </View>
      </View>

      {user ? (
        <View style={styles.statusCard}>
          <View style={styles.statusTop}>
            <View style={styles.statusCopy}>
              <Text style={styles.cardTitle}>Carpool lister</Text>
              <Text style={styles.cardCopy}>
                {carpoolLoading
                  ? "Refreshing your driver profile and route activity."
                  : carpoolReady
                    ? `Verified to list carpool seats. Valid for ${daysLeft} day${daysLeft === 1 ? "" : "s"} from your latest profile update.`
                    : `Not ready yet. Add ${missingProfileItems} before listing routes.`}
              </Text>
            </View>
            <View style={[styles.statusBadge, carpoolReady && styles.statusBadgeReady]}>
              <Text style={styles.statusBadgeText}>{carpoolReady ? "Verified" : "Pending"}</Text>
            </View>
          </View>
          <View style={styles.metricRow}>
            <View style={styles.metric}><Text style={styles.metricValue}>{listedRoutes.length}</Text><Text style={styles.metricLabel}>Listed routes</Text></View>
            <View style={styles.metric}><Text style={styles.metricValue}>{riderRequests.length}</Text><Text style={styles.metricLabel}>Rider requests</Text></View>
            <View style={styles.metric}><Text style={styles.metricValue}>{daysLeft ?? "—"}</Text><Text style={styles.metricLabel}>Days valid</Text></View>
          </View>
          <View style={styles.linkRow}>
            <TouchableOpacity style={styles.miniButton} onPress={onOpenRide}>
              <Text style={styles.miniButtonText}>{carpoolReady ? "List / manage ride" : "Finish profile"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.miniButton} onPress={onOpenActivity}>
              <Text style={styles.miniButtonText}>Activity</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.miniButton} onPress={onOpenMessenger}>
              <Text style={styles.miniButtonText}>FChat</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {profileLinks.filter(({ requiresUser }) => !requiresUser || user).map(({ title, copy, icon, onPress, danger }) => (
        <TouchableOpacity key={title} style={styles.menuRow} onPress={onPress}>
          <View style={styles.menuIconCircle}>
            <Image source={icon} style={styles.menuFchatIcon} resizeMode="contain" />
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
  card: { backgroundColor: theme.colors.panel, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: theme.colors.line, gap: 8 },
  cardTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800" },
  profileDetailsHeader: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  profileDetailsHeaderCopy: { flex: 1, minWidth: 0 },
  profileDetailsSummary: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  profileDetailsChevron: { color: theme.colors.soft, fontSize: 24, lineHeight: 26 },
  cardCopy: { color: theme.colors.muted, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  label: { color: theme.colors.muted, fontWeight: "700", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.5 },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, minHeight: 48, paddingHorizontal: 13, fontSize: 15 },
  securityNote: { color: theme.colors.soft, fontSize: 12, lineHeight: 17, fontWeight: "600", backgroundColor: "rgba(37,99,235,0.12)", borderRadius: theme.radius.md, padding: 10 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 4 },
  primaryButton: { flex: 1, backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingVertical: 12, alignItems: "center" },
  primaryButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingVertical: 12, alignItems: "center" },
  secondaryButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.7 },
  logoutButton: { minHeight: 50, borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(248,113,113,0.5)", backgroundColor: "rgba(127,29,29,0.14)", alignItems: "center", justifyContent: "center", paddingHorizontal: 14, marginTop: 4 },
  logoutText: { color: "#f87171", fontWeight: "700", fontSize: 14 },
  activityCard: { backgroundColor: "#152219", borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "rgba(34,197,94,0.4)", gap: 8 },
  notificationCard: { backgroundColor: theme.colors.panel, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: theme.colors.line, flexDirection: "row", alignItems: "center", gap: 12 },
  notificationCopy: { flex: 1, minWidth: 0, gap: 3 },
  notificationSwitch: { width: 48, height: 28, borderRadius: 14, backgroundColor: theme.colors.panel2, borderWidth: 1, borderColor: theme.colors.line, padding: 3, justifyContent: "center" },
  notificationSwitchOn: { backgroundColor: theme.colors.blue, borderColor: theme.colors.blue },
  notificationKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: theme.colors.soft },
  notificationKnobOn: { alignSelf: "flex-end", backgroundColor: theme.colors.text },
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
  menuFchatIcon: { width: 23, height: 23, tintColor: theme.colors.soft },
  menuTextBlock: { flex: 1, minWidth: 0 },
  menuTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  menuDangerTitle: { color: "#f87171" },
  menuCopy: { color: theme.colors.muted, fontSize: 12, fontWeight: "500", lineHeight: 16, marginTop: 2 },
  menuChevron: { color: theme.colors.soft, fontSize: 24, fontWeight: "500" },
});
