import React, { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { absoluteAssetUrl } from "../api/client";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { HousingPost } from "../types";

type Props = {
  post: HousingPost;
  onMessage: (post: HousingPost) => void;
  onOpen?: (post: HousingPost) => void;
  distanceLabel?: string;
  width?: number;
  compact?: boolean;
  messageSent?: boolean;
  onSendMessage?: (post: HousingPost, message: string) => Promise<void>;
  onSeeConversation?: (post: HousingPost) => void;
  ownListing?: boolean;
};

export function HousingCard({ post, onMessage, onOpen, distanceLabel, width, compact = false, messageSent = false, onSendMessage, onSeeConversation, ownListing = false }: Props) {
  const [draft, setDraft] = useState(() => `Hi, I am interested in ${post.title.trim().replace(/[.!?]+$/, "")}. Is it still available?`);
  const [sending, setSending] = useState(false);
  const postImages = post.images?.length ? post.images : post.imageUrl ? [post.imageUrl] : [];
  const imageUrl = absoluteAssetUrl(postImages[0] || "");
  const fallbackTitle = post.roommateIntent
    ? "Need roommate"
    : post.mode === "NEED_PLACE"
      ? "Need a place"
      : "Place photos";
  const fallbackCopy = post.roommateIntent
    ? "Photos optional"
    : post.mode === "NEED_PLACE"
      ? "Details first"
      : "Coming soon";
  return (
    <TouchableOpacity style={[styles.card, width ? { width, marginRight: 0 } : null]} activeOpacity={0.9} onPress={() => onOpen?.(post)}>
      <View style={[styles.imageWrap, compact && styles.imageWrapCompact]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} />
        ) : (
          <View style={styles.fallback}>
            <Text style={[styles.fallbackIcon, compact && styles.fallbackIconCompact]}>{post.roommateIntent ? "👥" : post.mode === "NEED_PLACE" ? "🏠" : "🛏️"}</Text>
            <Text style={[styles.fallbackTitle, compact && styles.fallbackTitleCompact]}>{fallbackTitle}</Text>
            <Text style={[styles.fallbackCopy, compact && styles.fallbackCopyCompact]}>{fallbackCopy}</Text>
          </View>
        )}
        <Text style={[styles.badge, compact && styles.badgeCompact]}>{post.modeLabel}</Text>
        {postImages.length > 1 ? <Text style={styles.imageCount}>1/{Math.min(postImages.length, 4)}</Text> : null}
      </View>
      <View style={[styles.body, compact && styles.bodyCompact]}>
        <Text numberOfLines={2} style={[styles.title, compact && styles.titleCompact]}>
          {post.title}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, compact && styles.metaCompact]}>{post.location}</Text>
        {post.area ? <Text numberOfLines={1} style={[styles.meta, compact && styles.metaCompact]}>{post.area}</Text> : null}
        <View style={styles.pillRow}>
          <Text numberOfLines={1} style={[styles.infoPill, compact && styles.infoPillCompact]}>{post.categoryLabel}</Text>
          <Text numberOfLines={1} style={[styles.infoPill, compact && styles.infoPillCompact]}>{post.genderPreference || "Open"}</Text>
        </View>
        <Text numberOfLines={1} style={[styles.meta, compact && styles.metaCompact]}>{post.bathroomType || "Bath open"} · {post.leaseTerm || "Flexible"}</Text>
        <Text numberOfLines={1} style={[styles.meta, compact && styles.metaCompact]}>{post.moveIn || "Date open"}</Text>
        {post.posterName ? <Text style={styles.poster} numberOfLines={1}>Posted by {post.posterName}</Text> : null}
        <View style={styles.pillRow}>
          {post.distanceMiles !== null ? (
            <Text numberOfLines={1} style={[styles.distance, compact && styles.distanceCompact]}>
              {post.distanceMiles} mi{distanceLabel ? ` from ${distanceLabel}` : " away"}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.footer, compact && styles.footerCompact]}>
        <View style={styles.priceBlock}>
          <Text numberOfLines={2} style={[styles.rent, compact && styles.rentCompact]}>{post.rent || "Rent open"}</Text>
          <Text style={styles.expiry}>{post.expiryLabel}</Text>
        </View>
      </View>
      {!post.sample ? (
        <View style={styles.inlineMessageCard}>
          {ownListing ? (
            <View style={styles.ownListingRow}>
              <View style={styles.ownListingCheck}><Text style={styles.ownListingCheckText}>✓</Text></View>
              <View style={styles.ownListingCopy}><Text style={styles.ownListingTitle}>Your listing</Text><Text style={styles.ownListingHint}>Manage it from Activity</Text></View>
            </View>
          ) : messageSent ? (
            <>
              <View style={styles.sentHeading}>
                <View style={styles.sentCheck}><Text style={styles.sentCheckText}>✓</Text></View>
                <Text style={styles.sentTitle} numberOfLines={1}>Message sent to lister</Text>
              </View>
              <TouchableOpacity style={styles.seeConversation} onPress={() => (onSeeConversation || onMessage)(post)}><Text style={styles.seeConversationText}>See conversation</Text></TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.inlineMessageHeading}>
                <View style={styles.inlineMessageMascotWrap}>
                  <Image source={appAssets.chittiMascot} style={styles.inlineMessageMascot} resizeMode="contain" />
                </View>
                <View style={styles.inlineMessageHeadingCopy}>
                  <Text style={styles.inlineMessageTitle}>Message lister</Text>
                  <Text style={styles.inlineMessageHint}>Start a private Chitthi</Text>
                </View>
              </View>
              <View style={[styles.inlineMessageRow, sending && styles.inlineMessageRowBusy]}>
                <TextInput value={draft} onChangeText={setDraft} style={styles.inlineMessageInput} placeholder="Write a message" placeholderTextColor="#667085" editable={!sending} returnKeyType="send" onSubmitEditing={() => { if (draft.trim() && onSendMessage) void (async () => { setSending(true); try { await onSendMessage(post, draft.trim()); } finally { setSending(false); } })(); }} />
                <TouchableOpacity style={[styles.inlineSend, (sending || !draft.trim()) && styles.inlineSendDisabled]} disabled={sending || !draft.trim() || !onSendMessage} onPress={() => { if (!onSendMessage) return; void (async () => { setSending(true); try { await onSendMessage(post, draft.trim()); } finally { setSending(false); } })(); }}>{sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.inlineSendText}>Send</Text>}</TouchableOpacity>
              </View>
            </>
          )}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 286,
    backgroundColor: theme.colors.panel,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.line,
    overflow: "hidden",
    marginRight: theme.spacing.md
  },
  imageWrap: {
    height: 148,
    backgroundColor: theme.colors.panel2
  },
  imageWrapCompact: { height: 116 },
  image: {
    width: "100%",
    height: "100%"
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#202a25",
    gap: 5,
    paddingHorizontal: 14
  },
  fallbackIcon: { fontSize: 34, lineHeight: 38 },
  fallbackIconCompact: { fontSize: 27, lineHeight: 31 },
  fallbackTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900", textAlign: "center" },
  fallbackTitleCompact: { fontSize: 14, lineHeight: 18 },
  fallbackCopy: { color: theme.colors.muted, fontSize: 12, fontWeight: "800", textAlign: "center" },
  fallbackCopyCompact: { fontSize: 10, lineHeight: 13 },
  poster: { color: theme.colors.soft, fontSize: 11, fontWeight: "500", marginTop: 2 },
  badge: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: theme.colors.accent,
    color: theme.colors.text,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontWeight: "900"
  },
  badgeCompact: { top: 9, left: 9, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11 },
  imageCount: {
    position: "absolute",
    right: 12,
    bottom: 12,
    backgroundColor: "rgba(0,0,0,0.68)",
    color: theme.colors.text,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontWeight: "900"
  },
  body: {
    padding: theme.spacing.md,
    gap: 8
  },
  bodyCompact: { padding: 11, gap: 5, minHeight: 214 },
  title: {
    color: theme.colors.text,
    fontSize: 19,
    fontWeight: "900"
  },
  titleCompact: { fontSize: 15, lineHeight: 19 },
  meta: {
    color: theme.colors.muted,
    fontSize: 15,
    fontWeight: "700"
  },
  metaCompact: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  infoPill: {
    color: theme.colors.soft,
    backgroundColor: theme.colors.panel2,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 13,
    fontWeight: "900"
  },
  infoPillCompact: { paddingHorizontal: 7, paddingVertical: 4, fontSize: 10, maxWidth: "100%" },
  distance: {
    color: theme.colors.green,
    backgroundColor: "#173820",
    borderRadius: theme.radius.pill,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 15,
    fontWeight: "900"
  },
  distanceCompact: { paddingHorizontal: 7, paddingVertical: 4, fontSize: 11, maxWidth: "100%" },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    padding: theme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  footerCompact: { padding: 11, gap: 6 },
  priceBlock: {
    flex: 1
  },
  rent: {
    color: theme.colors.green,
    fontSize: 18,
    fontWeight: "900",
    flex: 1
  },
  rentCompact: { fontSize: 14, lineHeight: 18 },
  expiry: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3
  },
  respond: {
    borderWidth: 1,
    borderColor: theme.colors.blue,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 9
  },
  respondCompact: { paddingHorizontal: 10, paddingVertical: 7 },
  respondText: {
    color: theme.colors.text,
    fontWeight: "900"
  },
  respondSent: { borderColor: theme.colors.green, backgroundColor: "rgba(34,197,94,0.12)" },
  respondTextSent: { color: theme.colors.green },
  respondDisabled: { borderColor: theme.colors.line, backgroundColor: theme.colors.panel2 },
  respondTextDisabled: { color: theme.colors.muted, fontWeight: "600" },
  inlineMessageCard: { borderTopWidth: 1, borderTopColor: theme.colors.line, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 10, gap: 7, backgroundColor: "#1D1D1E" },
  inlineMessageHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  inlineMessageMascotWrap: { width: 29, height: 29, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#10281C", borderWidth: 1, borderColor: "rgba(210,167,89,0.42)", shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  inlineMessageMascot: { width: 24, height: 24 },
  inlineMessageHeadingCopy: { flex: 1, minWidth: 0 },
  inlineMessageTitle: { color: theme.colors.text, fontSize: 12, lineHeight: 15, fontWeight: "900" },
  inlineMessageHint: { color: theme.colors.muted, fontSize: 9, lineHeight: 12, fontWeight: "700" },
  inlineMessageRow: { height: 40, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 3, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: "#3A3A3C", backgroundColor: theme.colors.panel2 },
  inlineMessageRowBusy: { opacity: 0.8 },
  inlineMessageInput: { flex: 1, minWidth: 0, height: 34, color: theme.colors.text, paddingHorizontal: 0, paddingVertical: 6, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  inlineSend: { height: 34, minWidth: 59, borderRadius: 17, backgroundColor: theme.colors.green, alignItems: "center", justifyContent: "center", paddingHorizontal: 11 },
  inlineSendDisabled: { backgroundColor: "#3A5742", opacity: 0.62 },
  inlineSendText: { color: "#0C1A10", fontSize: 12, fontWeight: "900" },
  sentHeading: { minHeight: 29, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 1 },
  sentCheck: { width: 25, height: 25, borderRadius: 13, backgroundColor: "rgba(94,196,122,0.18)", borderWidth: 1, borderColor: "rgba(94,196,122,0.56)", alignItems: "center", justifyContent: "center" },
  sentCheckText: { color: theme.colors.green, fontSize: 14, lineHeight: 17, fontWeight: "900" },
  sentTitle: { flex: 1, minWidth: 0, color: theme.colors.text, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  seeConversation: { height: 38, borderRadius: 19, backgroundColor: "rgba(94,196,122,0.14)", borderWidth: 1, borderColor: "rgba(94,196,122,0.42)", alignItems: "center", justifyContent: "center" },
  seeConversationText: { color: theme.colors.green, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  ownListingRow: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8 },
  ownListingCheck: { width: 27, height: 27, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(94,196,122,0.14)", borderWidth: 1, borderColor: "rgba(94,196,122,0.4)" },
  ownListingCheckText: { color: theme.colors.green, fontSize: 14, fontWeight: "900" },
  ownListingCopy: { flex: 1, minWidth: 0 },
  ownListingTitle: { color: theme.colors.text, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  ownListingHint: { color: theme.colors.muted, fontSize: 9, lineHeight: 12, fontWeight: "600" }
});
