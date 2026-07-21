import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { absoluteAssetUrl, updateMobileProfile } from "../api/client";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { BootstrapPayload } from "../types";
import { pickCompressedImages } from "../utils/imageUpload";

type Props = {
  data: BootstrapPayload | null;
  onLogin: () => void;
  onLogout: () => void;
  onProfileUpdated: (user: BootstrapPayload["user"]) => void;
};

function firstInitial(name = "") {
  return name.trim().slice(0, 1).toUpperCase() || "F";
}

export function ProfileScreen({ data, onLogin, onLogout, onProfileUpdated }: Props) {
  const user = data?.user;
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [profilePhoto, setProfilePhoto] = useState(user?.profilePhotoUrl || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
    setEmail(user?.email || "");
    setPhone(user?.phone || "");
    setProfilePhoto(user?.profilePhotoUrl || "");
    setCurrentPassword("");
  }, [user?.name, user?.email, user?.phone, user?.profilePhotoUrl]);

  const photoUri = useMemo(() => profilePhoto ? absoluteAssetUrl(profilePhoto) : "", [profilePhoto]);
  const displayName = user?.name || "FairFares Guest";
  const sensitiveChanged = Boolean(user && (email.trim().toLowerCase() !== user.email.toLowerCase() || phone.trim() !== (user.phone || "")));

  async function choosePhoto() {
    if (!user) {
      onLogin();
      return;
    }
    try {
      const picked = await pickCompressedImages(1, 720, 0.7);
      if (picked[0]) {
        setProfilePhoto(picked[0]);
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
      onProfileUpdated(payload.user);
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

      <View style={styles.selector}>
        <Text style={styles.selectorText}>Personal account</Text>
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
          <Text style={styles.cardTitle}>Profile details</Text>
          <Text style={styles.label}>Full name</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Your name" placeholderTextColor={theme.colors.muted} />
          <Text style={styles.label}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} style={styles.input} placeholder="Email" placeholderTextColor={theme.colors.muted} autoCapitalize="none" keyboardType="email-address" />
          <Text style={styles.label}>Phone</Text>
          <TextInput value={phone} onChangeText={setPhone} style={styles.input} placeholder="Phone number" placeholderTextColor={theme.colors.muted} keyboardType="phone-pad" />
          {sensitiveChanged ? (
            <>
              <Text style={styles.securityNote}>Current password is required to change email or phone. Email changes require activation before the next login.</Text>
              <Text style={styles.label}>Current password</Text>
              <TextInput value={currentPassword} onChangeText={setCurrentPassword} style={styles.input} placeholder="Current password" placeholderTextColor={theme.colors.muted} secureTextEntry />
            </>
          ) : null}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={choosePhoto}>
              <Text style={styles.secondaryButtonText}>Upload photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryButton, saving && styles.disabled]} onPress={saveProfile} disabled={saving}>
              <Text style={styles.primaryButtonText}>{saving ? "Saving..." : "Save profile"}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.activityCard}>
        <Text style={styles.cardTitle}>Your FairFares</Text>
        <Text style={styles.cardCopy}>Track housing posts, carpool activity, rental bookings, and FChat conversations from one account.</Text>
        <View style={styles.metricRow}>
          <View style={styles.metric}><Text style={styles.metricValue}>{data?.dashboard.housingPosts || 0}</Text><Text style={styles.metricLabel}>Housing posts</Text></View>
          <View style={styles.metric}><Text style={styles.metricValue}>{data?.dashboard.messages || 0}</Text><Text style={styles.metricLabel}>Messages</Text></View>
        </View>
      </View>

      {[
        ["Housing", "Your place posts, roommate searches, photos, and expiry status."],
        ["Carpool", "Listed cars, rider requests, pickup PINs, and active matches."],
        ["Rental Cars", "Bookings, invoices, policies, and support actions."],
        ["FChat", "Personal chats, groups, communities, and listing conversations."]
      ].map(([title, copy]) => (
        <View key={title} style={styles.menuRow}>
          <View style={styles.menuTextBlock}>
            <Text style={styles.menuTitle}>{title}</Text>
            <Text style={styles.menuCopy}>{copy}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 14, paddingBottom: 116, gap: 14 },
  hero: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.spacing.md },
  heroCopy: { flex: 1 },
  badgeRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  badge: { backgroundColor: theme.colors.panel2, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { color: theme.colors.soft, fontWeight: "900", fontSize: 11 },
  avatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.line, overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  avatarText: { color: theme.colors.text, fontSize: 29, fontWeight: "900" },
  selector: { backgroundColor: theme.colors.panel2, borderRadius: 22, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  selectorText: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  card: { backgroundColor: theme.colors.panel, borderRadius: 22, padding: 14, borderWidth: 1, borderColor: theme.colors.line, gap: 9 },
  cardTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  cardCopy: { color: theme.colors.muted, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  label: { color: theme.colors.muted, fontWeight: "900", textTransform: "uppercase", fontSize: 11 },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, minHeight: 48, paddingHorizontal: 13, fontSize: 15 },
  securityNote: { color: theme.colors.soft, fontSize: 13, lineHeight: 18, fontWeight: "800", backgroundColor: "rgba(37,99,235,0.12)", borderRadius: theme.radius.md, padding: 10 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  primaryButton: { flex: 1, backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingVertical: 12, alignItems: "center" },
  primaryButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: "900" },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingVertical: 12, alignItems: "center" },
  secondaryButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: "900" },
  disabled: { opacity: 0.7 },
  logoutButton: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 14 },
  logoutText: { color: theme.colors.accent, fontWeight: "900" },
  activityCard: { backgroundColor: "#1f2a1f", borderRadius: 22, padding: 14, borderWidth: 1, borderColor: "rgba(34,197,94,0.55)", gap: 9 },
  metricRow: { flexDirection: "row", gap: 10 },
  metric: { borderWidth: 1, borderColor: "rgba(34,197,94,0.55)", borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  metricValue: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  metricLabel: { color: theme.colors.soft, fontWeight: "800", fontSize: 11 },
  menuRow: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, padding: 14, borderWidth: 1, borderColor: theme.colors.line, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 14 },
  menuTextBlock: { flex: 1, minWidth: 0 },
  menuTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  menuCopy: { color: theme.colors.muted, fontSize: 12, fontWeight: "700", lineHeight: 17, marginTop: 2 },
});
