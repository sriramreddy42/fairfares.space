import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { absoluteAssetUrl } from "../api/client";
import { theme } from "../theme";
import { HousingPost } from "../types";

type Props = {
  post: HousingPost;
  onMessage: (post: HousingPost) => void;
};

export function HousingCard({ post, onMessage }: Props) {
  const imageUrl = absoluteAssetUrl(post.imageUrl);
  return (
    <View style={styles.card}>
      <View style={styles.imageWrap}>
        {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.image} /> : <View style={styles.fallback} />}
        <Text style={styles.badge}>{post.modeLabel}</Text>
      </View>
      <View style={styles.body}>
        <Text numberOfLines={2} style={styles.title}>
          {post.title}
        </Text>
        <Text style={styles.meta}>{post.location}</Text>
        <Text style={styles.meta}>{post.categoryLabel}</Text>
        <Text style={styles.meta}>{post.genderPreference}</Text>
      </View>
      <View style={styles.footer}>
        <Text style={styles.rent}>{post.rent || "Rent open"}</Text>
        <TouchableOpacity style={styles.respond} onPress={() => onMessage(post)}>
          <Text style={styles.respondText}>Message</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    padding: theme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  rent: {
    color: theme.colors.green,
    fontSize: 18,
    fontWeight: "900",
    flex: 1
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
  }
});
