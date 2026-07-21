import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getRentalBookings, getRideActivity, rideMapUrl } from "../api/client";
import { theme } from "../theme";
import { BootstrapPayload, HousingPost, RentalServiceBooking, RidePost } from "../types";

type Props = {
  data: BootstrapPayload | null;
  onReserveRide?: () => void;
  onRideMessage?: (ride: RidePost) => void;
  onOpenHousing?: () => void;
  onOpenServices?: () => void;
  onRequireLogin?: () => void;
};

const ACTIVE_RIDE_STATUSES = new Set(["ACTIVE", "REQUESTED", "MATCHING", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "OPEN", "PENDING"]);
const PAST_RIDE_STATUSES = new Set(["COMPLETED", "CANCELLED", "CANCELED", "EXPIRED", "DECLINED"]);

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseRideDate(ride: RidePost) {
  const date = ride.pickupDate || ride.startDate || "";
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isUpcomingRide(ride: RidePost) {
  const status = (ride.dispatchStatus || ride.status || "").toUpperCase();
  if (PAST_RIDE_STATUSES.has(status)) return false;
  if (ACTIVE_RIDE_STATUSES.has(status)) return true;
  const date = parseRideDate(ride);
  return date ? date.getTime() >= Date.now() - 24 * 60 * 60 * 1000 : true;
}

function isUpcomingBooking(booking: RentalServiceBooking) {
  const status = (booking.status || "").toUpperCase();
  return !["CANCELLED", "CANCELED", "RETURNED", "EXPIRED_HOLD", "COMPLETED"].includes(status);
}

function compactDate(date: string, time = "") {
  if (!date) return time || "Timing open";
  const parsed = new Date(`${date}T00:00:00`);
  const label = Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return time ? `${label} · ${time}` : label;
}

function money(value: number | string | undefined) {
  const amount = Number(value || 0);
  if (!amount) return "";
  return `$${amount.toFixed(amount % 1 ? 2 : 0)}`;
}

function etaFromDistance(distance: number | null | undefined) {
  if (distance === null || distance === undefined || Number.isNaN(Number(distance))) return "ETA pending";
  const miles = Math.max(0, Number(distance));
  const minutes = Math.max(2, Math.round(miles * 3 + 2));
  return `${minutes} min away`;
}

function distanceCopy(ride: RidePost) {
  const distance = ride.pickupDistanceMiles ?? ride.routeDeviationMiles ?? ride.distanceMiles;
  if (distance === null || distance === undefined) return "Distance calculating";
  return `${Number(distance).toFixed(Number(distance) % 1 ? 1 : 0)} mi from pickup`;
}

function statusCopy(ride: RidePost) {
  const dispatch = (ride.dispatchStatus || "").toUpperCase();
  const status = (dispatch || ride.status || "ACTIVE").toUpperCase();
  if (status === "ACCEPTED") return "Accepted";
  if (status === "EN_ROUTE") return `${etaFromDistance(ride.pickupDistanceMiles)} · Driver on the way`;
  if (status === "ARRIVED") return "Driver arrived";
  if (status === "IN_PROGRESS") return "Ride in progress";
  if (ride.dispatchNotifiedCount) return `Matching · ${ride.dispatchNotifiedCount} nearby driver${ride.dispatchNotifiedCount === 1 ? "" : "s"} notified`;
  if (ride.dispatchNearestRadius) return `Matching within ${ride.dispatchNearestRadius} mi`;
  return titleCase(status);
}

function firstName(data: BootstrapPayload | null) {
  return data?.user?.name?.split(" ")[0] || "there";
}

export function DashboardScreen({ data, onReserveRide, onRideMessage, onOpenHousing, onOpenServices, onRequireLogin }: Props) {
  const [rides, setRides] = useState<RidePost[]>([]);
  const [bookings, setBookings] = useState<RentalServiceBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadActivity() {
      if (!data?.user) {
        setRides([]);
        setBookings([]);
        setRefreshError("");
        return;
      }
      setLoading(true);
      setRefreshError("");
      const [rideResult, bookingResult] = await Promise.allSettled([getRideActivity(), getRentalBookings()]);
      if (cancelled) return;
      if (rideResult.status === "fulfilled") {
        setRides(rideResult.value);
      } else {
        setRides([]);
        setRefreshError(rideResult.reason instanceof Error ? rideResult.reason.message : "Ride activity could not be refreshed.");
      }
      if (bookingResult.status === "fulfilled") {
        setBookings(bookingResult.value);
      } else {
        setBookings([]);
        setRefreshError((current) => current || (bookingResult.reason instanceof Error ? bookingResult.reason.message : "Rental bookings could not be refreshed."));
      }
      setLoading(false);
    }
    void loadActivity();
    return () => {
      cancelled = true;
    };
  }, [data?.user?.id]);

  const upcomingRides = useMemo(() => rides.filter(isUpcomingRide), [rides]);
  const pastRides = useMemo(() => rides.filter((ride) => !isUpcomingRide(ride)), [rides]);
  const upcomingBookings = useMemo(() => bookings.filter(isUpcomingBooking), [bookings]);
  const pastBookings = useMemo(() => bookings.filter((booking) => !isUpcomingBooking(booking)), [bookings]);
  const recentHousing = (data?.housing || []).slice(0, 3);

  function handleReserveRide() {
    if (!data?.user) {
      onRequireLogin?.();
      return;
    }
    onReserveRide?.();
  }

  function handleRideChat(ride: RidePost) {
    if (!data?.user) {
      onRequireLogin?.();
      return;
    }
    onRideMessage?.(ride);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>Activity</Text>

      {!data?.user ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>Login to see your trips</Text>
          <Text style={styles.noticeCopy}>Ride requests, driver matches, rental bookings, housing posts, and FChat conversations show here after you sign in.</Text>
          <TouchableOpacity style={styles.primaryPill} onPress={onRequireLogin}>
            <Text style={styles.primaryPillText}>Login</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Upcoming</Text>
        {loading ? <Text style={styles.sectionMeta}>Refreshing...</Text> : null}
      </View>

      {upcomingRides.length ? (
        upcomingRides.slice(0, 4).map((ride) => (
          <View key={`ride-${ride.id}`} style={styles.rideCard}>
            <View style={styles.mapShell}>
              <Image source={{ uri: rideMapUrl(ride.city || data?.location.city || "Denver, CO", ride.origin, ride.destination) }} style={styles.mapImage} />
              <View style={styles.mapOverlay}>
                <Text style={styles.mapBadge}>{statusCopy(ride)}</Text>
                <Text style={styles.mapRoute} numberOfLines={1}>{ride.origin} → {ride.destination}</Text>
              </View>
            </View>
            <View style={styles.rideBody}>
              <Text style={styles.cardTitle}>{ride.title}</Text>
              <Text style={styles.cardMeta}>{compactDate(ride.pickupDate || ride.startDate, ride.pickupTime)} · {ride.typeLabel}</Text>
              <View style={styles.metricRow}>
                <Text style={styles.metricPill}>{distanceCopy(ride)}</Text>
                <Text style={styles.metricPill}>{etaFromDistance(ride.pickupDistanceMiles)}</Text>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.secondaryPill} onPress={() => handleRideChat(ride)}>
                  <Text style={styles.secondaryPillText}>FChat</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryPill} onPress={() => Alert.alert("Ride details", `${ride.origin} to ${ride.destination}\n${statusCopy(ride)}`)}>
                  <Text style={styles.secondaryPillText}>View route</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))
      ) : (
        <TouchableOpacity style={styles.emptyTripCard} onPress={handleReserveRide}>
          <View style={styles.emptyTripText}>
            <Text style={styles.emptyTitle}>You have no upcoming trips</Text>
            <Text style={styles.emptyCopy}>Reserve your ride →</Text>
          </View>
          <View style={styles.emptyIconBox}>
            <Text style={styles.emptyIcon}>📅</Text>
          </View>
        </TouchableOpacity>
      )}

      {upcomingBookings.slice(0, 2).map((booking) => (
        <TouchableOpacity key={`booking-${booking.id}`} style={styles.bookingCard} onPress={onOpenServices}>
          <Text style={styles.cardTitle}>{booking.carName || "Rental car booking"}</Text>
          <Text style={styles.cardMeta}>{compactDate(booking.pickupDate, booking.pickupTime)} · {booking.pickupLocation}</Text>
          <Text style={styles.moneyText}>{booking.totalLabel || money(booking.total)}</Text>
        </TouchableOpacity>
      ))}

      {refreshError ? (
        <TouchableOpacity style={styles.warningCard} onPress={onOpenServices}>
          <Text style={styles.warningTitle}>Some activity could not refresh</Text>
          <Text style={styles.warningCopy}>{refreshError}</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Past</Text>
        <TouchableOpacity style={styles.filterButton} onPress={() => Alert.alert("Filters", "Activity filters are coming next: rides, rentals, housing, and chats.")}>
          <Text style={styles.filterText}>☷</Text>
        </TouchableOpacity>
      </View>

      {pastRides.slice(0, 1).map((ride) => (
        <View key={`past-ride-${ride.id}`} style={styles.pastFeature}>
          <View style={styles.mapShellSmall}>
            <Image source={{ uri: rideMapUrl(ride.city || data?.location.city || "Denver, CO", ride.origin, ride.destination) }} style={styles.mapImage} />
          </View>
          <Text style={styles.cardTitle}>{ride.destination || ride.title}</Text>
          <Text style={styles.cardMeta}>{compactDate(ride.pickupDate || ride.startDate, ride.pickupTime)}</Text>
          <Text style={styles.cardMeta}>{ride.contributionPerSeat ? money(ride.contributionPerSeat) : "Direct agreement"}</Text>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryPill} onPress={() => Alert.alert("Rate", "Rating will attach to this completed ride.")}>
              <Text style={styles.secondaryPillText}>☆ Rate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryPill} onPress={handleReserveRide}>
              <Text style={styles.secondaryPillText}>↻ Rebook</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {pastRides.slice(1, 5).map((ride) => (
        <TouchableOpacity key={`past-row-${ride.id}`} style={styles.historyRow} onPress={handleReserveRide}>
          <View style={styles.rowIcon}><Text style={styles.rowIconText}>🚘</Text></View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{ride.destination || ride.title}</Text>
            <Text style={styles.rowMeta}>{compactDate(ride.pickupDate || ride.startDate, ride.pickupTime)}</Text>
            <Text style={styles.rowMeta}>{ride.contributionPerSeat ? money(ride.contributionPerSeat) : "Direct agreement"}</Text>
          </View>
          <Text style={styles.rebookText}>Rebook</Text>
        </TouchableOpacity>
      ))}

      {pastBookings.slice(0, 4).map((booking) => (
        <TouchableOpacity key={`past-booking-${booking.id}`} style={styles.historyRow} onPress={onOpenServices}>
          <View style={styles.rowIcon}><Text style={styles.rowIconText}>🚗</Text></View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{booking.carName || "Rental car"}</Text>
            <Text style={styles.rowMeta}>{compactDate(booking.pickupDate, booking.pickupTime)}</Text>
            <Text style={styles.rowMeta}>{booking.totalLabel || money(booking.total)}</Text>
          </View>
          <Text style={styles.rebookText}>Details</Text>
        </TouchableOpacity>
      ))}

      {recentHousing.map((post: HousingPost) => (
        <TouchableOpacity key={`housing-${post.id}`} style={styles.historyRow} onPress={onOpenHousing}>
          <View style={styles.rowIcon}><Text style={styles.rowIconText}>🛏</Text></View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{post.title}</Text>
            <Text style={styles.rowMeta}>{post.location} · {post.expiryLabel}</Text>
          </View>
          <Text style={styles.rebookText}>Open</Text>
        </TouchableOpacity>
      ))}

      {!pastRides.length && !pastBookings.length && !recentHousing.length ? (
        <View style={styles.emptyPast}>
          <Text style={styles.emptyTitle}>No past activity yet</Text>
          <Text style={styles.emptyCopy}>Completed rides, rental bookings, and housing actions will collect here.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.md, paddingBottom: 112, gap: theme.spacing.md },
  title: { color: theme.colors.text, fontSize: 34, fontWeight: "900", letterSpacing: 0 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: theme.spacing.sm },
  sectionTitle: { color: theme.colors.text, fontSize: 21, fontWeight: "900" },
  sectionMeta: { color: theme.colors.muted, fontWeight: "800" },
  noticeCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.line, gap: theme.spacing.sm },
  noticeTitle: { color: theme.colors.text, fontSize: 21, fontWeight: "900" },
  noticeCopy: { color: theme.colors.muted, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  primaryPill: { alignSelf: "flex-start", backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 20, paddingVertical: 12 },
  primaryPillText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  emptyTripCard: { minHeight: 112, backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.md },
  emptyTripText: { flex: 1, minWidth: 0 },
  emptyTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  emptyCopy: { color: theme.colors.muted, fontSize: 14, fontWeight: "800", marginTop: 4 },
  emptyIconBox: { width: 44, height: 44, borderRadius: 15, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  emptyIcon: { fontSize: 24 },
  rideCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, overflow: "hidden" },
  mapShell: { height: 168, backgroundColor: "#202124" },
  mapShellSmall: { height: 160, backgroundColor: "#202124", borderRadius: theme.radius.md, overflow: "hidden", marginBottom: theme.spacing.md },
  mapImage: { width: "100%", height: "100%" },
  mapOverlay: { position: "absolute", left: 12, right: 12, bottom: 12, backgroundColor: "rgba(0,0,0,0.72)", borderRadius: theme.radius.sm, padding: theme.spacing.sm },
  mapBadge: { color: theme.colors.green, fontSize: 14, fontWeight: "900" },
  mapRoute: { color: theme.colors.text, fontSize: 15, fontWeight: "900", marginTop: 2 },
  rideBody: { padding: theme.spacing.md, gap: theme.spacing.sm },
  cardTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  cardMeta: { color: theme.colors.muted, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  metricRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  metricPill: { color: theme.colors.text, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 8, fontWeight: "900", overflow: "hidden" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: 2 },
  secondaryPill: { backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 10 },
  secondaryPillText: { color: theme.colors.text, fontWeight: "900" },
  bookingCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, gap: 4 },
  moneyText: { color: theme.colors.green, fontSize: 18, fontWeight: "900" },
  warningCard: { backgroundColor: "#221914", borderRadius: theme.radius.md, borderWidth: 1, borderColor: "#6b3b20", padding: theme.spacing.md },
  warningTitle: { color: theme.colors.warning, fontWeight: "900", fontSize: 16 },
  warningCopy: { color: theme.colors.soft, marginTop: 6, fontWeight: "700", lineHeight: 20 },
  filterButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  filterText: { color: theme.colors.text, fontWeight: "900", fontSize: 20 },
  pastFeature: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, gap: 3 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderColor: theme.colors.line },
  rowIcon: { width: 48, height: 48, borderRadius: theme.radius.sm, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  rowIconText: { fontSize: 23 },
  rowText: { flex: 1 },
  rowTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  rowMeta: { color: theme.colors.muted, marginTop: 3, fontSize: 14, fontWeight: "700" },
  rebookText: { color: theme.colors.soft, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden", fontWeight: "900" },
  emptyPast: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md },
});
