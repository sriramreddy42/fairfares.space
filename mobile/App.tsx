import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { BottomTabs, TabKey } from "./src/components/BottomTabs";
import { getBootstrap, getCars, getHousing, getSiteServices, mobileLogin, mobileSignup } from "./src/api/client";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { HousingScreen } from "./src/screens/HousingScreen";
import { MessengerScreen } from "./src/screens/MessengerScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { ServiceKey, ServicesScreen } from "./src/screens/ServicesScreen";
import { theme } from "./src/theme";
import { BootstrapPayload, Car, HousingPost, ServiceItem } from "./src/types";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [identifier, setIdentifier] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [password, setPassword] = useState("");
  const [pendingPost, setPendingPost] = useState<HousingPost | null>(null);
  const [visiblePosts, setVisiblePosts] = useState<HousingPost[]>([]);
  const [selectedNeed, setSelectedNeed] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [city, setCity] = useState("Denver, CO");
  const [area, setArea] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchCity, setSearchCity] = useState("Denver, CO");
  const [searchArea, setSearchArea] = useState("");
  const [cars, setCars] = useState<Car[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceKey>("cars");

  async function load() {
    setLoading(true);
    try {
      const payload = await getBootstrap(city);
      const [carRows, serviceRows] = await Promise.all([getCars(), getSiteServices()]);
      setData(payload);
      setVisiblePosts(payload.housing);
      setCars(carRows);
      setServices(serviceRows);
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
      setVisiblePosts(await getHousing(city, area, need, selectedCategory));
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
      setVisiblePosts(await getHousing(city, nextArea, selectedNeed, selectedCategory));
      Alert.alert("Location updated", `Showing listings around ${nextArea}.`);
    } catch (error) {
      Alert.alert("Location search", error instanceof Error ? error.message : "Unable to search this area.");
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(nextCity = searchCity, nextArea = searchArea) {
    const cleanCity = nextCity.trim() || "Denver, CO";
    const cleanArea = nextArea.trim();
    setCity(cleanCity);
    setArea(cleanArea);
    setSearchOpen(false);
    setLoading(true);
    try {
      const posts = await getHousing(cleanCity, cleanArea, selectedNeed, selectedCategory);
      setVisiblePosts(posts);
      setData((current) =>
        current
          ? {
              ...current,
              location: {
                ...current.location,
                city: cleanCity,
                selected: cleanArea || cleanCity
              },
              housing: posts
            }
          : current
      );
    } catch (error) {
      Alert.alert("Search failed", error instanceof Error ? error.message : "Unable to search this location.");
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

  async function selectCategory(category: string) {
    setSelectedCategory(category);
    setLoading(true);
    try {
      setVisiblePosts(await getHousing(city, area, selectedNeed, category));
    } catch (error) {
      Alert.alert("Room type", error instanceof Error ? error.message : "Unable to filter room type.");
    } finally {
      setLoading(false);
    }
  }

  function topAction(action: string) {
    if (action === "Housing") {
      setActiveTab("housing");
      void selectNeed("");
    } else if (action === "Ride") {
      setSelectedService("cars");
      setActiveTab("services");
    } else if (action === "Explorer" || action === "Deals") {
      setSelectedService(action === "Explorer" ? "explorer" : "deals");
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

  async function submitSignup() {
    try {
      const payload = await mobileSignup(signupName, identifier, signupPhone, password);
      Alert.alert("Signup created", payload.activationLink ? `${payload.message}\n\nActivation link: ${payload.activationLink}` : payload.message);
      setAuthMode("login");
    } catch (error) {
      Alert.alert("Signup failed", error instanceof Error ? error.message : "Please try again.");
    }
  }

  const screen =
    activeTab === "messenger" ? (
      <MessengerScreen data={data} pendingPost={pendingPost} onRequireLogin={() => setLoginOpen(true)} />
    ) : activeTab === "profile" ? (
      <ProfileScreen data={data} onLogin={() => setLoginOpen(true)} />
    ) : activeTab === "services" ? (
      <ServicesScreen
        cars={cars}
        services={services}
        selected={selectedService}
        onSelect={setSelectedService}
        onOpenHousing={() => setActiveTab("housing")}
      />
    ) : activeTab === "housing" || activeTab === "home" ? (
      <HousingScreen
        data={data}
        posts={visiblePosts}
        selectedNeed={selectedNeed}
        selectedCategory={selectedCategory}
        onMessage={openMessage}
        onOpenMessenger={() => setActiveTab("messenger")}
        onNeedSelect={selectNeed}
        onAreaSelect={selectArea}
        onOpenSearch={() => {
          setSearchCity(city);
          setSearchArea(area);
          setSearchOpen(true);
        }}
        onCategorySelect={selectCategory}
        onPostNeed={postNeed}
        onTopAction={topAction}
      />
    ) : (
      <HousingScreen
        data={data}
        posts={visiblePosts}
        selectedNeed={selectedNeed}
        selectedCategory={selectedCategory}
        onMessage={openMessage}
        onOpenMessenger={() => setActiveTab("messenger")}
        onNeedSelect={selectNeed}
        onAreaSelect={selectArea}
        onOpenSearch={() => {
          setSearchCity(city);
          setSearchArea(area);
          setSearchOpen(true);
        }}
        onCategorySelect={selectCategory}
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
            <Text style={styles.modalTitle}>{authMode === "login" ? "Login to FairFares" : "Create FairFares account"}</Text>
            <Text style={styles.modalCopy}>
              {authMode === "login"
                ? "Email/phone and password are required before messaging posters or joining groups."
                : "Signup needs name, email, phone, and password. You will activate the account from email before login."}
            </Text>
            {authMode === "signup" ? (
              <TextInput
                value={signupName}
                onChangeText={setSignupName}
                placeholder="Full name"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
              />
            ) : null}
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              placeholder={authMode === "login" ? "Email or phone" : "Email"}
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="none"
              style={styles.input}
            />
            {authMode === "signup" ? (
              <TextInput
                value={signupPhone}
                onChangeText={setSignupPhone}
                placeholder="Phone number"
                placeholderTextColor={theme.colors.muted}
                keyboardType="phone-pad"
                style={styles.input}
              />
            ) : null}
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={theme.colors.muted}
              secureTextEntry
              style={styles.input}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={authMode === "login" ? submitLogin : submitSignup}>
              <Text style={styles.primaryButtonText}>{authMode === "login" ? "Login" : "Sign up"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
              <Text style={styles.secondaryButtonText}>{authMode === "login" ? "Need an account? Sign up" : "Already have an account? Login"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setLoginOpen(false)}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={searchOpen} transparent animationType="slide" onRequestClose={() => setSearchOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Search housing</Text>
            <Text style={styles.modalCopy}>Enter a metro city and optional area, building, campus, or neighborhood.</Text>
            <TextInput
              value={searchCity}
              onChangeText={setSearchCity}
              placeholder="City, e.g. Denver, CO"
              placeholderTextColor={theme.colors.muted}
              style={styles.input}
            />
            <TextInput
              value={searchArea}
              onChangeText={setSearchArea}
              placeholder="Area/building, e.g. Union Station or DU"
              placeholderTextColor={theme.colors.muted}
              style={styles.input}
            />
            <View style={styles.chipRow}>
              {["Union Station", "DU", "Aurora", "Englewood"].map((chip) => (
                <TouchableOpacity key={chip} style={styles.chip} onPress={() => setSearchArea(chip)}>
                  <Text style={styles.chipText}>{chip}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={() => runSearch()}>
              <Text style={styles.primaryButtonText}>Search listings</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setSearchOpen(false)}>
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
  secondaryButtonText: { color: theme.colors.muted, fontWeight: "900" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: theme.colors.text, fontWeight: "800" }
});
