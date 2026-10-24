import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getMemberRatingDetails, MemberRatingDetails } from "../api/client";

export function MemberRatingsSheet({ userId, memberName, visible, onClose }: { userId: number; memberName: string; visible: boolean; onClose: () => void }) {
  const [details, setDetails] = useState<MemberRatingDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible || !userId) return;
    let active = true;
    setLoading(true); setFailed(false); setDetails(null);
    void getMemberRatingDetails(userId).then((value) => { if (active) setDetails(value); }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, visible]);
  const total = details?.summary.count || 0;
  return <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}><View style={styles.card}>
      <View style={styles.header}><View><Text style={styles.eyebrow}>MEMBER RATINGS</Text><Text style={styles.title}>{memberName}</Text></View><TouchableOpacity onPress={onClose} style={styles.close} accessibilityLabel="Close ratings"><Text style={styles.closeText}>×</Text></TouchableOpacity></View>
      {loading ? <View style={styles.state}><ActivityIndicator color="#16a36a" /></View> : failed ? <View style={styles.state}><Text style={styles.stateText}>Ratings are temporarily unavailable.</Text></View> : details ? <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.overview}><Text style={styles.average}>{details.summary.average ? details.summary.average.toFixed(1) : "—"}</Text><View><Text style={styles.stars}>★★★★★</Text><Text style={styles.total}>{total} {total === 1 ? "rating" : "ratings"}</Text></View></View>
        <View style={styles.breakdown}>{[5, 4, 3, 2, 1].map((score) => { const count = Number(details.breakdown[String(score)] || 0); const width = (total ? `${Math.round((count / total) * 100)}%` : "0%") as `${number}%`; return <View key={score} style={styles.breakdownRow}><Text style={styles.scoreLabel}>{score} ★</Text><View style={styles.track}><View style={[styles.fill, { width }]} /></View><Text style={styles.count}>{count}</Text></View>; })}</View>
        <Text style={styles.reviewHeading}>What members said</Text>
        {details.reviews.length ? details.reviews.map((review, index) => <View key={`${review.createdAt}-${index}`} style={styles.review}><View style={styles.reviewTop}><Text style={styles.reviewStars}>{"★".repeat(Math.max(0, Math.min(5, review.score)))}</Text><Text style={styles.reviewContext}>{review.context}</Text></View><Text style={styles.reviewText}>{review.comment}</Text></View>) : <Text style={styles.empty}>No written feedback yet.</Text>}
        <Text style={styles.note}>Ratings come from verified FairFares interactions. Reviewer names stay private.</Text>
      </ScrollView> : null}
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.48)" }, card: { maxHeight: "82%", borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: "#fff", overflow: "hidden" },
  header: { minHeight: 82, paddingHorizontal: 20, paddingTop: 17, paddingBottom: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#e8ebed" }, eyebrow: { color: "#15a36b", fontSize: 10, fontWeight: "900", letterSpacing: 1.2 }, title: { color: "#14221b", fontSize: 22, lineHeight: 27, fontWeight: "900", marginTop: 3 }, close: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#edf1f2" }, closeText: { color: "#253039", fontSize: 28, lineHeight: 30 },
  state: { minHeight: 180, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 }, stateText: { color: "#667078", fontSize: 14, fontWeight: "700", textAlign: "center" }, content: { padding: 20, paddingBottom: 34 }, overview: { flexDirection: "row", alignItems: "center", gap: 17 }, average: { color: "#15221c", fontSize: 46, lineHeight: 52, fontWeight: "900" }, stars: { color: "#f5ac1b", letterSpacing: 1, fontSize: 20 }, total: { color: "#687178", fontSize: 13, fontWeight: "700", marginTop: 3 },
  breakdown: { marginTop: 18, gap: 8 }, breakdownRow: { flexDirection: "row", alignItems: "center", gap: 9 }, scoreLabel: { width: 26, color: "#49545b", fontSize: 12, fontWeight: "800" }, track: { flex: 1, height: 9, borderRadius: 9, backgroundColor: "#e9edef", overflow: "hidden" }, fill: { height: "100%", borderRadius: 9, backgroundColor: "#f5ac1b" }, count: { width: 24, color: "#687178", fontSize: 12, fontWeight: "800", textAlign: "right" },
  reviewHeading: { color: "#14221b", fontSize: 17, fontWeight: "900", marginTop: 25, marginBottom: 10 }, review: { borderRadius: 15, backgroundColor: "#f5f7f7", padding: 13, marginBottom: 9 }, reviewTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, reviewStars: { color: "#f5ac1b", fontSize: 15, letterSpacing: 1 }, reviewContext: { color: "#778087", fontSize: 10, fontWeight: "800" }, reviewText: { color: "#26332c", fontSize: 14, lineHeight: 20, marginTop: 7 }, empty: { color: "#687178", fontSize: 13, fontWeight: "700", paddingVertical: 12 }, note: { color: "#7b848a", fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 16, paddingHorizontal: 12 }
});
