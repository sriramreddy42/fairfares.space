import { Platform, Share } from "react-native";
import { Community, HousingPost, RidePost } from "../types";

const PUBLIC_SITE_URL = "https://www.fairfare.space";
const SHARE_PREVIEW_VERSION = "2";

function compact(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

async function shareAppCard(title: string, summary: string, url: string) {
  // iOS places `url` beside the message. Putting it in both fields produces the
  // duplicated links seen in WhatsApp. Android only reliably shares URLs that
  // are part of `message`, so each platform receives the link exactly once.
  if (Platform.OS === "ios") {
    await Share.share({ title, message: summary, url });
    return;
  }
  await Share.share({ title, message: `${summary}\n\n${url}` });
}

function versionedShareUrl(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}share=${SHARE_PREVIEW_VERSION}`;
}

export async function shareHousingListing(post: HousingPost) {
  const url = versionedShareUrl(`${PUBLIC_SITE_URL}/accommodations?ad_id=${encodeURIComponent(post.id)}`);
  const place = compact(post.area || post.location, "FairFares");
  const title = compact(post.title, "FairFares housing listing");
  const facts = [place, post.rent, post.categoryLabel, post.moveIn].filter(Boolean).join(" · ");
  await shareAppCard(title, `Check out this housing listing on FairFares\n${facts}`, url);
}

export async function shareCarpoolListing(ride: RidePost) {
  const params = new URLSearchParams();
  params.set("rideId", ride.id);
  if (ride.city) params.set("city", ride.city);
  if (ride.origin) params.set("origin", ride.origin);
  if (ride.destination) params.set("destination", ride.destination);
  const url = versionedShareUrl(`${PUBLIC_SITE_URL}/carpool${params.toString() ? `?${params.toString()}` : ""}`);
  const route = `${compact(ride.origin, "Pickup area")} → ${compact(ride.destination, "Destination")}`;
  const timing = [ride.pickupDate, ride.pickupTime].filter(Boolean).join(" · ");
  const seats = Number(ride.seats || 1);
  await shareAppCard(
    `FairFares carpool: ${route}`,
    `Check out this carpool on FairFares\n${route}${timing ? `\n${timing}` : ""} · ${seats} seat${seats === 1 ? "" : "s"}`,
    url
  );
}

export async function shareChitthiGroup(community: Community, inviteUrl: string) {
  const memberLabel = community.memberCount > 0
    ? `${community.memberCount} member${community.memberCount === 1 ? "" : "s"}`
    : "FairFares community";
  const summary = compact(community.description || community.area, "Connect securely in Chitthi.");
  await shareAppCard(
    `Join ${community.name} on Chitthi`,
    `Join this Chitthi group on FairFares\n${community.name}\n${memberLabel} · ${summary}`,
    versionedShareUrl(inviteUrl)
  );
}
