import { HousingPost } from "../types";

/**
 * Give the recipient a useful first message based on what their post asks
 * for. A place offer is an availability enquiry; a housing or roommate
 * request needs an offer to connect instead.
 */
export function suggestedHousingMessage(post: HousingPost): string {
  if (post.roommateIntent) {
    return "Hi, I am looking for a roommate too. Would you like to talk about sharing a place?";
  }
  if (post.mode === "NEED_PLACE") {
    return "Hi, I have a place that may suit you. Would you like to talk about it?";
  }
  const title = post.title.trim().replace(/[.!?]+$/, "");
  return `Hi, I am interested in ${title || "your place"}. Is it still available?`;
}

export function housingMessageRecipientLabel(post: HousingPost): string {
  return post.mode === "NEED_PLACE" || post.roommateIntent ? "member" : "lister";
}
