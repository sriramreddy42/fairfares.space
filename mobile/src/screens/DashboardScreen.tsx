import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { getRentalBookings, getRideActivity, respondToRideDispatch } from "../api/client";
import { appAssets } from "../assets";
import { theme } from "../theme";
import { BootstrapPayload, HousingPost, RentalServiceBooking, RidePost } from "../types";

type Props = {
  data: BootstrapPayload | null;
  onReserveRide?: () => void;
  onRideMessage?: (ride: RidePost) => void;
  onOpenHousing?: () => void;
  onOpenServices?: () => void;
  onOpenRideOwner?: (target?: "workspace" | "requests" | "listings") => void;
  onRequireLogin?: () => void;
};

const ACTIVE_RIDE_STATUSES = new Set(["ACTIVE", "REQUESTED", "MATCHING", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "OPEN", "PENDING"]);
const PAST_RIDE_STATUSES = new Set(["COMPLETED", "CANCELLED", "CANCELED", "EXPIRED", "DECLINED"]);
const CONFIRMED_TRIP_STATUSES = new Set(["ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"]);

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

function isConfirmedUpcomingTrip(ride: RidePost) {
  const status = (ride.dispatchStatus || ride.status || "").toUpperCase();
  return CONFIRMED_TRIP_STATUSES.has(status) && isUpcomingRide(ride);
}

function isPendingRiderRequest(ride: RidePost) {
  const status = (ride.dispatchStatus || ride.status || "PENDING").toUpperCase();
  return ["PENDING", "REQUESTED", "MATCHING", "ACTIVE", "OPEN"].includes(status) && isUpcomingRide(ride);
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

function pickupDropCopy(ride: RidePost) {
  const pickup = ride.pickupDistanceMiles === null || ride.pickupDistanceMiles === undefined
    ? ""
    : `${Number(ride.pickupDistanceMiles).toFixed(Number(ride.pickupDistanceMiles) % 1 ? 1 : 0)} mi pickup`;
  const dropoff = ride.dropoffDistanceMiles === null || ride.dropoffDistanceMiles === undefined
    ? ""
    : `${Number(ride.dropoffDistanceMiles).toFixed(Number(ride.dropoffDistanceMiles) % 1 ? 1 : 0)} mi drop-off`;
  return [pickup, dropoff].filter(Boolean).join(" · ") || "Pickup/drop-off calculating";
}

function statusCopy(ride: RidePost) {
  if (ride.isExpired) return "Expired";
  const dispatch = (ride.dispatchStatus || "").toUpperCase();
  const status = (dispatch || ride.status || "ACTIVE").toUpperCase();
  if (status === "ACCEPTED") return `${etaFromDistance(ride.pickupDistanceMiles)} · Accepted`;
  if (status === "EN_ROUTE") return `${etaFromDistance(ride.pickupDistanceMiles)} · Driver on the way`;
  if (status === "ARRIVED") return "Driver arrived";
  if (status === "IN_PROGRESS") return "Ride in progress";
  if (ride.dispatchNotifiedCount) return `Matching · ${ride.dispatchNotifiedCount} nearby driver${ride.dispatchNotifiedCount === 1 ? "" : "s"} notified`;
  if (ride.dispatchNearestRadius) return `Matching within ${ride.dispatchNearestRadius} mi`;
  return titleCase(status);
}

function riderRequestStatusCopy(ride: RidePost) {
  if (ride.isExpired) return "Expired";
  const dispatch = (ride.dispatchStatus || "").toUpperCase();
  const status = (dispatch || ride.status || "ACTIVE").toUpperCase();
  if (["MATCHING", "REQUESTED", "ACTIVE", "OPEN", "PENDING"].includes(status)) {
    return ride.dispatchNearestRadius ? `Drivers within ${ride.dispatchNearestRadius} mi` : "Finding drivers";
  }
  return statusCopy(ride);
}

function isDriverListedRide(ride: RidePost) {
  return ride.activityRole === "MINE" && ride.role === "DRIVER";
}

function isIncomingRiderRequest(ride: RidePost) {
  return ride.activityRole === "DRIVER_NOTIFICATION";
}

function detourCopy(ride: RidePost) {
  const miles = ride.routeDeviationMiles;
  const minutes = ride.routeDeviationMinutes;
  if (miles === null || miles === undefined) return "Total detour calculating";
  const mileLabel = `${Number(miles).toFixed(Number(miles) % 1 ? 1 : 0)} mi`;
  return minutes === null || minutes === undefined ? `Total detour ${mileLabel}` : `Total detour ${mileLabel} · ${Math.round(Number(minutes))} min`;
}

function firstName(data: BootstrapPayload | null) {
  return data?.user?.name?.split(" ")[0] || "there";
}

function isCoordinateOnly(value: string) {
  return /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(value.trim());
}

function cleanRoutePoint(value?: string) {
  const raw = (value || "").replace(/\s+/g, " ").trim();
  if (!raw || isCoordinateOnly(raw)) return "";
  if (/^current location$/i.test(raw)) return "Current location";
  return raw;
}

function isMeaningfulRoutePoint(value?: string) {
  const label = cleanRoutePoint(value);
  if (!label) return false;
  if (/^(fdss?|dff|asdf|qwer|test|testing)$/i.test(label)) return false;
  return label.length >= 4;
}

function isDisplayableRide(ride: RidePost) {
  const origin = cleanRoutePoint(ride.origin);
  const destination = cleanRoutePoint(ride.destination);
  return isMeaningfulRoutePoint(origin) && isMeaningfulRoutePoint(destination) && origin.toLowerCase() !== destination.toLowerCase();
}

function isExpiredRide(ride: RidePost) {
  const status = String(ride.dispatchStatus || ride.status || "").toUpperCase();
  return Boolean(ride.isExpired || status === "EXPIRED");
}

function routeLabel(ride: RidePost) {
  return `${cleanRoutePoint(ride.origin) || "Pickup"} → ${cleanRoutePoint(ride.destination) || "Destination"}`;
}

function matchedListingLabel(ride: RidePost) {
  const origin = cleanRoutePoint(ride.matchedRouteOrigin);
  const destination = cleanRoutePoint(ride.matchedRouteDestination);
  if (!origin || !destination) return "";
  return `Matched to your listing: ${origin} → ${destination}`;
}

function rideActionLabel(ride: RidePost) {
  if (isDriverListedRide(ride)) return ride.isExpired ? "Expired route" : "Listed route";
  if (isIncomingRiderRequest(ride)) return "Rider request";
  return ride.role === "DRIVER" ? "Driver offer" : "Ride request";
}

function CarOutlineIcon() {
  return (
    <View style={styles.carIconCanvas}>
      <View style={styles.carIconRoof} />
      <View style={styles.carIconBody} />
      <View style={[styles.carIconWheel, styles.carIconWheelLeft]} />
      <View style={[styles.carIconWheel, styles.carIconWheelRight]} />
    </View>
  );
}

function ActivityIcon({ kind, color }: { kind: "route" | "items" | "riders" | "listings" | "calendar" | "person"; color: string }) {
  if (kind === "route") {
    return <View style={styles.routeGlyph}><View style={[styles.routeDot, styles.routeDotStart, { borderColor: color }]} /><View style={[styles.routeLine, styles.routeLineOne, { backgroundColor: color }]} /><View style={[styles.routeDot, styles.routeDotMiddle, { borderColor: color }]} /><View style={[styles.routeLine, styles.routeLineTwo, { backgroundColor: color }]} /><View style={[styles.routeDot, styles.routeDotEnd, { borderColor: color }]} /></View>;
  }
  const symbols = { route: "", items: "⬡", riders: "♙", listings: "☷", calendar: "□", person: "♙" };
  return <Text style={[styles.activityGlyph, { color }]}>{symbols[kind]}</Text>;
}

export function DashboardScreen({ data, onReserveRide, onRideMessage, onOpenHousing, onOpenServices, onOpenRideOwner, onRequireLogin }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [rides, setRides] = useState<RidePost[]>([]);
  const [bookings, setBookings] = useState<RentalServiceBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [rideActionBusyId, setRideActionBusyId] = useState("");

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

  const cleanRides = useMemo(() => rides.filter((ride) => isDisplayableRide(ride) && !isExpiredRide(ride)), [rides]);
  const driverListedRides = useMemo(() => cleanRides.filter(isDriverListedRide), [cleanRides]);
  const incomingRiderRequests = useMemo(() => cleanRides.filter(isIncomingRiderRequest), [cleanRides]);
  const pendingRiderRequests = useMemo(() => incomingRiderRequests.filter(isPendingRiderRequest), [incomingRiderRequests]);
  const travelerRides = useMemo(() => cleanRides.filter((ride) => !isDriverListedRide(ride) && !isIncomingRiderRequest(ride)), [cleanRides]);
  const upcomingRides = useMemo(() => {
    const confirmed = [...travelerRides, ...incomingRiderRequests].filter(isConfirmedUpcomingTrip);
    const seen = new Set<string>();
    return confirmed.filter((ride) => {
      const key = `${ride.activityRole || ""}:${ride.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [travelerRides, incomingRiderRequests]);
  const pastRides = useMemo(() => travelerRides.filter((ride) => !isUpcomingRide(ride)), [travelerRides]);
  const carpoolActivityCount = driverListedRides.length + pendingRiderRequests.length;
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

  function handleListRide() {
    if (!data?.user) {
      onRequireLogin?.();
      return;
    }
    onOpenRideOwner?.();
  }

  function handleRideChat(ride: RidePost) {
    if (!data?.user) {
      onRequireLogin?.();
      return;
    }
    onRideMessage?.(ride);
  }

  async function handleRequestDecision(ride: RidePost, action: "ACCEPT" | "DECLINE" | "EN_ROUTE" | "ARRIVED" | "COMPLETED") {
    if (ride.isExpired) {
      Alert.alert("Request expired", "This ride date has passed, so the request can no longer be accepted.");
      return;
    }
    setRideActionBusyId(ride.id);
    try {
      const updated = await respondToRideDispatch(ride.id, action);
      setRides((current) => current.map((item) => item.id === ride.id ? { ...item, ...updated } : item));
      if (action === "ACCEPT") {
        Alert.alert("Request accepted", `The seat is confirmed.${updated.pickupPin ? ` Pickup PIN: ${updated.pickupPin}.` : ""} You can continue in FChat.`);
      } else if (action === "DECLINE") {
        Alert.alert("Request declined", "The rider request has been declined.");
      } else if (action === "EN_ROUTE") {
        Alert.alert("Rider notified", "The rider has been notified that you are on the way.");
      } else if (action === "ARRIVED") {
        Alert.alert("Rider notified", "The rider has been notified that you have arrived.");
      } else {
        Alert.alert("Ride completed", "This carpool is now in Past activity.");
      }
    } catch (error) {
      Alert.alert("Ride update failed", error instanceof Error ? error.message : "Unable to update this rider request.");
    } finally {
      setRideActionBusyId("");
    }
  }

  function latestRideChatPreview(ride: RidePost) {
    const conversation = (data?.chat?.conversations || []).find((item) => item.rideId === ride.id || item.rideId === ride.acceptedDriverRideId || item.rideId === ride.matchedRideId);
    if (!conversation?.lastMessage) return "";
    if (/end-to-end encrypted message/i.test(conversation.lastMessage)) return "New secure FChat message";
    return conversation.lastMessage;
  }

  async function openRideRoute(ride: RidePost) {
    const origin = cleanRoutePoint(ride.origin);
    const destination = cleanRoutePoint(ride.destination);
    if (!origin || !destination) {
      Alert.alert("Route unavailable", "Pickup and destination are still being confirmed.");
      return;
    }
    const url = Platform.OS === "ios"
      ? `http://maps.apple.com/?saddr=${encodeURIComponent(origin)}&daddr=${encodeURIComponent(destination)}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Map unavailable", "The route could not be opened on this device.");
    }
  }

  const upcomingCardWidth = Math.min(430, Math.max(286, windowWidth - 52));

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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={upcomingCardWidth + 10} decelerationRate="fast" contentContainerStyle={styles.upcomingCarousel}>
        {upcomingRides.map((ride) => (
          <View key={`ride-${ride.activityRole || "trip"}-${ride.id}`} style={[styles.rideCard, { width: upcomingCardWidth }]}>
            <View style={styles.roleRow}>
              <Text style={styles.roleBadge}>{statusCopy(ride)}</Text>
              <Text style={styles.cardMeta}>{compactDate(ride.pickupDate || ride.startDate, ride.pickupTime)}</Text>
            </View>
            <Text style={styles.cardTitle}>{rideActionLabel(ride)}</Text>
            <Text style={styles.routeText} numberOfLines={2}>{routeLabel(ride)}</Text>
            <View style={styles.metricRow}>
              {ride.pickupPin ? <Text style={styles.metricPill}>PIN {ride.pickupPin}</Text> : null}
              <Text style={styles.metricPill}>{distanceCopy(ride)}</Text>
              <Text style={styles.metricPill}>{ride.typeLabel}</Text>
            </View>
            {latestRideChatPreview(ride) ? <Text style={styles.latestChatPreview} numberOfLines={1}>FChat · {latestRideChatPreview(ride)}</Text> : null}
            <View style={styles.actionRow}>
              {isIncomingRiderRequest(ride) && (ride.dispatchStatus || "").toUpperCase() === "ACCEPTED" ? (
                <TouchableOpacity style={styles.acceptPill} onPress={() => handleRequestDecision(ride, "EN_ROUTE")} disabled={rideActionBusyId === ride.id}>
                  <Text style={styles.requestActionText}>{rideActionBusyId === ride.id ? "Updating..." : "Start trip"}</Text>
                </TouchableOpacity>
              ) : null}
              {isIncomingRiderRequest(ride) && (ride.dispatchStatus || "").toUpperCase() === "EN_ROUTE" ? (
                <TouchableOpacity style={styles.acceptPill} onPress={() => handleRequestDecision(ride, "ARRIVED")} disabled={rideActionBusyId === ride.id}>
                  <Text style={styles.requestActionText}>{rideActionBusyId === ride.id ? "Updating..." : "I've arrived"}</Text>
                </TouchableOpacity>
              ) : null}
              {isIncomingRiderRequest(ride) && ["ARRIVED", "IN_PROGRESS"].includes((ride.dispatchStatus || ride.status || "").toUpperCase()) ? (
                <TouchableOpacity style={styles.acceptPill} onPress={() => handleRequestDecision(ride, "COMPLETED")} disabled={rideActionBusyId === ride.id}>
                  <Text style={styles.requestActionText}>{rideActionBusyId === ride.id ? "Updating..." : "Complete trip"}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.secondaryPill} onPress={() => handleRideChat(ride)}>
                <Text style={styles.secondaryPillText}>FChat</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryPill} onPress={() => void openRideRoute(ride)}>
                <Text style={styles.secondaryPillText}>View route</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryPill} onPress={() => handleRideChat(ride)}>
                <Text style={styles.secondaryPillText}>Driver location</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        </ScrollView>
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

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Carpool</Text>
        <Text style={styles.sectionMeta}>{driverListedRides.length} listings · {pendingRiderRequests.length} requests</Text>
      </View>
      <View style={styles.carpoolHub}>
        <View style={styles.carpoolSummaryRow}>
          <View style={styles.carpoolSummaryPill}>
            <View style={[styles.summaryIconCircle, styles.summaryIconRoute]}><ActivityIcon kind="route" color="#ffffff" /></View>
            <View style={styles.summaryCopy}>
              <Text style={styles.carpoolSummaryNumber}>{driverListedRides.length}</Text>
              <Text style={styles.carpoolSummaryLabel}>Listed routes</Text>
            </View>
            <Text style={styles.summaryChevron}>›</Text>
          </View>
          <View style={styles.carpoolSummaryPill}>
            <View style={[styles.summaryIconCircle, styles.summaryIconItems]}><ActivityIcon kind="items" color="#ffffff" /></View>
            <View style={styles.summaryCopy}>
              <Text style={styles.carpoolSummaryNumber}>{carpoolActivityCount}</Text>
              <Text style={styles.carpoolSummaryLabel}>Total items</Text>
            </View>
            <Text style={styles.summaryChevron}>›</Text>
          </View>
        </View>

        <View style={styles.activityGroupHeader}>
          <View style={styles.activityGroupTitleRow}><ActivityIcon kind="riders" color="#22e58a" /><Text style={styles.carpoolGroupLabel}>Rider requests</Text></View>
          <TouchableOpacity onPress={() => onOpenRideOwner?.("requests")}><Text style={styles.viewRequestsText}>View all requests →</Text></TouchableOpacity>
        </View>
        {pendingRiderRequests.length ? (
          pendingRiderRequests.slice(0, 4).map((ride) => (
            <View key={`request-${ride.id}`} style={styles.carpoolRequestRow}>
              <View style={styles.requestCarCircle}><CarOutlineIcon /></View>
              <View style={styles.requestMain}>
                <Text style={styles.requestBadge}>{riderRequestStatusCopy(ride)}</Text>
                <Text style={styles.requestRouteTitle} numberOfLines={2}>{routeLabel(ride)}</Text>
                {matchedListingLabel(ride) ? <Text style={styles.matchedListingText} numberOfLines={2}>{matchedListingLabel(ride)}</Text> : null}
                <Text style={styles.carpoolMiniMeta}>{detourCopy(ride)} · {pickupDropCopy(ride)}</Text>
                <View style={styles.metricRow}>
                  {ride.pickupPin ? <Text style={styles.metricPill}>PIN {ride.pickupPin}</Text> : null}
                  <View style={styles.iconMetricPill}><ActivityIcon kind="person" color="#d5dbea" /><Text style={styles.iconMetricText}>{ride.seats || 1} passenger{ride.seats === 1 ? "" : "s"}</Text></View>
                </View>
              </View>
              <View style={styles.requestSide}>
                <View style={styles.requestDateRow}><ActivityIcon kind="calendar" color="#c2cada" /><Text style={styles.requestDateText}>{compactDate(ride.pickupDate || ride.startDate, ride.pickupTime)}</Text><Text style={styles.moreGlyph}>⋮</Text></View>
                <View style={styles.actionRow}>
                  {!ride.isExpired && isPendingRiderRequest(ride) ? (
                    <><TouchableOpacity style={styles.acceptPill} onPress={() => handleRequestDecision(ride, "ACCEPT")} disabled={rideActionBusyId === ride.id}><Text style={styles.requestActionText}>{rideActionBusyId === ride.id ? "Updating..." : "Accept"}</Text></TouchableOpacity><TouchableOpacity style={styles.declinePill} onPress={() => handleRequestDecision(ride, "DECLINE")} disabled={rideActionBusyId === ride.id}><Text style={styles.requestActionText}>Decline</Text></TouchableOpacity></>
                  ) : null}
                  <TouchableOpacity style={styles.primarySmallPill} onPress={() => handleRideChat(ride)}><Image source={appAssets.fchat} style={styles.fchatButtonIcon} resizeMode="contain" /><Text style={styles.primarySmallPillText}>FChat</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.detailsOutlinePill} onPress={() => Alert.alert("Request details", `${routeLabel(ride)}\n${detourCopy(ride)}\n${pickupDropCopy(ride)}\n${statusCopy(ride)}`)}><Text style={styles.secondaryPillText}>Details</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.carpoolEmpty}>
            <Text style={styles.emptyTitle}>No rider requests yet</Text>
            <Text style={styles.emptyCopy}>When someone requests a seat on your route, the count and FChat action will show here.</Text>
          </View>
        )}

        <View style={styles.activityGroupHeader}>
          <View style={styles.activityGroupTitleRow}><ActivityIcon kind="listings" color="#8957ff" /><Text style={styles.carpoolGroupLabel}>Your listings</Text></View>
          <TouchableOpacity onPress={() => onOpenRideOwner?.("listings")}><Text style={styles.viewListingsText}>View all listings →</Text></TouchableOpacity>
        </View>
        {driverListedRides.length ? (
          driverListedRides.slice(0, 4).map((ride) => (
            <View key={`listed-${ride.id}`} style={styles.carpoolListingRow}>
              <View style={styles.listingRouteCircle}><ActivityIcon kind="route" color="#ffffff" /></View>
              <View style={styles.requestMain}>
                <Text style={[styles.listingBadge, ride.isExpired && styles.expiredBadge]}>{ride.isExpired ? "Expired" : statusCopy(ride)}</Text>
                <Text style={styles.requestRouteTitle} numberOfLines={2}>{routeLabel(ride)}</Text>
                <View style={styles.metricRow}>
                  <View style={styles.iconMetricPill}><ActivityIcon kind="person" color="#d5dbea" /><Text style={styles.iconMetricText}>{ride.seats || 1} seat{ride.seats === 1 ? "" : "s"}</Text></View>
                  <Text style={styles.metricPill}>{ride.contributionPerSeat ? money(ride.contributionPerSeat) : "Direct agreement"}</Text>
                </View>
              </View>
              <View style={styles.requestSide}>
                <View style={styles.requestDateRow}><ActivityIcon kind="calendar" color="#c2cada" /><Text style={styles.requestDateText}>{compactDate(ride.pickupDate || ride.startDate, ride.pickupTime)}</Text><Text style={styles.moreGlyph}>⋮</Text></View>
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.primarySmallPill} onPress={() => handleRideChat(ride)}><Image source={appAssets.fchat} style={styles.fchatButtonIcon} resizeMode="contain" /><Text style={styles.primarySmallPillText}>FChat</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.detailsOutlinePill} onPress={handleListRide}><Text style={styles.secondaryPillText}>List another</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        ) : (
          <TouchableOpacity style={styles.carpoolEmpty} onPress={handleListRide}>
            <Text style={styles.emptyTitle}>No listed carpool routes</Text>
            <Text style={styles.emptyCopy}>List your ride to start receiving rider requests.</Text>
          </TouchableOpacity>
        )}
      </View>

      {refreshError ? (
        <View style={styles.syncNotice} accessibilityLiveRegion="polite">
          <Text style={styles.syncNoticeDot}>•</Text>
          <Text style={styles.syncNoticeText}>Activity is syncing. Existing information remains available.</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Past</Text>
        <TouchableOpacity style={styles.filterButton} onPress={() => Alert.alert("Filters", "Activity filters are coming next: rides, rentals, housing, and chats.")}>
          <Text style={styles.filterText}>☷</Text>
        </TouchableOpacity>
      </View>

      {pastRides.slice(0, 2).map((ride) => (
        <View key={`past-ride-${ride.id}`} style={styles.pastFeature}>
          <Text style={styles.roleBadge}>{statusCopy(ride)}</Text>
          <Text style={styles.cardTitle} numberOfLines={2}>{routeLabel(ride)}</Text>
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

      {pastRides.slice(2, 5).map((ride) => (
        <TouchableOpacity key={`past-row-${ride.id}`} style={styles.historyRow} onPress={handleReserveRide}>
          <View style={styles.rowIcon}><Text style={styles.rowIconText}>🚘</Text></View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={2}>{routeLabel(ride)}</Text>
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
  content: { padding: theme.spacing.md, paddingBottom: 104, gap: 12 },
  title: { color: theme.colors.text, fontSize: 24, lineHeight: 29, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: theme.spacing.sm },
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  sectionMeta: { color: theme.colors.muted, fontWeight: "600", fontSize: 13 },
  noticeCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.line, gap: theme.spacing.sm },
  noticeTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
  noticeCopy: { color: theme.colors.muted, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  primaryPill: { alignSelf: "flex-start", backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 20, paddingVertical: 12 },
  primaryPillText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  emptyTripCard: { minHeight: 112, backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.md },
  emptyTripText: { flex: 1, minWidth: 0 },
  emptyTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  emptyCopy: { color: theme.colors.muted, fontSize: 13, fontWeight: "600", marginTop: 3 },
  emptyIconBox: { width: 44, height: 44, borderRadius: 15, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  emptyIcon: { fontSize: 24 },
  upcomingCarousel: { gap: 10, paddingRight: 10 },
  rideCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, gap: theme.spacing.sm },
  latestChatPreview: { color: theme.colors.soft, backgroundColor: "rgba(59,130,246,0.12)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12, fontWeight: "500", overflow: "hidden" },
  cardTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  routeText: { color: theme.colors.soft, fontSize: 16, fontWeight: "700", lineHeight: 22 },
  cardMeta: { color: theme.colors.muted, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  metricRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  metricPill: { color: theme.colors.text, backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 7, fontWeight: "700", fontSize: 13, overflow: "hidden" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: 2 },
  secondaryPill: { backgroundColor: theme.colors.panel2, borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 10 },
  secondaryPillText: { color: theme.colors.text, fontWeight: "500", fontSize: 12 },
  bookingCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, gap: 4 },
  moneyText: { color: theme.colors.green, fontSize: 18, fontWeight: "900" },
  driverCard: { backgroundColor: "#111827", borderRadius: theme.radius.lg, borderWidth: 1, borderColor: "rgba(59,130,246,0.55)", padding: theme.spacing.md, gap: theme.spacing.sm },
  requestCard: { backgroundColor: "#132018", borderRadius: theme.radius.lg, borderWidth: 1, borderColor: "rgba(34,197,94,0.45)", padding: theme.spacing.md, gap: theme.spacing.sm },
  carpoolHub: { backgroundColor: "#030b1d", borderRadius: 17, borderWidth: 1, borderColor: "rgba(36,61,104,0.55)", padding: 9, gap: 10 },
  carpoolHubHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.md },
  carpoolHubIntro: { flex: 1, minWidth: 0 },
  carpoolHubTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900" },
  carpoolHubCopy: { color: theme.colors.muted, fontSize: 14, lineHeight: 20, fontWeight: "700", marginTop: 4 },
  carpoolCountBubble: { minWidth: 78, borderRadius: theme.radius.lg, backgroundColor: "rgba(34,197,94,0.16)", borderWidth: 1, borderColor: "rgba(34,197,94,0.38)", paddingHorizontal: 12, paddingVertical: 10, alignItems: "center" },
  carpoolCountText: { color: theme.colors.green, fontSize: 25, fontWeight: "900" },
  carpoolCountLabel: { color: theme.colors.soft, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
  carpoolSummaryRow: { flexDirection: "row", gap: theme.spacing.sm },
  carpoolSummaryPill: { flex: 1, minWidth: 0, minHeight: 60, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#0b152a", borderRadius: 14, borderWidth: 1, borderColor: "rgba(65,84,122,0.34)", paddingHorizontal: 8, paddingVertical: 7 },
  summaryIconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  summaryIconRoute: { backgroundColor: "#31228d" },
  summaryIconItems: { backgroundColor: "#123ea1" },
  summaryCopy: { flex: 1 },
  summaryChevron: { color: "#cbd5e1", fontSize: 21, fontWeight: "400" },
  carpoolSummaryNumber: { color: theme.colors.text, fontSize: 17, fontWeight: "500" },
  carpoolSummaryLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: "400" },
  activityGroupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 5 },
  activityGroupTitleRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  carpoolGroupLabel: { color: theme.colors.soft, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 },
  viewRequestsText: { color: "#22e58a", fontWeight: "500", fontSize: 11 },
  viewListingsText: { color: "#9468ff", fontWeight: "500", fontSize: 11 },
  activityGlyph: { fontSize: 22, lineHeight: 24, fontWeight: "900" },
  routeGlyph: { width: 33, height: 25, position: "relative" },
  routeDot: { position: "absolute", width: 7, height: 7, borderRadius: 4, borderWidth: 2 },
  routeDotStart: { left: 1, bottom: 2 },
  routeDotMiddle: { left: 14, top: 3 },
  routeDotEnd: { right: 0, bottom: 5 },
  routeLine: { position: "absolute", width: 14, height: 2, borderRadius: 1 },
  routeLineOne: { left: 5, top: 15, transform: [{ rotate: "-38deg" }] },
  routeLineTwo: { left: 18, top: 11, transform: [{ rotate: "29deg" }] },
  carpoolRequestRow: { backgroundColor: "#09162c", borderRadius: 15, borderWidth: 1, borderLeftWidth: 3, borderColor: "rgba(48,77,123,0.58)", borderLeftColor: "#19b775", padding: 9, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 9 },
  requestCarCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(11,112,72,0.45)", alignItems: "center", justifyContent: "center", marginTop: 18 },
  carIconCanvas: { width: 28, height: 23, position: "relative" },
  carIconRoof: { position: "absolute", left: 7, top: 2, width: 17, height: 10, borderWidth: 2, borderColor: "#2ff29a", borderBottomWidth: 0, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  carIconBody: { position: "absolute", left: 2, top: 9, width: 26, height: 10, borderWidth: 2, borderColor: "#2ff29a", borderRadius: 4 },
  carIconWheel: { position: "absolute", top: 17, width: 6, height: 6, borderRadius: 3, backgroundColor: "#2ff29a" },
  carIconWheelLeft: { left: 7 },
  carIconWheelRight: { right: 2 },
  requestMain: { flex: 1, minWidth: 220, gap: 4 },
  requestRouteTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "500", lineHeight: 18 },
  matchedListingText: { color: "#6ee7b7", fontSize: 11, lineHeight: 15, fontWeight: "400" },
  requestSide: { flexBasis: "100%", minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 1 },
  requestDateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  requestDateText: { color: "#c7cfdf", fontWeight: "400", fontSize: 11 },
  moreGlyph: { color: "#b7c0d1", fontSize: 19, marginLeft: 3 },
  iconMetricPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(30,41,59,0.9)", borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 5 },
  iconMetricText: { color: theme.colors.text, fontWeight: "500", fontSize: 11 },
  carpoolListingRow: { backgroundColor: "#09162c", borderRadius: 15, borderWidth: 1, borderLeftWidth: 3, borderColor: "rgba(48,77,123,0.58)", borderLeftColor: "#7653f6", padding: 9, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 9 },
  listingRouteCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#30218c", alignItems: "center", justifyContent: "center", marginTop: 18 },
  listingBadge: { alignSelf: "flex-start", color: "#ddd6fe", backgroundColor: "rgba(109,70,230,0.5)", borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden", fontWeight: "500", fontSize: 10 },
  carpoolMiniMeta: { color: theme.colors.muted, fontSize: 11, lineHeight: 15, fontWeight: "400" },
  carpoolEmpty: { backgroundColor: "rgba(15,23,42,0.9)", borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 14, paddingVertical: 12 },
  primarySmallPill: { minHeight: 34, backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 5 },
  primarySmallPillText: { color: "#fff", fontWeight: "500", fontSize: 12 },
  fchatButtonIcon: { width: 17, height: 17, tintColor: "#fff" },
  detailsOutlinePill: { minHeight: 34, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: "rgba(108,125,158,0.52)", paddingHorizontal: 14, justifyContent: "center" },
  acceptPill: { backgroundColor: "#16a34a", borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 10 },
  declinePill: { backgroundColor: "#dc2626", borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 10 },
  requestActionText: { color: "#fff", fontWeight: "700" },
  roleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.sm },
  roleBadge: { color: theme.colors.text, backgroundColor: "rgba(59,130,246,0.25)", borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 6, overflow: "hidden", fontWeight: "900", fontSize: 12 },
  requestBadge: { alignSelf: "flex-start", color: theme.colors.text, backgroundColor: "rgba(34,197,94,0.25)", borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden", fontWeight: "500", fontSize: 10 },
  expiredBadge: { backgroundColor: "rgba(148,163,184,0.18)", color: theme.colors.muted },
  syncNotice: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 4, paddingVertical: 3 },
  syncNoticeDot: { color: "#f3ad4f", fontSize: 20, lineHeight: 20 },
  syncNoticeText: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, fontWeight: "500", flex: 1 },
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
