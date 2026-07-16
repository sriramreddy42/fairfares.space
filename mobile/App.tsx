import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { BottomTabs, TabKey } from "./src/components/BottomTabs";
import { bookRentalCar, createMobileHousingPost, getBootstrap, getCars, getHousing, getSiteServices, mobileLogin, mobileSignup, MobileHousingPostInput } from "./src/api/client";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { HousingScreen } from "./src/screens/HousingScreen";
import { MessengerScreen } from "./src/screens/MessengerScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { ServiceKey, ServicesScreen } from "./src/screens/ServicesScreen";
import { theme } from "./src/theme";
import { BootstrapPayload, Car, HousingPost, ServiceItem } from "./src/types";

const emptyListingForm: MobileHousingPostInput = {
  postMode: "HAVE_PLACE",
  category: "single_room",
  title: "",
  description: "",
  city: "Denver, CO",
  streetAddress: "",
  zipCode: "",
  area: "",
  primaryNeighborhood: "",
  apartmentName: "",
  workSchoolLocation: "",
  radiusMiles: "10",
  moveInDate: "",
  rentMin: "",
  rentMax: "",
  rentPeriod: "MONTH",
  accommodates: "1",
  roommateCount: "0",
  aboutYou: "",
  bathroomType: "shared",
  genderPreference: "open",
  commutePreference: "",
  leaseTerm: "flexible",
  deposit: "",
  daysAvailable: "",
  vegetarianPreference: "",
  smokingPolicy: "",
  petFriendly: "",
  amenities: "",
  furnished: false,
  privateBath: false,
  parking: false,
  utilitiesIncluded: false,
  socialFacebook: "",
  socialX: "",
  socialInstagram: "",
  socialYoutube: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  roommateIntent: false
};

const listingModes: Array<[MobileHousingPostInput["postMode"], string]> = [
  ["HAVE_PLACE", "I have a place"],
  ["NEED_PLACE", "I need a place"]
];

const listingCategories: Array<[string, string]> = [
  ["single_room", "Single"],
  ["shared_room", "Shared"],
  ["paying_guest", "PG"],
  ["apartment", "Apartment"],
  ["single_family_home", "Home"],
  ["condo", "Condo"],
  ["town_house", "Townhouse"],
  ["basement_apartment", "Basement"]
];

const rentPeriods: Array<[string, string]> = [
  ["MONTH", "Monthly"],
  ["WEEK", "Weekly"],
  ["NIGHT", "Nightly"],
  ["FLEXIBLE", "Flexible"]
];

const bathroomOptions: Array<[string, string]> = [
  ["shared", "Shared bath"],
  ["private", "Private bath"],
  ["private_shared", "Private/shared"]
];

const genderOptions: Array<[string, string]> = [
  ["open", "Open"],
  ["female", "Female"],
  ["male", "Male"],
  ["couple", "Couple"],
  ["family", "Family"]
];

const leaseOptions: Array<[string, string]> = [
  ["short_stay", "Short stay"],
  ["one_month", "One month"],
  ["flexible", "Flexible"],
  ["three_to_six", "3-6 months"],
  ["six_to_twelve", "6-12 months"],
  ["year_plus", "12+ months"]
];

const lifestyleOptions: Array<[keyof MobileHousingPostInput, string, string[]]> = [
  ["vegetarianPreference", "Vegetarian", ["Mandatory veg", "Non-veg ok", "Both"]],
  ["smokingPolicy", "Smoking", ["No smoking", "Smoking ok", "Outside only"]],
  ["petFriendly", "Pets", ["No pets", "Only dogs", "Only cats", "Any pet ok"]]
];

const amenityToggles: Array<[keyof MobileHousingPostInput, string]> = [
  ["furnished", "Furnished"],
  ["privateBath", "Private bath"],
  ["parking", "Parking"],
  ["utilitiesIncluded", "Utilities included"]
];

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
  const [selectedGender] = useState("");
  const [selectedBudget] = useState("");
  const [city, setCity] = useState("Denver, CO");
  const [area, setArea] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchCity, setSearchCity] = useState("Denver, CO");
  const [searchArea, setSearchArea] = useState("");
  const [cars, setCars] = useState<Car[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceKey>("cars");
  const [listingOpen, setListingOpen] = useState(false);
  const [listingForm, setListingForm] = useState<MobileHousingPostInput>(emptyListingForm);

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

  async function bookCar(car: Car) {
    if (!data?.user) {
      setActiveTab("profile");
      setLoginOpen(true);
      return;
    }
    setLoading(true);
    try {
      const payload = await bookRentalCar(Number(car.id));
      Alert.alert(
        "Rental hold started",
        `${payload.booking.carName || car.name}\nHold due: $${payload.booking.holdAmount}\nPickup: ${payload.booking.pickupLocation}`
      );
      const [payloadData, carRows] = await Promise.all([getBootstrap(city), getCars()]);
      setData(payloadData);
      setCars(carRows);
    } catch (error) {
      Alert.alert("Rental booking failed", error instanceof Error ? error.message : "Unable to start this booking.");
    } finally {
      setLoading(false);
    }
  }

  async function selectNeed(need: string) {
    if (need === "ride_need" || need === "ride_offer") {
      setSelectedService("cars");
      setActiveTab("services");
      return;
    }
    setSelectedNeed(need);
    setLoading(true);
    try {
      setVisiblePosts(await getHousing(city, area, need, selectedCategory, selectedGender, selectedBudget));
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
      const posts = await getHousing(city, nextArea, selectedNeed, selectedCategory, selectedGender, selectedBudget);
      setVisiblePosts(posts);
      setData((current) =>
        current
          ? {
              ...current,
              location: {
                ...current.location,
                city,
                selected: nextArea ? `${city} · ${nextArea}` : city
              },
              housing: posts
            }
          : current
      );
      Alert.alert("Location updated", `Showing listings around ${nextArea}.`);
    } catch (error) {
      Alert.alert("Location search", error instanceof Error ? error.message : "Unable to search this area.");
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(nextCity = searchCity, nextArea = searchArea) {
    const cleanCity = normalizeCityInput(nextCity);
    const cleanArea = nextArea.trim();
    setCity(cleanCity);
    setArea(cleanArea);
    setSearchOpen(false);
    setLoading(true);
    try {
      const posts = await getHousing(cleanCity, cleanArea, selectedNeed, selectedCategory, selectedGender, selectedBudget);
      setVisiblePosts(posts);
      setData((current) =>
        current
          ? {
              ...current,
              location: {
                ...current.location,
                city: cleanCity,
                selected: cleanArea ? `${cleanCity} · ${cleanArea}` : cleanCity
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
    const nextMode: MobileHousingPostInput["postMode"] = selectedNeed === "have_place" || selectedNeed === "need_roommates" ? "NEED_PLACE" : "HAVE_PLACE";
    setListingForm({
      ...emptyListingForm,
      postMode: nextMode,
      roommateIntent: selectedNeed === "need_roommates",
      city,
      contactName: data.user.name || "",
      contactEmail: data.user.email || "",
      contactPhone: data.user.phone || ""
    });
    setListingOpen(true);
  }

  function updateListingForm<K extends keyof MobileHousingPostInput>(key: K, value: MobileHousingPostInput[K]) {
    setListingForm((current) => ({ ...current, [key]: value }));
  }

  async function submitListing() {
    try {
      const payload = await createMobileHousingPost(listingForm);
      setListingOpen(false);
      const posts = await getHousing(city, area, selectedNeed, selectedCategory, selectedGender, selectedBudget);
      setVisiblePosts(posts.some((post) => post.id === payload.post.id) ? posts : [payload.post, ...posts]);
      setData((current) =>
        current
          ? {
              ...current,
              housing: [payload.post, ...current.housing.filter((post) => post.id !== payload.post.id)],
              dashboard: { ...current.dashboard, housingPosts: current.dashboard.housingPosts + 1 }
            }
          : current
      );
      Alert.alert("Listing posted", "Your housing lead is live for 30 days.");
    } catch (error) {
      Alert.alert("Post failed", error instanceof Error ? error.message : "Unable to post this listing.");
    }
  }

  async function selectCategory(category: string) {
    setSelectedCategory(category);
    setLoading(true);
    try {
      setVisiblePosts(await getHousing(city, area, selectedNeed, category, selectedGender, selectedBudget));
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

  function renderChoiceGroup<K extends keyof MobileHousingPostInput>(
    field: K,
    options: Array<[MobileHousingPostInput[K] & string, string]>
  ) {
    return (
      <View style={styles.choiceRow}>
        {options.map(([value, label]) => (
          <TouchableOpacity
            key={value}
            style={[styles.choicePill, listingForm[field] === value && styles.choicePillActive]}
            onPress={() => updateListingForm(field, value as MobileHousingPostInput[K])}
          >
            <Text style={[styles.choiceText, listingForm[field] === value && styles.choiceTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  function renderFormSection(title: string, children: React.ReactNode) {
    return (
      <View style={styles.formSection}>
        <Text style={styles.formSectionTitle}>{title}</Text>
        {children}
      </View>
    );
  }

  function normalizeCityInput(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "Denver, CO";
    const known: Record<string, string> = {
      denver: "Denver, CO",
      aurora: "Aurora, CO",
      englewood: "Englewood, CO",
      littleton: "Littleton, CO",
      chicago: "Chicago, IL",
      austin: "Austin, TX",
      dallas: "Dallas, TX"
    };
    return known[trimmed.toLowerCase()] || trimmed;
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
    ) : activeTab === "activity" ? (
      <DashboardScreen data={data} />
    ) : activeTab === "profile" ? (
      <ProfileScreen data={data} onLogin={() => setLoginOpen(true)} />
    ) : activeTab === "services" ? (
      <ServicesScreen
        cars={cars}
        services={services}
        selected={selectedService}
        onSelect={setSelectedService}
        onOpenHousing={() => setActiveTab("housing")}
        onBookCar={bookCar}
      />
    ) : activeTab === "housing" || activeTab === "home" ? (
      <HousingScreen
        data={data}
        posts={visiblePosts}
        cars={cars}
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
        cars={cars}
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
      <Modal visible={loginOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setLoginOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={listingOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setListingOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView style={[styles.modalCard, styles.listingModalCard]} contentContainerStyle={styles.listingForm} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>List room / property</Text>
            <Text style={styles.modalCopy}>This saves to the same FairFares housing database and expires in 30 days.</Text>
            {renderFormSection(
              "Your need",
              <>
                {renderChoiceGroup("postMode", listingModes)}
                {renderChoiceGroup("category", listingCategories)}
                <TouchableOpacity
                  style={[styles.choicePill, listingForm.roommateIntent && styles.choicePillActive]}
                  onPress={() => updateListingForm("roommateIntent", !listingForm.roommateIntent)}
                >
                  <Text style={[styles.choiceText, listingForm.roommateIntent && styles.choiceTextActive]}>Need roommates</Text>
                </TouchableOpacity>
              </>
            )}
            {renderFormSection(
              "Location",
              <>
                <TextInput value={listingForm.city} onChangeText={(text) => updateListingForm("city", text)} placeholder="City* eg Denver, CO" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.zipCode} onChangeText={(text) => updateListingForm("zipCode", text)} placeholder="Zip code*" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="number-pad" />
                {listingForm.postMode === "HAVE_PLACE" ? (
                  <>
                    <TextInput value={listingForm.streetAddress} onChangeText={(text) => updateListingForm("streetAddress", text)} placeholder="Street address / room location*" placeholderTextColor={theme.colors.muted} style={styles.input} />
                    <TextInput value={listingForm.primaryNeighborhood} onChangeText={(text) => updateListingForm("primaryNeighborhood", text)} placeholder="Primary neighborhood" placeholderTextColor={theme.colors.muted} style={styles.input} />
                    <TextInput value={listingForm.apartmentName} onChangeText={(text) => updateListingForm("apartmentName", text)} placeholder="Apartment / building name" placeholderTextColor={theme.colors.muted} style={styles.input} />
                  </>
                ) : (
                  <>
                    <TextInput value={listingForm.area} onChangeText={(text) => updateListingForm("area", text)} placeholder="Preferred area / building / neighborhood*" placeholderTextColor={theme.colors.muted} style={styles.input} />
                    <TextInput value={listingForm.workSchoolLocation} onChangeText={(text) => updateListingForm("workSchoolLocation", text)} placeholder="Work / school / commute target" placeholderTextColor={theme.colors.muted} style={styles.input} />
                    <TextInput value={listingForm.radiusMiles} onChangeText={(text) => updateListingForm("radiusMiles", text)} placeholder="Search radius miles" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="number-pad" />
                  </>
                )}
              </>
            )}
            {renderFormSection(
              listingForm.postMode === "HAVE_PLACE" ? "Room details" : "Room requirements",
              <>
                <TextInput value={listingForm.title} onChangeText={(text) => updateListingForm("title", text)} placeholder="Title*" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.description} onChangeText={(text) => updateListingForm("description", text)} placeholder="Description*" placeholderTextColor={theme.colors.muted} style={[styles.input, styles.textArea]} multiline />
                <TextInput value={listingForm.moveInDate} onChangeText={(text) => updateListingForm("moveInDate", text)} placeholder={listingForm.postMode === "HAVE_PLACE" ? "Available from* eg 08/01/2026" : "Move-in from* eg 08/01/2026"} placeholderTextColor={theme.colors.muted} style={styles.input} />
                <View style={styles.twoCol}>
                  <TextInput value={listingForm.rentMin} onChangeText={(text) => updateListingForm("rentMin", text)} placeholder={listingForm.postMode === "HAVE_PLACE" ? "Rent*" : "Budget min*"} placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                  <TextInput value={listingForm.rentMax} onChangeText={(text) => updateListingForm("rentMax", text)} placeholder={listingForm.postMode === "HAVE_PLACE" ? "Rent max" : "Budget max"} placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                </View>
                {renderChoiceGroup("rentPeriod", rentPeriods)}
                <View style={styles.twoCol}>
                  <TextInput value={listingForm.accommodates} onChangeText={(text) => updateListingForm("accommodates", text)} placeholder="Accommodates*" placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                  <TextInput value={listingForm.roommateCount} onChangeText={(text) => updateListingForm("roommateCount", text)} placeholder="Roommates" placeholderTextColor={theme.colors.muted} style={[styles.input, styles.twoColInput]} keyboardType="number-pad" />
                </View>
                {renderChoiceGroup("bathroomType", bathroomOptions)}
                {renderChoiceGroup("genderPreference", genderOptions)}
                {renderChoiceGroup("leaseTerm", leaseOptions)}
                <TextInput value={listingForm.commutePreference} onChangeText={(text) => updateListingForm("commutePreference", text)} placeholder="Commute preference / transit notes" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.daysAvailable} onChangeText={(text) => updateListingForm("daysAvailable", text)} placeholder="Days available, eg 7 days / weekdays" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.deposit} onChangeText={(text) => updateListingForm("deposit", text)} placeholder="Deposit optional" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="number-pad" />
              </>
            )}
            {renderFormSection(
              "Preferences and amenities",
              <>
                <View style={styles.choiceRow}>
                  {amenityToggles.map(([field, label]) => (
                    <TouchableOpacity
                      key={field}
                      style={[styles.choicePill, listingForm[field] && styles.choicePillActive]}
                      onPress={() => updateListingForm(field, !listingForm[field] as MobileHousingPostInput[typeof field])}
                    >
                      <Text style={[styles.choiceText, listingForm[field] && styles.choiceTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput value={listingForm.amenities} onChangeText={(text) => updateListingForm("amenities", text)} placeholder="Amenities, eg WiFi, gym, laundry, parking" placeholderTextColor={theme.colors.muted} style={styles.input} />
                {lifestyleOptions.map(([field, label, options]) => (
                  <View key={field} style={styles.miniGroup}>
                    <Text style={styles.miniLabel}>{label}</Text>
                    <View style={styles.choiceRow}>
                      {options.map((option) => (
                        <TouchableOpacity key={option} style={[styles.choicePill, listingForm[field] === option && styles.choicePillActive]} onPress={() => updateListingForm(field, option as MobileHousingPostInput[typeof field])}>
                          <Text style={[styles.choiceText, listingForm[field] === option && styles.choiceTextActive]}>{option}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
                <TextInput value={listingForm.aboutYou} onChangeText={(text) => updateListingForm("aboutYou", text)} placeholder="About you / ideal roommate" placeholderTextColor={theme.colors.muted} style={[styles.input, styles.textAreaSmall]} multiline />
              </>
            )}
            {renderFormSection(
              "Contact and socials",
              <>
                <TextInput value={listingForm.contactName} onChangeText={(text) => updateListingForm("contactName", text)} placeholder="Contact name*" placeholderTextColor={theme.colors.muted} style={styles.input} />
                <TextInput value={listingForm.contactEmail} onChangeText={(text) => updateListingForm("contactEmail", text)} placeholder="Contact email*" placeholderTextColor={theme.colors.muted} style={styles.input} autoCapitalize="none" />
                <TextInput value={listingForm.contactPhone} onChangeText={(text) => updateListingForm("contactPhone", text)} placeholder="Contact phone*" placeholderTextColor={theme.colors.muted} style={styles.input} keyboardType="phone-pad" />
                <TextInput value={listingForm.socialFacebook} onChangeText={(text) => updateListingForm("socialFacebook", text)} placeholder="Facebook URL optional" placeholderTextColor={theme.colors.muted} style={styles.input} autoCapitalize="none" />
                <TextInput value={listingForm.socialInstagram} onChangeText={(text) => updateListingForm("socialInstagram", text)} placeholder="Instagram URL optional" placeholderTextColor={theme.colors.muted} style={styles.input} autoCapitalize="none" />
              </>
            )}
            <TouchableOpacity style={styles.primaryButton} onPress={submitListing}>
              <Text style={styles.primaryButtonText}>Post listing</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setListingOpen(false)}>
              <Text style={styles.switchText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={searchOpen} transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={() => setSearchOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Search housing</Text>
            <Text style={styles.modalCopy}>Enter a metro city, then narrow results by neighborhood, building, campus, or nearby landmark.</Text>
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
              placeholder="Search neighborhood, building, campus, or landmark"
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
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md },
  loaderText: { color: theme.colors.text, fontWeight: "900" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-start", paddingTop: 6, paddingHorizontal: 8 },
  modalCard: { maxHeight: "88%", backgroundColor: theme.colors.panel, borderRadius: 28, padding: theme.spacing.lg, gap: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line },
  listingModalCard: { maxHeight: "94%" },
  listingForm: { gap: theme.spacing.md, paddingBottom: theme.spacing.lg },
  modalTitle: { color: theme.colors.text, fontSize: 27, fontWeight: "900" },
  modalCopy: { color: theme.colors.muted, fontSize: 16, lineHeight: 22 },
  input: { backgroundColor: theme.colors.panel2, color: theme.colors.text, borderRadius: theme.radius.md, paddingHorizontal: 16, minHeight: 54, fontSize: 16 },
  textArea: { minHeight: 104, paddingTop: 14, textAlignVertical: "top" },
  textAreaSmall: { minHeight: 82, paddingTop: 14, textAlignVertical: "top" },
  formSection: { gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.lg, padding: theme.spacing.md, backgroundColor: theme.colors.bg },
  formSectionTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  miniGroup: { gap: 7 },
  miniLabel: { color: theme.colors.muted, fontWeight: "900" },
  twoCol: { flexDirection: "row", gap: theme.spacing.sm },
  twoColInput: { flex: 1 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choicePill: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 13, paddingVertical: 10, alignItems: "center" },
  choicePillActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  choiceText: { color: theme.colors.soft, fontWeight: "900" },
  choiceTextActive: { color: theme.colors.bg },
  primaryButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, alignItems: "center", paddingVertical: 14 },
  primaryButtonText: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  secondaryButton: { alignItems: "center", paddingVertical: 8 },
  secondaryButtonText: { color: theme.colors.muted, fontWeight: "900" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.colors.line, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  chipText: { color: theme.colors.text, fontWeight: "800" },
  chipTextActive: { color: theme.colors.bg },
  switchText: { color: theme.colors.muted, textAlign: "center", fontWeight: "900", paddingVertical: 8 }
});
