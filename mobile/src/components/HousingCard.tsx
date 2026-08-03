import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { absoluteAssetUrl } from "../api/client";
import { theme } from "../theme";
import { HousingPost } from "../types";

type Props = {
  post: HousingPost;
  onMessage: (post: HousingPost) => void;
  onOpen?: (post: HousingPost) => void;
  distanceLabel?: string;
};

export function HousingCard({ post, onMessage, onOpen, distanceLabel }: Props) {
  const postImages = post.images?.length ? post.images : post.imageUrl ? [post.imageUrl] : [];
  const imageUrl = absoluteAssetUrl(postImages[0] || "");
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => onOpen?.(post)}>
      <View style={styles.imageWrap}>
        {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.image} /> : <View style={styles.fallback} />}
        <Text style={styles.badge}>{post.modeLabel}</Text>
        {postImages.length > 1 ? <Text style={styles.imageCount}>1/{Math.min(postImages.length, 4)}</Text> : null}
      </View>
      <View style={styles.body}>
        <Text numberOfLines={2} style={styles.title}>
          {post.title}
        </Text>
        <Text style={styles.meta}>{post.location}</Text>
        {post.area ? <Text style={styles.meta}>{post.area}</Text> : null}
        <View style={styles.pillRow}>
          <Text style={styles.infoPill}>{post.categoryLabel}</Text>
          <Text style={styles.infoPill}>{post.genderPreference || "Open"}</Text>
        </View>
        <Text style={styles.meta}>{post.bathroomType || "Bath open"} · {post.leaseTerm || "Flexible"}</Text>
        <Text style={styles.meta}>{post.moveIn || "Date open"}</Text>
        {post.posterName ? <Text style={styles.poster} numberOfLines={1}>Posted by {post.posterName}</Text> : null}
        <View style={styles.pillRow}>
          {post.distanceMiles !== null ? (
            <Text style={styles.distance}>
              {post.distanceMiles} mi{distanceLabel ? ` from ${distanceLabel}` : " away"}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.footer}>
        <View style={styles.priceBlock}>
          <Text style={styles.rent}>{post.rent || "Rent open"}</Text>
          <Text style={styles.expiry}>{post.expiryLabel}</Text>
        </View>
        <TouchableOpacity style={[styles.respond, post.sample && styles.respondDisabled]} onPress={() => !post.sample && onMessage(post)} disabled={post.sample}>
          <Text style={[styles.respondText, post.sample && styles.respondTextDisabled]}>{post.sample ? "Sample only" : "Message"}</Text>
        </TouchableOpacity>
      </View>
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
  image: {
    width: "100%",
    height: "100%"
  },
  fallback: {
    flex: 1,
    backgroundColor: "#202a25"
  },
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
  title: {
    color: theme.colors.text,
    fontSize: 19,
    fontWeight: "900"
  },
  meta: {
    color: theme.colors.muted,
    fontSize: 15,
    fontWeight: "700"
  },
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
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    padding: theme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  priceBlock: {
    flex: 1
  },
  rent: {
    color: theme.colors.green,
    fontSize: 18,
    fontWeight: "900",
    flex: 1
  },
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
  respondText: {
    color: theme.colors.text,
    fontWeight: "900"
  },
  respondDisabled: { borderColor: theme.colors.line, backgroundColor: theme.colors.panel2 },
  respondTextDisabled: { color: theme.colors.muted, fontWeight: "600" }
});
