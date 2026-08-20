import React, { ReactNode, useEffect, useState } from "react";
import { Image, ImageStyle, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { authenticatedAssetSource } from "../api/client";

type Props = {
  photoUrl?: string;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  fallback?: ReactNode;
};

/**
 * Shared authenticated avatar renderer.
 *
 * The server versions private avatar URLs whenever their stored object changes.
 * Keying and resetting on that complete URL prevents one screen from retaining
 * an old native image while another screen already shows the replacement.
 */
export function UserAvatar({ photoUrl = "", style, imageStyle, fallback = null }: Props) {
  const [failedUrl, setFailedUrl] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setFailedUrl("");
    setRetry(0);
  }, [photoUrl]);

  const showPhoto = Boolean(photoUrl && failedUrl !== photoUrl);
  return (
    <View style={[styles.container, style]}>
      {showPhoto ? (
        <Image
          key={`${photoUrl}:${retry}`}
          source={{ ...authenticatedAssetSource(photoUrl), cache: retry ? "reload" : "default" }}
          resizeMode="cover"
          style={[styles.image, imageStyle]}
          onError={() => {
            if (retry === 0) setRetry(1);
            else setFailedUrl(photoUrl);
          }}
        />
      ) : fallback}
    </View>
  );
}

const styles = StyleSheet.create({
  // Most avatar call sites already provide a sized, circular parent. Filling
  // that parent is essential: percentage-sized Images otherwise resolve
  // against a zero-width wrapper and appear as an empty colored circle.
  container: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
