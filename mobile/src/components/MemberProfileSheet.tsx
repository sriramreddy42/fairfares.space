import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useColorScheme, View } from "react-native";
import { getCommunityUserProfile } from "../api/client";
import { UserAvatar } from "./UserAvatar";
import { theme } from "../theme";
import { avatarInitials } from "../utils/text";

export type MemberProfileTarget = { id: number; name: string; photoUrl: string };
export type MemberProfileSheetHandle = { open: (member: MemberProfileTarget) => void };

type Props = {
  viewerId: number;
  isSignedIn: boolean;
  onRequireLogin: () => void;
  onOpenUserChat: (userId: number, name?: string) => void;
  onOpenHousing?: (postId: string) => void;
};

// A single member sheet keeps a person's avatar and name consistent wherever
// they appear: Ask Community, comments, and group messages in Chitthi.
export const MemberProfileSheet = React.forwardRef<MemberProfileSheetHandle, Props>(function MemberProfileSheet({ viewerId, isSignedIn, onRequireLogin, onOpenHousing, onOpenUserChat }, ref) {
  const isLight = useColorScheme() === "light";
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof getCommunityUserProfile>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestRef = useRef(0);

  const close = useCallback(() => {
    requestRef.current += 1;
    setLoading(false);
    setLoadFailed(false);
    setProfile(null);
  }, []);

  const open = useCallback((member: MemberProfileTarget) => {
    if (!member.id) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setProfile({ id: member.id, name: member.name, photoUrl: member.photoUrl, listings: [] });
    setLoading(true);
    setLoadFailed(false);
    void getCommunityUserProfile(member.id)
      .then((nextProfile) => {
        if (requestRef.current === requestId) setProfile(nextProfile);
      })
      .catch(() => {
        if (requestRef.current === requestId) setLoadFailed(true);
      })
      .finally(() => {
        if (requestRef.current === requestId) setLoading(false);
      });
  }, []);

  React.useImperativeHandle(ref, () => ({ open }), [open]);

  return <Modal visible={Boolean(profile)} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={close}>
    <View style={styles.backdrop}><View style={[styles.card, isLight && styles.cardLight]}>
      <TouchableOpacity style={[styles.close, isLight && styles.closeLight]} onPress={close} accessibilityLabel="Close member details"><Text style={[styles.closeText, isLight && styles.closeTextLight]}>×</Text></TouchableOpacity>
      {profile ? <>
        <UserAvatar photoUrl={profile.photoUrl} style={styles.avatar} imageStyle={styles.avatarImage} fallback={<Text style={styles.avatarText}>{avatarInitials(profile.name)}</Text>} />
        <Text style={[styles.name, isLight && styles.textPrimaryLight]}>{profile.name}</Text>
        <Text style={[styles.summary, isLight && styles.textSecondaryLight]}>{loading ? "Loading profile…" : loadFailed ? "FairFares member" : `${profile.listings.length} active ${profile.listings.length === 1 ? "listing" : "listings"}`}</Text>
        {viewerId !== profile.id ? <TouchableOpacity style={styles.message} onPress={() => { const id = profile.id; const name = profile.name; close(); if (!isSignedIn) onRequireLogin(); else onOpenUserChat(id, name); }} accessibilityRole="button" accessibilityLabel={`Message ${profile.name}`}><Text style={styles.messageText}>Message</Text></TouchableOpacity> : <Text style={styles.ownProfile}>This is your public profile</Text>}
        {!loading && profile.listings.length ? <ScrollView style={styles.listings} contentContainerStyle={styles.listingsContent}>{profile.listings.map((listing) => <TouchableOpacity key={listing.id} disabled={!onOpenHousing} style={[styles.listing, isLight && styles.listingLight]} onPress={() => { if (!onOpenHousing) return; close(); onOpenHousing(listing.id); }} accessibilityRole={onOpenHousing ? "button" : undefined} accessibilityLabel={onOpenHousing ? `Open ${listing.title}` : undefined}><View style={styles.listingCopy}><Text style={[styles.listingTitle, isLight && styles.textPrimaryLight]} numberOfLines={2}>{listing.title}</Text><Text style={[styles.listingMeta, isLight && styles.textSecondaryLight]} numberOfLines={1}>{listing.addressLabel || listing.location}</Text><Text style={styles.listingRent} numberOfLines={1}>{listing.rent}</Text></View>{onOpenHousing ? <Text style={styles.listingArrow}>›</Text> : null}</TouchableOpacity>)}</ScrollView> : !loading ? <Text style={[styles.empty, isLight && styles.textSecondaryLight]}>{loadFailed ? "Listings are temporarily unavailable. You can still connect in Chitthi." : "No active listings right now."}</Text> : <ActivityIndicator color={theme.colors.brand} />}
      </> : null}
    </View></View>
  </Modal>;
});

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 20, backgroundColor: "rgba(0,0,0,.72)" },
  card: { maxHeight: "78%", borderRadius: 26, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel, padding: 20, alignItems: "center", gap: 9 },
  cardLight: { backgroundColor: "#fff", borderColor: "#e1e5e9" },
  close: { position: "absolute", right: 13, top: 13, zIndex: 2, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.panel2 },
  closeLight: { backgroundColor: "#eef1f3" }, closeText: { color: theme.colors.soft, fontSize: 24, lineHeight: 26 }, closeTextLight: { color: "#24282d" },
  avatar: { width: 86, height: 86, borderRadius: 43, backgroundColor: "#173b2d", marginTop: 5 }, avatarImage: { borderRadius: 43 }, avatarText: { color: "#a8ecd1", fontSize: 25, fontWeight: "900" },
  name: { color: theme.colors.text, fontSize: 23, lineHeight: 29, fontWeight: "900", textAlign: "center" }, summary: { color: theme.colors.muted, fontSize: 12, fontWeight: "700" },
  message: { width: "100%", minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: theme.colors.brand, marginTop: 5 }, messageText: { color: "#06291e", fontSize: 14, fontWeight: "900" }, ownProfile: { color: theme.colors.brand, fontSize: 12, fontWeight: "800", marginTop: 5 },
  listings: { width: "100%", marginTop: 5 }, listingsContent: { gap: 8, paddingBottom: 2 }, listing: { minHeight: 76, flexDirection: "row", alignItems: "center", borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel2, paddingHorizontal: 13, paddingVertical: 10 }, listingLight: { borderColor: "#e1e5e9", backgroundColor: "#f6f7f8" }, listingCopy: { flex: 1, minWidth: 0 }, listingTitle: { color: theme.colors.text, fontSize: 13, lineHeight: 17, fontWeight: "900" }, listingMeta: { color: theme.colors.muted, fontSize: 10, marginTop: 3 }, listingRent: { color: theme.colors.brand, fontSize: 11, fontWeight: "900", marginTop: 3 }, listingArrow: { color: theme.colors.brand, fontSize: 27 }, empty: { color: theme.colors.muted, fontSize: 12, paddingVertical: 12 },
  textPrimaryLight: { color: "#14171a" }, textSecondaryLight: { color: "#687076" }
});
