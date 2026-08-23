import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Linking, Modal, Platform, RefreshControl, ScrollView, Share,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import {
  absoluteAssetUrl, acceptCommunityAnswer, answerCommunityPost, createCommunityPost, deleteCommunityPost,
  getChatCommunities, getCommunityFeed, getCommunityPost, getHousing, joinChatCommunity,
  reactToCommunityContent, reportCommunityContent, saveCommunityPost,
  updateCommunityPost, updateCommunityPostStatus,
} from "../api/client";
import { Community, CommunityPost, FairFaresUser, HousingPost } from "../types";
import { UserAvatar } from "../components/UserAvatar";
import { theme } from "../theme";
import { pickCompressedImages } from "../utils/imageUpload";
import { useResponsiveLayout } from "../utils/layout";

type Props = {
  user: FairFaresUser | null;
  city: string;
  onRequireLogin: () => void;
  onOpenHousing: () => void;
  onSearchHousing: () => void;
  onOpenRides: () => void;
  onOpenCommunity: (communityId: string) => void;
  onBottomTabsHiddenChange?: (hidden: boolean) => void;
  initialPostId?: string;
  onInitialPostOpened?: () => void;
};

const categories = ["ALL", "GENERAL", "NEED_ROOMMATE", "NEED_PLACE", "HAVE_PLACE", "CARPOOL_RIDE"] as const;
const popularTopics = [
  { value: "HOUSING", icon: "🏠", title: "Housing", subtitle: "Ask or share", color: "#d8edff" },
  { value: "RIDES", icon: "🚙", title: "Rides", subtitle: "Find or offer", color: "#d9ffe7" },
  { value: "GENERAL", icon: "💬", title: "General", subtitle: "Local questions", color: "#eee4ff" },
  { value: "PLACES", icon: "📍", title: "Places", subtitle: "Explore", color: "#ffeadb" },
] as const;
const types: Array<{ value: CommunityPost["type"]; label: string }> = [
  { value: "QUESTION", label: "Ask a question" }, { value: "REQUEST", label: "Request help" },
  { value: "RECOMMENDATION", label: "Recommend" }, { value: "UPDATE", label: "Share update" },
];
const categoryLabels: Record<string, string> = {
  ALL: "For you", GENERAL: "General", NEED_ROOMMATE: "Need a roommate", NEED_PLACE: "Need a place",
  HAVE_PLACE: "Have a place", CARPOOL_RIDE: "Carpool ride", HOUSING: "Housing", RIDES: "Rides",
  LOCAL: "Local", PLACES: "Places", STUDENT: "Students", SERVICES: "Services", SAFETY: "Safety",
};
const categoryIcons: Record<string, string> = { GENERAL: "💬", NEED_ROOMMATE: "👥", NEED_PLACE: "🔑", HAVE_PLACE: "🏠", CARPOOL_RIDE: "🚗" };
const reactionOptions = [
  { value: "LIKE", emoji: "👍", label: "Like" },
  { value: "LOVE", emoji: "❤️", label: "Love" },
  { value: "CARE", emoji: "🥰", label: "Care" },
  { value: "HAHA", emoji: "😄", label: "Haha" },
  { value: "WOW", emoji: "😮", label: "Wow" },
  { value: "SAD", emoji: "😢", label: "Sad" },
  { value: "ANGRY", emoji: "😡", label: "Angry" },
] as const;
const emptyDetails = { budget: "", moveInDate: "", preference: "", rent: "", availableDate: "", roomType: "", origin: "", destination: "", travelDate: "", travelTime: "", seats: "" };

function absoluteUrl(value: string) {
  return absoluteAssetUrl(value);
}

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Just now";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "FF"; }
function previewOrFallback<T>(promise: Promise<T>, fallback: T, timeoutMs = 2500) {
  return Promise.race([promise.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs))]);
}

function housingAsCommunityPost(post: HousingPost, city: string): CommunityPost {
  return {
    id: `FFH-${post.id}`,
    type: "REQUEST",
    title: post.title,
    body: post.description,
    category: post.mode === "HAVE_PLACE" ? "HAVE_PLACE" : "NEED_PLACE",
    city: post.location || city,
    area: post.area || "",
    linkUrl: "",
    images: post.images?.length ? post.images : post.imageUrl ? [post.imageUrl] : [],
    status: "PUBLISHED",
    fulfillmentStatus: "OPEN",
    expiresAt: "",
    details: { rent: post.rent, moveInDate: post.moveIn, roomType: post.categoryLabel, leaseTerm: post.leaseTerm },
    author: { id: Number(post.posterUserId || 0), name: post.posterName || "FairFares member", photoUrl: post.photoUrl || "" },
    community: null,
    answerCount: 0,
    reactionCount: 0,
    viewerReaction: "",
    reacted: false,
    saved: false,
    acceptedAnswerId: "",
    canEdit: false,
    canAnswer: false,
    createdAt: "",
    updatedAt: "",
    sourceKind: "HOUSING",
    sourceId: post.id,
  };
}

export function CommunityScreen({ user, city, onRequireLogin, onOpenHousing, onSearchHousing, onOpenRides, onOpenCommunity, onBottomTabsHiddenChange, initialPostId = "", onInitialPostOpened }: Props) {
  const layout = useResponsiveLayout();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [groups, setGroups] = useState<Community[]>([]);
  const [category, setCategory] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPostId, setEditingPostId] = useState("");
  const [detail, setDetail] = useState<CommunityPost | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [form, setForm] = useState({ type: "QUESTION" as CommunityPost["type"], category: "GENERAL" as CommunityPost["category"], title: "", body: "", area: "", linkUrl: "", communityId: "", images: [] as string[], details: { ...emptyDetails }, expiresInDays: 45 });
  const [publishing, setPublishing] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [expandedReactionTarget, setExpandedReactionTarget] = useState("");
  const groupLoadGeneration = useRef(0);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      // Communities can be noticeably slower than the feed in production.
      // Load them independently so a slow Chitthi request never freezes Ask.
      const requestedGroupGeneration = groupLoadGeneration.current + 1;
      groupLoadGeneration.current = requestedGroupGeneration;
      void previewOrFallback(getChatCommunities(city), [] as Community[], 10000)
        .then((communityRows) => {
          if (groupLoadGeneration.current !== requestedGroupGeneration) return;
          setGroups((communityRows || []).filter((group) => group.joined || group.visibility === "PUBLIC"));
        })
        .catch(() => undefined);
      const [feed, housingRows] = await Promise.all([
        previewOrFallback(getCommunityFeed({ q: appliedQuery, category: category === "ALL" ? "" : category, communityId: selectedGroup, limit: 30 }), { ok: true, posts: [] as CommunityPost[], pagination: { hasMore: false } }),
        category === "ALL" || category === "HOUSING"
          ? previewOrFallback(getHousing(city, "", "", "", "", "", "", {}, 0), [] as HousingPost[])
          : Promise.resolve([] as HousingPost[]),
      ]);
      const feedPosts = feed.posts || [];
      const fallbackHousing = (housingRows || []).filter((post) => !post.sample).map((post) => housingAsCommunityPost(post, city));
      setPosts(feedPosts.length ? feedPosts : fallbackHousing);
      setHasMore(Boolean(feed.pagination?.hasMore));
    } catch { setPosts([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [appliedQuery, category, city, selectedGroup, user?.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!initialPostId) return;
    setDetailBusy(true);
    void getCommunityPost(initialPostId).then((post) => {
      if (post) setDetail(post);
      else Alert.alert("Post unavailable", "This community post was removed or is no longer available.");
    }).catch((error) => Alert.alert("Post unavailable", message(error))).finally(() => {
      setDetailBusy(false);
      onInitialPostOpened?.();
    });
  }, [initialPostId, onInitialPostOpened]);
  useEffect(() => { onBottomTabsHiddenChange?.(composerOpen || Boolean(detail)); }, [composerOpen, detail, onBottomTabsHiddenChange]);

  const openComposer = () => {
    if (!user) { onRequireLogin(); return; }
    setEditingPostId("");
    setForm((current) => ({ ...current, area: current.area || city, communityId: selectedGroup }));
    setComposerOpen(true);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const feed = await getCommunityFeed({ q: appliedQuery, category: category === "ALL" ? "" : category, communityId: selectedGroup, offset: posts.length, limit: 30 });
      setPosts((current) => [...current, ...(feed.posts || []).filter((post) => !current.some((item) => item.id === post.id))]);
      setHasMore(Boolean(feed.pagination?.hasMore));
    } catch (error) { Alert.alert("Could not load more", message(error)); }
    finally { setLoadingMore(false); }
  };

  const openDetail = async (post: CommunityPost) => {
    setDetail(post); setDetailBusy(true);
    try { setDetail(await getCommunityPost(post.id)); }
    catch (error) { Alert.alert("Could not open post", message(error)); }
    finally { setDetailBusy(false); }
  };

  const mutatePost = (id: string, update: (post: CommunityPost) => CommunityPost) => {
    setPosts((current) => current.map((post) => post.id === id ? update(post) : post));
    setDetail((current) => current?.id === id ? update(current) : current);
  };

  const reactPost = async (post: CommunityPost, reaction: string) => {
    if (!user) { onRequireLogin(); return; }
    try {
      const result = await reactToCommunityContent({ postId: post.id }, reaction);
      mutatePost(post.id, (value) => ({ ...value, reacted: result.active, viewerReaction: result.reaction, reactionCount: result.count, reactionCounts: result.counts }));
    } catch (error) { Alert.alert("Reaction not saved", message(error)); }
  };

  const reactionPicker = (target: string, viewerReaction: string, count: number, onReact: (reaction: string) => void, iconOnly = false) => {
    const selected = reactionOptions.find((option) => option.value === viewerReaction);
    return <View style={styles.reactionControl}>
      {expandedReactionTarget === target ? <View style={styles.reactionTray}>{reactionOptions.map((option) => <TouchableOpacity key={option.value} style={styles.reactionChoice} onPress={(event) => { event.stopPropagation(); setExpandedReactionTarget(""); onReact(option.value); }} accessibilityLabel={`${option.label} reaction`}><Text style={styles.reactionChoiceEmoji}>{option.emoji}</Text></TouchableOpacity>)}</View> : null}
      <TouchableOpacity style={[styles.reactionSummary, iconOnly && styles.reactionSummaryIconOnly, selected && styles.reactionSummaryActive]} onPress={(event) => { event.stopPropagation(); setExpandedReactionTarget((current) => current === target ? "" : target); }} accessibilityLabel="Open reactions"><Text style={styles.reactionSummaryEmoji}>{selected?.emoji || "👍"}</Text>{!iconOnly ? <><Text style={[styles.reactionSummaryText, selected && styles.reactionSummaryTextActive]}>{selected?.label || "Like"}</Text>{count ? <Text style={styles.reactionTotal}>{count}</Text> : null}</> : null}</TouchableOpacity>
    </View>
  };

  const toggleSave = async (post: CommunityPost) => {
    if (!user) { onRequireLogin(); return; }
    try { const result = await saveCommunityPost(post.id); mutatePost(post.id, (value) => ({ ...value, saved: result.saved })); }
    catch (error) { Alert.alert("Post not saved", message(error)); }
  };

  const publish = async () => {
    if (!form.title.trim() || !form.body.trim()) { Alert.alert("Complete your post", "Add a clear title and helpful details."); return; }
    setPublishing(true);
    try {
      if (editingPostId) {
        await updateCommunityPost(editingPostId, { title: form.title.trim(), body: form.body.trim(), linkUrl: form.linkUrl.trim(), details: form.details });
        await load(true);
      } else {
        const result = await createCommunityPost({ ...form, city, title: form.title.trim(), body: form.body.trim(), area: form.area.trim(), linkUrl: form.linkUrl.trim() });
        setPosts((current) => [result.post, ...current]);
      }
      setForm({ type: "QUESTION", category: "GENERAL", title: "", body: "", area: "", linkUrl: "", communityId: "", images: [], details: { ...emptyDetails }, expiresInDays: 45 });
      setComposerOpen(false);
      Alert.alert(editingPostId ? "Post updated" : "Posted", editingPostId ? "Your changes are live." : "Your post is now live in Ask Community.");
      setEditingPostId("");
    } catch (error) { Alert.alert("Could not publish", message(error)); }
    finally { setPublishing(false); }
  };

  const submitAnswer = async () => {
    if (!detail || !answer.trim()) return;
    if (!user) { onRequireLogin(); return; }
    setDetailBusy(true);
    try { await answerCommunityPost(detail.id, answer.trim()); setAnswer(""); setDetail(await getCommunityPost(detail.id)); await load(true); }
    catch (error) { Alert.alert("Answer not posted", message(error)); }
    finally { setDetailBusy(false); }
  };

  const confirmDelete = (post: CommunityPost) => Alert.alert("Delete post?", "This removes the post from all community feeds.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { try { await deleteCommunityPost(post.id); setPosts((current) => current.filter((item) => item.id !== post.id)); setDetail(null); } catch (error) { Alert.alert("Could not delete", message(error)); } } },
  ]);

  const completedStatus = (post: CommunityPost): CommunityPost["fulfillmentStatus"] => post.category === "HAVE_PLACE" ? "FILLED" : post.category === "CARPOOL_RIDE" ? "ARRANGED" : post.category === "NEED_PLACE" || post.category === "NEED_ROOMMATE" ? "FOUND" : "RESOLVED";
  const managePost = (post: CommunityPost) => Alert.alert("Manage post", "Choose an action.", [
    { text: post.expiresAt && new Date(post.expiresAt).getTime() <= Date.now() ? "Renew for 45 days" : post.fulfillmentStatus === "OPEN" ? `Mark ${completedStatus(post).toLowerCase()}` : "Reopen post", onPress: async () => { try { const expired = Boolean(post.expiresAt && new Date(post.expiresAt).getTime() <= Date.now()); const status = expired || post.fulfillmentStatus !== "OPEN" ? "OPEN" : completedStatus(post); await updateCommunityPostStatus(post.id, status); mutatePost(post.id, (value) => ({ ...value, fulfillmentStatus: status, canAnswer: status === "OPEN", expiresAt: expired ? new Date(Date.now() + 45 * 86400000).toISOString() : value.expiresAt })); } catch (error) { Alert.alert("Status not changed", message(error)); } } },
    { text: "Edit", onPress: () => { setEditingPostId(post.id); setForm({ type: post.type, category: post.category, title: post.title, body: post.body, area: post.area, linkUrl: post.linkUrl, communityId: post.community?.id || "", images: [], details: { ...emptyDetails, ...post.details }, expiresInDays: 45 }); setDetail(null); setComposerOpen(true); } },
    { text: "Delete", style: "destructive", onPress: () => confirmDelete(post) },
    { text: "Cancel", style: "cancel" },
  ]);

  const report = (post: CommunityPost) => {
    if (!user) { onRequireLogin(); return; }
    const submitReport = (reason: string) => void reportCommunityContent({ postId: post.id }, reason)
      .then(() => Alert.alert("Report received", "Moderators will review this post."))
      .catch((error) => Alert.alert("Report not submitted", message(error)));
    Alert.alert("Report post", "Choose the closest reason.", [
    { text: "Spam", onPress: () => submitReport("SPAM") },
    { text: "Unsafe", onPress: () => submitReport("UNSAFE") },
    { text: "Cancel", style: "cancel" },
    ]);
  };

  const groupOptions = useMemo(() => groups.filter((group) => group.joined), [groups]);
  const housingCommunitySuggestions = useMemo(() => {
    return groups
      // Use the same city-aware public community source as Chitthi. Do not
      // apply a second location filter that can remove valid suggestions.
      .filter((group) => group.visibility === "PUBLIC")
      // Joined communities remain visible as direct Chitthi shortcuts. Put
      // them first so an Open action is never hidden behind join suggestions.
      .sort((left, right) => Number(right.joined) - Number(left.joined) || right.memberCount - left.memberCount);
  }, [groups]);
  const setDetailField = (key: keyof typeof emptyDetails, value: string) => setForm((current) => ({ ...current, details: { ...current.details, [key]: value } }));

  const joinSuggestedCommunity = async (group: Community) => {
    if (!user) { onRequireLogin(); return; }
    if (group.joined) { onOpenCommunity(group.id); return; }
    setGroupBusy(true);
    try {
      await joinChatCommunity(group.id, group.suggestionCity || city, group.suggestionPurpose || "COMMUNITY");
      setGroups((current) => current.map((item) => item.id === group.id
        ? { ...item, joined: true, memberCount: item.memberCount + 1 }
        : item));
      Alert.alert("Community joined", `You joined ${group.name}. You can open it anytime from Chitthi.`);
    } catch (error) {
      Alert.alert("Could not join", message(error));
    } finally {
      setGroupBusy(false);
    }
  };

  const renderHousingCommunitySuggestions = () => housingCommunitySuggestions.length ? (
    <View style={styles.inlineCommunities}>
      <View style={styles.inlineCommunityHead}><View><Text style={styles.inlineCommunityEyebrow}>NEAR {city.split(",", 1)[0].toUpperCase()}</Text><Text style={styles.inlineCommunityTitle}>Join communities</Text></View><View style={styles.inlineCommunitySwipe}><Text style={styles.inlineCommunitySwipeText}>Swipe</Text><Text style={styles.inlineCommunitySwipeArrow}>→</Text></View></View>
      <Text style={styles.inlineCommunityBody}>Connect with local members looking for places and roommates.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.inlineCommunityRail}>
        {housingCommunitySuggestions.map((group) => <View key={group.id} style={styles.inlineCommunityCard}><UserAvatar photoUrl={group.photoUrl} style={styles.inlineCommunityPhoto} imageStyle={styles.inlineCommunityPhotoImage} fallback={<Text style={styles.inlineCommunityPhotoGlyph}>🏘️</Text>} /><Text style={styles.inlineCommunityName} numberOfLines={2}>{group.name}</Text><Text style={styles.inlineCommunityMeta} numberOfLines={1}>{group.area || group.suggestionCity || city}</Text><Text style={styles.inlineCommunityMembers}>{group.memberCount} members</Text><TouchableOpacity style={[styles.inlineJoinButton, group.joined && styles.inlineJoinedButton]} disabled={groupBusy} onPress={() => void joinSuggestedCommunity(group)}><Text style={[styles.inlineJoinText, group.joined && styles.inlineJoinedText]}>{group.joined ? "Open" : "Join"}</Text></TouchableOpacity></View>)}
      </ScrollView>
    </View>
  ) : null;

  const housingCommunityInsertIndex = Math.min(3, posts.length - 1);

  const renderPost = (post: CommunityPost) => (
    <TouchableOpacity key={post.id} activeOpacity={0.92} style={styles.postCard} onPress={() => void openDetail(post)} accessibilityRole="button" accessibilityLabel={`${post.title}, ${post.answerCount} answers`}>
      <View style={styles.postHead}>
        <UserAvatar photoUrl={post.author.photoUrl} style={styles.avatar} imageStyle={styles.avatarImage} fallback={<Text style={styles.avatarInitials}>{initials(post.author.name)}</Text>} />
        <View style={styles.postAuthor}><Text style={styles.author}>{post.author.name}</Text><Text style={styles.meta}>{post.community?.name || [post.area, post.city].filter(Boolean).join(" · ") || "FairFares Community"} · {relativeTime(post.createdAt)}</Text></View>
        <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{post.sourceKind === "HOUSING" ? "🏠 HOUSING" : post.type === "QUESTION" ? "QUESTION" : post.type}</Text></View>
      </View>
      <Text style={styles.postTitle}>{post.title}</Text>
      {post.fulfillmentStatus !== "OPEN" ? <View style={styles.resolvedBadge}><Text style={styles.resolvedText}>✓ {post.fulfillmentStatus === "ARRANGED" ? "Ride arranged" : post.fulfillmentStatus.charAt(0) + post.fulfillmentStatus.slice(1).toLowerCase()}</Text></View> : null}
      <Text style={styles.postBody} numberOfLines={4}>{post.body}</Text>
      {Object.keys(post.details || {}).length ? <View style={styles.detailFacts}>{Object.entries(post.details).filter(([, value]) => value).slice(0, 6).map(([key, value]) => <View key={key} style={styles.fact}><Text style={styles.factLabel}>{key.replace(/([A-Z])/g, " $1")}</Text><Text style={styles.factValue}>{value}</Text></View>)}</View> : null}
      {post.images.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageRow}>{post.images.map((image, index) => <Image key={`${image}-${index}`} source={{ uri: absoluteUrl(image) }} style={styles.postImage} />)}</ScrollView> : null}
      {post.linkUrl ? <TouchableOpacity style={styles.linkCard} onPress={(event) => { event.stopPropagation(); void Linking.openURL(post.linkUrl); }}><Text style={styles.linkIcon}>↗</Text><View><Text style={styles.linkLabel}>Open shared link</Text><Text style={styles.linkUrl} numberOfLines={1}>{post.linkUrl}</Text></View></TouchableOpacity> : null}
      {post.reactionCount || post.answerCount ? <View style={styles.activitySummary}><View style={styles.reactionBreakdown}>{reactionOptions.map((option) => { const count = option.value === "LIKE" ? (post.reactionCounts?.LIKE || 0) + (post.reactionCounts?.HELPFUL || 0) : post.reactionCounts?.[option.value] || 0; return count ? <Text key={option.value} style={styles.activityText}>{count} {option.emoji} {option.label}</Text> : null; })}</View>{post.answerCount ? <Text style={styles.commentCount}>{post.answerCount} {post.answerCount === 1 ? "comment" : "comments"}</Text> : null}</View> : null}
      <View style={styles.postActions}>
        {reactionPicker(`post-${post.id}`, post.viewerReaction, post.reactionCount, (reaction) => void reactPost(post, reaction), true)}
        <TouchableOpacity style={styles.footerIconAction} onPress={() => void openDetail(post)} accessibilityLabel="Comment"><Text style={styles.footerIcon}>◯</Text></TouchableOpacity>
        <TouchableOpacity style={styles.footerIconAction} onPress={(event) => { event.stopPropagation(); void Share.share({ title: post.title, message: `${post.title}\nhttps://www.fairfare.space/community/${post.id}` }); }} accessibilityLabel="Share"><Text style={styles.footerShareIcon}>↗</Text></TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={[styles.content, { maxWidth: layout.contentMaxWidth, paddingBottom: layout.navClearance }]} refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.colors.brand} onRefresh={() => { setRefreshing(true); void load(true); }} />}>
      <View style={styles.hero}><View style={styles.heroGlow} /><Text style={styles.accentLeft}>′′′</Text><Text style={styles.accentRight}>′′</Text><View style={styles.heroTop}><View style={styles.heroMark}><View style={styles.askBadge}><View style={styles.askBadgeTail} /><Text style={styles.askBadgeText}>Ask</Text></View><View style={styles.chatBubbles}><Text style={styles.chatBubbleBlue}>•••</Text></View></View><View style={styles.heroCopy}><View style={styles.communityTag}><View style={styles.communityTagTail} /><View style={styles.communityTagStitch} /><Text style={styles.heroCommunity}>Community</Text><Text style={styles.communityTagDot}>●</Text></View></View></View><Text style={styles.subtitle}>Trusted local answers from people who <Text style={styles.subtitleAccent}>know your city.</Text></Text></View>
      <View style={styles.quickComposer}>
        <UserAvatar photoUrl={user?.profilePhotoUrl} style={styles.composerAvatar} imageStyle={styles.composerAvatarImage} />
        <TouchableOpacity style={styles.composerPrompt} onPress={openComposer} accessibilityRole="button" accessibilityLabel="Write a community post"><Text style={styles.composerPromptText}>Write something…</Text></TouchableOpacity>
        <TouchableOpacity style={styles.composerAsk} onPress={openComposer} accessibilityRole="button" accessibilityLabel="Ask community"><Text style={styles.composerAskText}>＋ Ask</Text></TouchableOpacity>
      </View>
      <View><View style={styles.sectionRow}><Text style={styles.sectionTitle}>Popular topics</Text>{category !== "ALL" ? <TouchableOpacity onPress={() => setCategory("ALL")}><Text style={styles.manageLink}>Show all</Text></TouchableOpacity> : null}</View><View style={styles.topicGrid}>{popularTopics.map((item) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.subtitle}`} key={item.value} style={[styles.topicCard, { width: "23.5%", backgroundColor: item.color }, category === item.value && styles.topicSelected]} onPress={() => { if (item.value === "RIDES") { onOpenRides(); return; } setSelectedGroup(""); setCategory(item.value); }}><Text style={styles.topicIcon}>{item.icon}</Text><Text style={styles.topicTitle}>{item.title}</Text><Text style={styles.topicSubtitle}>{item.subtitle}</Text></TouchableOpacity>)}</View></View>
      <View style={styles.feedControls}><View><Text style={styles.relevanceTitle}>Most relevant</Text><Text style={styles.relevanceSubtitle}>{category === "ALL" ? "Posts and listings near you" : categoryLabels[category]}</Text></View><TouchableOpacity style={styles.filterButton} onPress={() => { setQuery(""); setAppliedQuery(""); setSelectedGroup(""); setCategory("ALL"); }} accessibilityRole="button" accessibilityLabel="Reset feed filters"><Text style={styles.filterIcon}>☷</Text></TouchableOpacity></View>
      {category === "HOUSING" ? <TouchableOpacity style={styles.housingSearchAction} onPress={onSearchHousing} accessibilityRole="button" accessibilityLabel="Open housing search"><View style={styles.housingSearchIcon}><Text style={styles.housingSearchIconText}>⌕</Text></View><View style={styles.housingSearchCopy}><Text style={styles.housingSearchTitle}>Search housing</Text><Text style={styles.housingSearchBody}>Filter by city, area, distance, rent, and housing type</Text></View><Text style={styles.housingSearchArrow}>›</Text></TouchableOpacity> : null}
      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.brand} size="large" /> : <View style={styles.unifiedFeed}>
        {posts.map((post, index) => <React.Fragment key={post.id}>{renderPost(post)}{category === "HOUSING" && index === housingCommunityInsertIndex ? renderHousingCommunitySuggestions() : null}</React.Fragment>)}
        {category === "HOUSING" && posts.length === 0 ? renderHousingCommunitySuggestions() : null}
        {hasMore ? <TouchableOpacity style={styles.loadMore} disabled={loadingMore} onPress={() => void loadMore()}><Text style={styles.loadMoreText}>{loadingMore ? "Loading…" : "Load more conversations"}</Text></TouchableOpacity> : null}
        {(category === "HOUSING" || category === "ALL") ? <TouchableOpacity style={styles.addHousingCard} onPress={onOpenHousing}><View style={styles.addHousingIcon}><Text style={styles.addHousingPlus}>＋</Text></View><View style={styles.housingCopy}><Text style={styles.addHousingTitle}>Add a housing post</Text><Text style={styles.addHousingBody}>Need a roommate, need a place, or have a place to share?</Text></View><Text style={styles.housingArrow}>›</Text></TouchableOpacity> : null}
      </View>}
    </ScrollView>

    <Modal visible={composerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setComposerOpen(false)}>
      <View style={styles.modal}><View style={styles.modalHead}><TouchableOpacity onPress={() => { setComposerOpen(false); setEditingPostId(""); }}><Text style={styles.cancel}>Cancel</Text></TouchableOpacity><Text style={styles.modalTitle}>{editingPostId ? "Edit post" : "Create post"}</Text><TouchableOpacity disabled={publishing} onPress={() => void publish()}><Text style={[styles.publish, publishing && styles.disabled]}>{publishing ? "Saving…" : editingPostId ? "Save" : "Post"}</Text></TouchableOpacity></View><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.formLabel}>What are you sharing?</Text><View style={styles.optionGrid}>{types.map((item) => <TouchableOpacity key={item.value} style={[styles.option, form.type === item.value && styles.optionActive]} onPress={() => setForm((current) => ({ ...current, type: item.value }))}><Text style={[styles.optionText, form.type === item.value && styles.optionTextActive]}>{item.label}</Text></TouchableOpacity>)}</View>
        <Text style={styles.formLabel}>What do you need?</Text><View style={styles.needGrid}>{categories.slice(1).map((item) => <TouchableOpacity key={item} style={[styles.needOption, form.category === item && styles.optionActive]} onPress={() => setForm((current) => ({ ...current, category: item as CommunityPost["category"] }))}><Text style={styles.needIcon}>{categoryIcons[item]}</Text><Text style={[styles.needText, form.category === item && styles.optionTextActive]}>{categoryLabels[item]}</Text></TouchableOpacity>)}</View>
        {(form.category === "NEED_ROOMMATE" || form.category === "NEED_PLACE") ? <><Text style={styles.formLabel}>Housing details</Text><TextInput style={styles.input} value={form.details.budget} onChangeText={(value) => setDetailField("budget", value)} placeholder="Monthly budget, for example $900" placeholderTextColor={theme.colors.muted} /><TextInput style={styles.input} value={form.details.moveInDate} onChangeText={(value) => setDetailField("moveInDate", value)} placeholder="Move-in date" placeholderTextColor={theme.colors.muted} /><TextInput style={styles.input} value={form.details.preference} onChangeText={(value) => setDetailField("preference", value)} placeholder="Roommate or home preferences" placeholderTextColor={theme.colors.muted} /></> : null}
        {form.category === "HAVE_PLACE" ? <><Text style={styles.formLabel}>Place details</Text><TextInput style={styles.input} value={form.details.rent} onChangeText={(value) => setDetailField("rent", value)} placeholder="Monthly rent" placeholderTextColor={theme.colors.muted} /><TextInput style={styles.input} value={form.details.availableDate} onChangeText={(value) => setDetailField("availableDate", value)} placeholder="Available date" placeholderTextColor={theme.colors.muted} /><TextInput style={styles.input} value={form.details.roomType} onChangeText={(value) => setDetailField("roomType", value)} placeholder="Private room, shared room, entire place…" placeholderTextColor={theme.colors.muted} /></> : null}
        {form.category === "CARPOOL_RIDE" ? <><Text style={styles.formLabel}>Ride details</Text><TextInput style={styles.input} value={form.details.origin} onChangeText={(value) => setDetailField("origin", value)} placeholder="Leaving from" placeholderTextColor={theme.colors.muted} /><TextInput style={styles.input} value={form.details.destination} onChangeText={(value) => setDetailField("destination", value)} placeholder="Going to" placeholderTextColor={theme.colors.muted} /><View style={styles.inlineFields}><TextInput style={[styles.input, styles.inlineInput]} value={form.details.travelDate} onChangeText={(value) => setDetailField("travelDate", value)} placeholder="Date" placeholderTextColor={theme.colors.muted} /><TextInput style={[styles.input, styles.inlineInput]} value={form.details.travelTime} onChangeText={(value) => setDetailField("travelTime", value)} placeholder="Time" placeholderTextColor={theme.colors.muted} /><TextInput style={[styles.input, { width: 78 }]} value={form.details.seats} onChangeText={(value) => setDetailField("seats", value.replace(/\D/g, "").slice(0, 2))} keyboardType="number-pad" placeholder="Seats" placeholderTextColor={theme.colors.muted} /></View></> : null}
        <TextInput style={styles.titleInput} value={form.title} onChangeText={(title) => setForm((current) => ({ ...current, title }))} maxLength={140} placeholder="Write a clear title" placeholderTextColor={theme.colors.muted} />
        <TextInput style={styles.bodyInput} value={form.body} onChangeText={(body) => setForm((current) => ({ ...current, body }))} multiline maxLength={3000} textAlignVertical="top" placeholder="Add details that will help people give a useful answer…" placeholderTextColor={theme.colors.muted} />
        <View style={styles.counter}><Text style={styles.counterText}>{form.body.length}/3000</Text></View>
        <TextInput style={styles.input} value={form.area} onChangeText={(area) => setForm((current) => ({ ...current, area }))} placeholder={`Location or area · ${city}`} placeholderTextColor={theme.colors.muted} />
        <TextInput style={styles.input} value={form.linkUrl} onChangeText={(linkUrl) => setForm((current) => ({ ...current, linkUrl }))} autoCapitalize="none" keyboardType="url" placeholder="Helpful link (optional)" placeholderTextColor={theme.colors.muted} />
        {groupOptions.length ? <><Text style={styles.formLabel}>Audience</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}><TouchableOpacity style={[styles.chip, !form.communityId && styles.chipActive]} onPress={() => setForm((current) => ({ ...current, communityId: "" }))}><Text style={[styles.chipText, !form.communityId && styles.chipTextActive]}>Everyone</Text></TouchableOpacity>{groupOptions.map((group) => <TouchableOpacity key={group.id} style={[styles.chip, form.communityId === group.id && styles.chipActive]} onPress={() => setForm((current) => ({ ...current, communityId: group.id }))}><Text style={[styles.chipText, form.communityId === group.id && styles.chipTextActive]}>{group.name}</Text></TouchableOpacity>)}</ScrollView></> : null}
        {form.images.length ? <ScrollView horizontal contentContainerStyle={styles.imageRow}>{form.images.map((image, index) => <TouchableOpacity key={index} onPress={() => setForm((current) => ({ ...current, images: current.images.filter((_, target) => target !== index) }))}><Image source={{ uri: image }} style={styles.previewImage} /><View style={styles.removeImage}><Text style={styles.removeImageText}>×</Text></View></TouchableOpacity>)}</ScrollView> : null}
        <TouchableOpacity style={styles.addPhoto} onPress={async () => { try { const images = await pickCompressedImages(4 - form.images.length); setForm((current) => ({ ...current, images: [...current.images, ...images].slice(0, 4) })); } catch (error) { Alert.alert("Photos not added", message(error)); } }}><Text style={styles.addPhotoIcon}>▣</Text><View><Text style={styles.addPhotoTitle}>Add photos</Text><Text style={styles.addPhotoBody}>Up to 4 clear, relevant images</Text></View></TouchableOpacity>
        <Text style={styles.safety}>Keep personal phone numbers, exact home addresses, and sensitive documents out of public posts.</Text>
      </ScrollView></View>
    </Modal>

    <Modal visible={Boolean(detail)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetail(null)}>
      <View style={styles.modal}><View style={styles.modalHead}><TouchableOpacity onPress={() => setDetail(null)}><Text style={styles.cancel}>Close</Text></TouchableOpacity><Text style={styles.modalTitle}>Community post</Text><TouchableOpacity onPress={() => detail && (detail.canEdit ? managePost(detail) : report(detail))}><Text style={detail?.canEdit ? styles.publish : styles.danger}>{detail?.canEdit ? "Manage" : "Report"}</Text></TouchableOpacity></View>
      <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">{detail ? <>
        {renderPost(detail)}
        <Text style={styles.answersTitle}>{detail.answerCount} {detail.answerCount === 1 ? "comment" : "comments"}</Text>
        {detail.answers?.map((item) => <View key={item.id} style={[styles.answerCard, item.accepted && styles.acceptedCard]}><View style={styles.postHead}><UserAvatar photoUrl={item.author.photoUrl} style={styles.answerAvatar} imageStyle={styles.avatarImage} /><View style={styles.postAuthor}><Text style={styles.author}>{item.author.name}</Text><Text style={styles.meta}>{relativeTime(item.createdAt)}</Text></View>{item.accepted ? <Text style={styles.accepted}>✓ Accepted</Text> : null}</View><Text style={styles.answerBody}>{item.body}</Text><View style={styles.answerActions}>{reactionPicker(`answer-${item.id}`, item.viewerReaction, item.reactionCount, async (reaction) => { if (!user) return onRequireLogin(); const result = await reactToCommunityContent({ answerId: item.id }, reaction); setDetail((current) => current ? { ...current, answers: current.answers?.map((answerItem) => answerItem.id === item.id ? { ...answerItem, reactionCount: result.count, viewerReaction: result.reaction } : answerItem) } : current); })}{detail.canEdit && detail.type === "QUESTION" && !item.accepted ? <TouchableOpacity onPress={async () => { await acceptCommunityAnswer(detail.id, item.id); setDetail(await getCommunityPost(detail.id)); }}><Text style={styles.acceptAction}>Accept answer</Text></TouchableOpacity> : null}</View></View>)}
        {detail.canAnswer && user ? <View style={styles.answerComposer}><TextInput style={styles.answerInput} value={answer} onChangeText={setAnswer} multiline placeholder="Write a comment…" placeholderTextColor={theme.colors.muted} /><TouchableOpacity style={[styles.sendAnswer, !answer.trim() && styles.disabled]} disabled={!answer.trim() || detailBusy} onPress={() => void submitAnswer()}><Text style={styles.sendAnswerText}>{detailBusy ? "…" : "Post comment"}</Text></TouchableOpacity></View> : detail.canAnswer ? <TouchableOpacity style={styles.signInAnswer} onPress={onRequireLogin}><Text style={styles.signInAnswerTitle}>Sign in to comment</Text><Text style={styles.signInAnswerBody}>Join the conversation with your FairFares account.</Text></TouchableOpacity> : <Text style={styles.locked}>This discussion is closed to new comments.</Text>}
      </> : null}{detailBusy && !detail?.answers ? <ActivityIndicator color={theme.colors.brand} /> : null}</ScrollView></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  unifiedFeed: { gap: 3 }, housingSection: { gap: 3 }, housingPostCard: { backgroundColor: theme.colors.panel, borderTopColor: theme.colors.line, borderBottomColor: theme.colors.line, borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 13, paddingVertical: 16, gap: 12 }, housingPostBadge: { maxWidth: 128, backgroundColor: "#173a2d", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 }, housingPostBadgeText: { color: "#8ee4bf", fontWeight: "900", fontSize: 9, textTransform: "uppercase" }, housingPostImage: { width: 280, height: 190, borderRadius: 5, backgroundColor: theme.colors.panel2 }, housingPostPhotoFallback: { height: 126, borderRadius: 5, alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#122d24", borderWidth: 1, borderColor: "#244c3d" }, housingPostPhotoIcon: { fontSize: 35 }, housingPostPhotoCopy: { color: "#9dd9c2", fontWeight: "800", fontSize: 12 }, housingFacts: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, housingFact: { maxWidth: "48%", minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, backgroundColor: theme.colors.panel2, paddingHorizontal: 10 }, housingFactIcon: { fontSize: 12 }, housingFactText: { flexShrink: 1, color: theme.colors.soft, fontWeight: "700", fontSize: 11 }, housingPostActions: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 11 }, housingDetailsButton: { minHeight: 37, justifyContent: "center", borderRadius: 8, backgroundColor: theme.colors.brand, paddingHorizontal: 15 }, housingDetailsButtonText: { color: "#06291e", fontWeight: "900", fontSize: 12 }, housingShareButton: { minHeight: 37, justifyContent: "center", borderRadius: 8, backgroundColor: theme.colors.panel2, paddingHorizontal: 13 }, housingShareButtonText: { color: theme.colors.soft, fontWeight: "800", fontSize: 12 }, housingExpiry: { marginLeft: "auto", color: theme.colors.muted, fontSize: 10, fontWeight: "700" }, housingCopy: { flex: 1 }, housingArrow: { color: theme.colors.muted, fontSize: 28, fontWeight: "300" }, addHousingCard: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11, padding: 11, marginTop: 8, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.brand, backgroundColor: "rgba(24,168,120,.08)" }, addHousingIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.brand }, addHousingPlus: { color: "#06291e", fontSize: 25, fontWeight: "700" }, addHousingTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "900" }, addHousingBody: { color: theme.colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  heroGlow: { position: "absolute", right: -40, bottom: -70, width: 260, height: 150, borderRadius: 130, backgroundColor: "rgba(16,108,87,.18)" }, accentLeft: { position: "absolute", left: 25, top: 19, color: "#ffad24", fontSize: 25, fontWeight: "900", transform: [{ rotate: "-25deg" }] }, accentRight: { position: "absolute", right: 87, top: 17, color: "#18a681", fontSize: 21, fontWeight: "900", transform: [{ rotate: "20deg" }] }, askBadgeTail: { position: "absolute", left: 9, bottom: -7, width: 18, height: 18, backgroundColor: "#ef3e42", transform: [{ rotate: "25deg" }] }, communityTagStitch: { position: "absolute", top: 4, bottom: 4, left: 5, right: 5, borderWidth: 1, borderStyle: "dashed", borderColor: "#ed9d38", borderRadius: 7 }, subtitleAccent: { color: theme.colors.brand, fontWeight: "900" },
  resolvedBadge: { alignSelf: "flex-start", borderRadius: 999, backgroundColor: "#173b2d", paddingHorizontal: 11, paddingVertical: 6 }, resolvedText: { color: "#8ce6bf", fontWeight: "800", fontSize: 12 }, detailFacts: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, fact: { minWidth: "30%", flexGrow: 1, borderRadius: 12, backgroundColor: theme.colors.panel2, padding: 10 }, factLabel: { color: theme.colors.muted, fontSize: 9, textTransform: "uppercase" }, factValue: { color: theme.colors.text, fontWeight: "800", fontSize: 12, marginTop: 3 }, inlineFields: { flexDirection: "row", gap: 8 }, inlineInput: { flex: 1 },
  screen: { flex: 1, backgroundColor: theme.colors.bg }, content: { width: "100%", alignSelf: "center", padding: 12, gap: 12 },
  quickComposer: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 9, padding: 8, backgroundColor: theme.colors.panel, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.line }, composerAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.colors.panel2 }, composerAvatarImage: { borderRadius: 21 }, composerPrompt: { flex: 1, minHeight: 42, justifyContent: "center", paddingHorizontal: 15, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel2 }, composerPromptText: { color: theme.colors.muted, fontSize: 14 }, composerAsk: { minHeight: 42, justifyContent: "center", borderRadius: 10, backgroundColor: theme.colors.brand, paddingHorizontal: 12 }, composerAskText: { color: "#06291e", fontSize: 13, fontWeight: "900" }, feedControls: { minHeight: 66, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.colors.line }, relevanceTitle: { color: theme.colors.text, fontSize: 21, fontWeight: "900" }, relevanceSubtitle: { color: theme.colors.muted, fontSize: 11, marginTop: 3 }, filterButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: theme.colors.panel }, filterIcon: { color: theme.colors.soft, fontSize: 23, transform: [{ rotate: "90deg" }] },
  housingSearchAction: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: "#2c6b55", backgroundColor: "#10291f" }, housingSearchIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.brand }, housingSearchIconText: { color: "#06291e", fontSize: 28, lineHeight: 31, fontWeight: "800" }, housingSearchCopy: { flex: 1 }, housingSearchTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "900" }, housingSearchBody: { color: theme.colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 }, housingSearchArrow: { color: theme.colors.brand, fontSize: 30, fontWeight: "300" },
  inlineCommunities: { marginVertical: 8, paddingVertical: 12, gap: 7, borderRadius: 15, borderWidth: 1, borderColor: "#383838", backgroundColor: "#181818", overflow: "hidden" }, inlineCommunityHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 }, inlineCommunityEyebrow: { color: theme.colors.brand, fontSize: 8, fontWeight: "900", letterSpacing: .7 }, inlineCommunityTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "900", marginTop: 2 }, inlineCommunitySwipe: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, minHeight: 28, borderRadius: 999, backgroundColor: "#292929" }, inlineCommunitySwipeText: { color: theme.colors.muted, fontSize: 9, fontWeight: "800" }, inlineCommunitySwipeArrow: { color: theme.colors.brand, fontSize: 18, fontWeight: "900", marginTop: -1 }, inlineCommunityBody: { color: theme.colors.muted, fontSize: 10, lineHeight: 14, paddingHorizontal: 12 }, inlineCommunityRail: { paddingHorizontal: 12, gap: 8 }, inlineCommunityCard: { width: 124, minHeight: 153, padding: 9, borderRadius: 13, borderWidth: 1, borderColor: "#3a3a3a", backgroundColor: "#202020", alignItems: "center" }, inlineCommunityPhoto: { width: 46, height: 46, borderRadius: 23, marginBottom: 6, backgroundColor: "#2b2b2b" }, inlineCommunityPhotoImage: { borderRadius: 23 }, inlineCommunityPhotoGlyph: { fontSize: 22 }, inlineCommunityName: { color: theme.colors.text, fontSize: 11, lineHeight: 13, fontWeight: "900", minHeight: 26, textAlign: "center" }, inlineCommunityMeta: { color: theme.colors.muted, fontSize: 8, marginTop: 2, maxWidth: "100%" }, inlineCommunityMembers: { color: "#a8b5af", fontSize: 8, fontWeight: "700", marginTop: 2, marginBottom: 6 }, inlineJoinButton: { width: "100%", minHeight: 28, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: theme.colors.brand, paddingHorizontal: 10 }, inlineJoinedButton: { borderWidth: 1, borderColor: "#505050", backgroundColor: "#292929" }, inlineJoinText: { color: "#06291e", fontSize: 10, fontWeight: "900" }, inlineJoinedText: { color: "#e8e8e8" },
  hero: { minHeight: 136, gap: 11, padding: 16, paddingTop: 23, backgroundColor: "#071e1b", borderWidth: 1, borderColor: "#17604e", borderRadius: 28, overflow: "hidden" }, heroTop: { width: "100%", flexDirection: "row", alignItems: "center", gap: 12 }, heroMark: { width: 92, height: 70, justifyContent: "center" }, askBadge: { width: 82, height: 55, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: "#ef3e42", transform: [{ rotate: "-5deg" }], shadowColor: "#000", shadowOpacity: .25, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } }, askBadgeText: { color: "#fff", fontSize: 29, fontStyle: "italic", fontWeight: "900" }, chatBubbles: { position: "absolute", right: 0, top: -5 }, chatBubbleBlue: { color: "#e8fff7", backgroundColor: "#16a878", borderRadius: 14, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, fontSize: 9 }, chatBubbleGold: { alignSelf: "flex-end", marginTop: -1, color: "#fff7d1", backgroundColor: "#f0a800", borderRadius: 9, overflow: "hidden", paddingHorizontal: 5, fontSize: 7 }, heroCopy: { flex: 1 }, communityTag: { alignSelf: "flex-start", minWidth: 150, height: 43, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 13, backgroundColor: "#fff5cf", borderWidth: 2, borderColor: "#e9aa20", borderRadius: 10, transform: [{ rotate: "-2deg" }], shadowColor: "#000", shadowOpacity: .22, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }, communityTagTail: { position: "absolute", left: -5, bottom: -4, width: 12, height: 12, backgroundColor: "#fff5cf", borderLeftWidth: 2, borderBottomWidth: 2, borderColor: "#e9aa20", transform: [{ rotate: "-20deg" }] }, communityTagDot: { position: "absolute", right: 6, color: "#e9aa20", fontSize: 7 }, heroCommunity: { color: "#082b62", fontSize: 24, lineHeight: 30, fontFamily: Platform.select({ ios: "Bradley Hand", android: "cursive", default: "serif" }), fontWeight: "700", letterSpacing: -0.4 }, eyebrow: { ...theme.typography.eyebrow, color: "#72d9ae" }, title: { color: "#fff", fontSize: 31, lineHeight: 36, fontWeight: "800" }, subtitle: { width: "100%", color: "#f2faf7", fontSize: 14, lineHeight: 20, marginTop: 2, paddingHorizontal: 4 }, askButton: { backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 14, minHeight: 38, justifyContent: "center" }, askButtonText: { color: "#06291e", fontWeight: "800", fontSize: 14 },
  topicGrid: { flexDirection: "row", justifyContent: "space-between", gap: 6, paddingTop: 8 }, topicCard: { minHeight: 88, borderRadius: 16, padding: 7, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,.45)" }, topicSelected: { borderColor: theme.colors.brand, transform: [{ scale: 0.98 }] }, topicIcon: { fontSize: 24, marginBottom: 4 }, topicTitle: { color: "#11181b", fontWeight: "900", fontSize: 12 }, topicSubtitle: { color: "#627078", fontSize: 9, marginTop: 2, textAlign: "center" }, tipCard: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 13, borderRadius: 22, paddingHorizontal: 17, backgroundColor: "#0d4038", borderWidth: 1, borderColor: "#25685b" }, tipIcon: { fontSize: 25 }, tipTitle: { color: "#fff", fontWeight: "900", fontSize: 16 }, tipBody: { color: "#a9cfc5", fontSize: 12, lineHeight: 18, marginTop: 3 }, tipArrow: { color: "#fff", fontSize: 38, fontWeight: "300" },
  needGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, needOption: { width: "48%", minHeight: 76, flexDirection: "row", alignItems: "center", gap: 9, padding: 12, borderRadius: 15, borderWidth: 1, borderColor: theme.colors.line, backgroundColor: theme.colors.panel }, needIcon: { fontSize: 22 }, needText: { flex: 1, color: theme.colors.soft, fontWeight: "800", fontSize: 13 },
  searchRow: { flexDirection: "row", gap: 8 }, searchInput: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 15, backgroundColor: theme.colors.panel, color: theme.colors.text, paddingHorizontal: 14 }, searchButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderRadius: 15, backgroundColor: theme.colors.brand }, searchButtonText: { color: "#06291e", fontWeight: "800" },
  chips: { gap: 8, paddingRight: 12 }, chip: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: 999, paddingHorizontal: 14, minHeight: 38, justifyContent: "center", marginRight: 8, backgroundColor: theme.colors.panel }, chipActive: { backgroundColor: "#d8fff0", borderColor: "#d8fff0" }, chipText: { color: theme.colors.soft, fontWeight: "700", fontSize: 13 }, chipTextActive: { color: "#093525" }, sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, sectionTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800" }, manageLink: { color: theme.colors.brand, fontWeight: "800", fontSize: 13 }, groups: { gap: 7, paddingTop: 7, paddingRight: 8 }, groupCard: { width: 96, minHeight: 78, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 14, padding: 9, gap: 3 }, groupActive: { borderColor: theme.colors.brand, backgroundColor: "#14271f" }, groupEmoji: { fontSize: 20 }, groupPhoto: { width: 24, height: 24, borderRadius: 8 }, groupName: { color: theme.colors.text, fontWeight: "800", fontSize: 11 }, groupCount: { color: theme.colors.muted, fontSize: 9 }, feedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }, feedHint: { color: theme.colors.muted, fontSize: 11 }, loader: { marginVertical: 50 },
  postCard: { backgroundColor: theme.colors.panel, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 15, gap: 12, shadowColor: "#000", shadowOpacity: .14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }, postHead: { flexDirection: "row", alignItems: "center", gap: 10 }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#204538" }, avatarImage: { borderRadius: 22 }, avatarInitials: { color: "#a8ecd1", fontSize: 14, fontWeight: "900" }, postAuthor: { flex: 1, minWidth: 0 }, author: { color: theme.colors.text, fontWeight: "900", fontSize: 15 }, meta: { color: theme.colors.muted, fontSize: 11, marginTop: 2 }, typeBadge: { backgroundColor: "#153a2c", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 }, typeBadgeText: { color: "#78dcb4", fontWeight: "800", fontSize: 9, letterSpacing: .4 }, postTitle: { color: theme.colors.text, fontSize: 19, lineHeight: 25, fontWeight: "800" }, postBody: { color: theme.colors.soft, fontSize: 14, lineHeight: 21 }, imageRow: { gap: 5 }, postImage: { width: 255, height: 175, borderRadius: 12, backgroundColor: theme.colors.panel2 }, linkCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#315945", backgroundColor: "#10291f", borderRadius: 12, padding: 12 }, linkIcon: { color: theme.colors.brand, fontSize: 23 }, linkLabel: { color: theme.colors.text, fontWeight: "800", fontSize: 13 }, linkUrl: { color: "#85caae", fontSize: 11, maxWidth: 250 }, latestComment: { flexDirection: "row", alignItems: "flex-start", gap: 9 }, latestCommentAvatar: { width: 31, height: 31, borderRadius: 16, backgroundColor: "#204538" }, latestCommentInitials: { color: "#a8ecd1", fontSize: 9, fontWeight: "900" }, latestCommentBubble: { flex: 1, minHeight: 46, borderRadius: 13, backgroundColor: theme.colors.panel2, paddingHorizontal: 11, paddingVertical: 8 }, latestCommentAuthor: { color: theme.colors.text, fontSize: 11, fontWeight: "900" }, latestCommentBody: { color: theme.colors.soft, fontSize: 12, lineHeight: 17, marginTop: 2 }, addCommentPrompt: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.line }, addCommentIcon: { color: theme.colors.brand, fontSize: 15 }, addCommentText: { color: theme.colors.muted, fontSize: 12, fontWeight: "700" }, postActions: { position: "relative", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 10, overflow: "visible" }, reactionControl: { position: "relative", zIndex: 30 }, reactionTray: { position: "absolute", left: 0, bottom: 40, height: 50, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 7, borderRadius: 25, borderWidth: 1, borderColor: "#dedede", backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: .24, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 12, zIndex: 50 }, reactionChoice: { width: 37, height: 42, alignItems: "center", justifyContent: "center" }, reactionChoiceEmoji: { fontSize: 24 }, reactionSummary: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 9 }, reactionSummaryActive: { backgroundColor: "#173b2d" }, reactionSummaryEmoji: { fontSize: 16 }, reactionSummaryText: { color: theme.colors.soft, fontSize: 11, fontWeight: "800" }, reactionSummaryTextActive: { color: theme.colors.brand }, reactionTotal: { color: theme.colors.muted, fontSize: 10, fontWeight: "800" }, action: { backgroundColor: "transparent", borderRadius: 9, paddingHorizontal: 7, minHeight: 36, justifyContent: "center" }, iconAction: { width: 34, height: 34, borderRadius: 9, justifyContent: "center", alignItems: "center", backgroundColor: "transparent" }, actionActive: { backgroundColor: "#174c38" }, actionText: { color: theme.colors.soft, fontSize: 11, fontWeight: "700" },
  activitySummary: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 8 }, reactionBreakdown: { flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }, activityText: { color: theme.colors.soft, fontSize: 10, fontWeight: "700" }, commentCount: { color: theme.colors.muted, fontSize: 10, fontWeight: "700" }, footerIconAction: { width: 42, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" }, footerIcon: { color: theme.colors.soft, fontSize: 23, lineHeight: 25 }, footerShareIcon: { color: theme.colors.soft, fontSize: 22, fontWeight: "500", transform: [{ rotate: "-12deg" }] },
  reactionSummaryIconOnly: { width: 42, paddingHorizontal: 0, justifyContent: "center" },
  empty: { alignItems: "center", backgroundColor: theme.colors.panel, borderRadius: 22, borderWidth: 1, borderColor: theme.colors.line, padding: 30, gap: 8 }, emptyIcon: { fontSize: 36 }, emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "800" }, emptyBody: { color: theme.colors.muted, textAlign: "center", lineHeight: 20 }, emptyButton: { marginTop: 8, backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 }, emptyButtonText: { color: "#06291e", fontWeight: "800" },
  loadMore: { alignSelf: "center", borderWidth: 1, borderColor: "#315945", backgroundColor: "#10291f", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 }, loadMoreText: { color: "#9be8c7", fontWeight: "800" },
  modal: { flex: 1, backgroundColor: theme.colors.bg }, modalHead: { minHeight: 62, borderBottomWidth: 1, borderBottomColor: theme.colors.line, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, cancel: { color: theme.colors.soft, fontSize: 15 }, modalTitle: { color: theme.colors.text, fontWeight: "800", fontSize: 16 }, publish: { color: theme.colors.brand, fontWeight: "800", fontSize: 15 }, danger: { color: theme.colors.accent, fontWeight: "800" }, disabled: { opacity: .45 }, form: { padding: 18, gap: 15, paddingBottom: 40 }, formLabel: { color: theme.colors.soft, fontWeight: "800", fontSize: 12, textTransform: "uppercase", letterSpacing: .5 }, optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, option: { width: "48%", backgroundColor: theme.colors.panel, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 14, padding: 13 }, optionActive: { backgroundColor: "#173b2d", borderColor: theme.colors.brand }, optionText: { color: theme.colors.soft, fontWeight: "700" }, optionTextActive: { color: "#a9f2d2" }, titleInput: { color: theme.colors.text, fontSize: 22, fontWeight: "800", borderBottomWidth: 1, borderBottomColor: theme.colors.line, paddingVertical: 13 }, bodyInput: { minHeight: 150, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 18, padding: 15, color: theme.colors.text, fontSize: 15, lineHeight: 22 }, input: { minHeight: 50, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 15, paddingHorizontal: 14, color: theme.colors.text }, counter: { alignItems: "flex-end", marginTop: -10 }, counterText: { color: theme.colors.muted, fontSize: 11 }, previewImage: { width: 105, height: 105, borderRadius: 15 }, removeImage: { position: "absolute", right: 5, top: 5, width: 25, height: 25, borderRadius: 13, backgroundColor: "rgba(0,0,0,.75)", alignItems: "center", justifyContent: "center" }, removeImageText: { color: "#fff", fontSize: 18 }, addPhoto: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "#3f6554", borderRadius: 16, padding: 15 }, addPhotoIcon: { color: theme.colors.brand, fontSize: 24 }, addPhotoTitle: { color: theme.colors.text, fontWeight: "800" }, addPhotoBody: { color: theme.colors.muted, fontSize: 12, marginTop: 2 }, safety: { color: theme.colors.muted, fontSize: 12, lineHeight: 18, backgroundColor: "#211f17", borderRadius: 14, padding: 13 },
  detailContent: { padding: 14, gap: 14, paddingBottom: 45 }, answersTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "800", marginTop: 6 }, answerCard: { backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 18, padding: 15, gap: 11 }, acceptedCard: { borderColor: theme.colors.brand, backgroundColor: "#11271e" }, answerAvatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: theme.colors.panel2 }, accepted: { color: "#7ee2b8", fontSize: 12, fontWeight: "800" }, answerBody: { color: theme.colors.soft, lineHeight: 21 }, answerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, answerAction: { color: theme.colors.muted, fontWeight: "700", fontSize: 12 }, acceptAction: { color: theme.colors.brand, fontWeight: "800", fontSize: 12 }, answerComposer: { backgroundColor: theme.colors.panel, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.line, padding: 12, gap: 10 }, answerInput: { minHeight: 75, color: theme.colors.text, fontSize: 14, textAlignVertical: "top" }, sendAnswer: { alignSelf: "flex-end", backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10 }, sendAnswerText: { color: "#06291e", fontWeight: "800" }, locked: { color: theme.colors.muted, textAlign: "center", padding: 18 },
  signInAnswer: { backgroundColor: "#10291f", borderWidth: 1, borderColor: "#315945", borderRadius: 18, padding: 18, alignItems: "center", gap: 4 }, signInAnswerTitle: { color: "#9be8c7", fontSize: 16, fontWeight: "800" }, signInAnswerBody: { color: theme.colors.muted, fontSize: 12, textAlign: "center" },
  groupCreate: { backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 20, padding: 15, gap: 12 }, discoverGroup: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 16, padding: 14 }, joined: { color: theme.colors.brand, fontWeight: "800", fontSize: 12 }, joinButton: { backgroundColor: theme.colors.brand, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9 }, joinButtonText: { color: "#06291e", fontWeight: "800" },
});
