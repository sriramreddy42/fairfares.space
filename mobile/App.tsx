import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { BottomTabs, TabKey } from "./src/components/BottomTabs";
import { getBootstrap, getHousing, mobileLogin } from "./src/api/client";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { HousingScreen } from "./src/screens/HousingScreen";
import { MessengerScreen } from "./src/screens/MessengerScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { ServicesScreen } from "./src/screens/ServicesScreen";
import { theme } from "./src/theme";
import { BootstrapPayload, HousingPost } from "./src/types";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [pendingPost, setPendingPost] = useState<HousingPost | null>(null);
  const [visiblePosts, setVisiblePosts] = useState<HousingPost[]>([]);
  const [selectedNeed, setSelectedNeed] = useState("");
  const [city, setCity] = useState("Denver, CO");
  const [area, setArea] = useState("");

  async function load() {
    setLoading(true);
    try {
      const payload = await getBootstrap(city);
      setData(payload);
      setVisiblePosts(payload.housing);
    } catch (error) {
      Alert.alert("FairFares", error instanceof Error ? error.message : "Unable to load FairFares.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openMessage(post: HousingPost) {
    setPendingPost(post);
    setActiveTab("messenger");
    if (!data?.user) {
      setLoginOpen(true);
    }
  }

  async function selectNeed(need: string) {
    if (need === "ride_need" || need === "ride_offer") {
      Alert.alert("Rides", need === "ride_need" ? "Ride request flow is next. For now, use FairFares car rentals." : "Ride provider flow is next.");
      setActiveTab("services");
      return;
    }
    setSelectedNeed(need);
    setLoading(true);
    try {
      setVisiblePosts(await getHousing(city, area, need));
    } catch (error) {
      Alert.alert("Housing search", error instanceof Error ? error.message : "Unable to update listings.");
    } finally {
      setLoading(false);
    }
  }

  async function selectArea(nextArea: string) {
    setArea(nextArea);
    setLoading(true);
    try {
      setVisiblePosts(await getHousing(city, nextArea, selectedNeed));
      Alert.alert("Location updated", `Showing listings around ${nextArea}.`);
    } catch (error) {
      Alert.alert("Location search", error instanceof Error ? error.message : "Unable to search this area.");
    } finally {
      setLoading(false);
    }
  }

  function postNeed() {
    if (!data?.user) {
      setLoginOpen(true);
      return;
    }
    Alert.alert("Post your need", "Native posting is next. For now, create the listing from the Housing page on the website so it saves to the same database.");
  }

  function topAction(action: string) {
    if (action === "Housing") {
      setActiveTab("housing");
      void selectNeed("");
    } else if (action === "Ride") {
      Alert.alert("Ride", "Ride request/provider flow is next. Opening services for now.");
      setActiveTab("services");
    } else if (action === "Explorer" || action === "Deals") {
      Alert.alert(action, `${action} mobile screen is next. Opening services for now.`);
      setActiveTab("services");
    }
  }

  async function submitLogin() {
    try {
      await mobileLogin(identifier, password);
      setLoginOpen(false);
      setIdentifier("");
      setPassword("");
      await load();
    } catch (error) {
      Alert.alert("Login failed", error instanceof Error ? error.message : "Please try again.");
    }
  }

  const screen =
    activeTab === "messenger" ? (
      <MessengerScreen data={data} pendingPost={pendingPost} onRequireLogin={() => setLoginOpen(true)} />
    ) : activeTab === "profile" ? (
      <ProfileScreen data={data} onLogin={() => setLoginOpen(true)} />
    ) : activeTab === "services" ? (
      <ServicesScreen />
    ) : activeTab === "housing" ? (
      <HousingScreen
        data={data}
        posts={visiblePosts}
        selectedNeed={selectedNeed}
        onMessage={openMessage}
        onOpenMessenger={() => setActiveTab("messenger")}
        onNeedSelect={selectNeed}
        onAreaSelect={selectArea}
        onPostNeed={postNeed}
        onTopAction={topAction}
      />
    ) : (
      <HousingScreen
        data={data}
        posts={visiblePosts}
        selectedNeed={selectedNeed}
        onMessage={openMessage}
        onOpenMessenger={() => setActiveTab("messenger")}
        onNeedSelect={selectNeed}
        onAreaSelect={selectArea}
        onPostNeed={postNeed}
        onTopAction={topAction}
      />
    );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={theme.colors.text} />
          <Text style={styles.loaderText}>Loading FairFares</Text>
        </View>
      ) : (
        screen
      )}
      <BottomTabs active={activeTab} unreadCount={data?.chat.unreadCount || 0} onChange={setActiveTab} />
      <Modal visible={loginOpen} transparent animationType="slide" onRequestClose={() => setLoginOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Login to FairFares</Text>
            <Text style={styles.modalCopy}>Email/phone and password are required before messaging posters or joining groups.</Text>
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="Email or phone"
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="none"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={theme.colors.muted}
              secureTextEntry
              style={styles.input}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={submitLogin}>
              <Text style={styles.primaryButtonText}>Login</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setLoginOpen(false)}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md },
  loaderText: { color: theme.colors.text, fontWeight: "900" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: theme.colors.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: theme.spacing.lg, gap: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line },
  modalTitle: { color: theme.colors.text, fontSize: 27, fontWeight: "900" },
  modalCopy: { color: theme.colors.muted, fontSize: 16, lineHeight: 22 },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, paddingHorizontal: 16, minHeight: 54, fontSize: 16 },
  primaryButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, alignItems: "center", paddingVertical: 14 },
  primaryButtonText: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  secondaryButton: { alignItems: "center", paddingVertical: 8 },
  secondaryButtonText: { color: theme.colors.muted, fontWeight: "900" }
});
