import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, ImageBackground, ImageSourcePropType, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { absoluteAssetUrl, getCars, quoteRentalCar } from "../api/client";
import { appAssets } from "../assets";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { Car, RentalQuote, RentalSearchInput, ServiceItem } from "../types";

export type ServiceKey = "cars" | "deals" | "explorer" | "housing" | "local";

type ServiceTile = {
  key: ServiceKey;
  label: string;
  badge?: string;
  icon: ImageSourcePropType;
  action: "select" | "housing";
};

const goAnywhere: ServiceTile[] = [
  { key: "cars", label: "Ride", badge: "5%", icon: appAssets.ride, action: "select" },
  { key: "deals", label: "Reserve", badge: "Promo", icon: appAssets.arrowDown, action: "select" },
  { key: "housing", label: "Housing", badge: "New", icon: appAssets.bed, action: "housing" },
  { key: "cars", label: "Rental Cars", badge: "Promo", icon: appAssets.ride, action: "select" },
  { key: "explorer", label: "Explorer", icon: appAssets.explorer, action: "select" },
  { key: "local", label: "Transit", icon: appAssets.search, action: "select" },
  { key: "cars", label: "Hourly", icon: appAssets.ride, action: "select" },
  { key: "housing", label: "Roommates", icon: appAssets.roommates, action: "housing" },
  { key: "local", label: "Care", icon: appAssets.profile, action: "select" },
  { key: "deals", label: "Student Deals", icon: appAssets.logo, action: "select" }
];

const deliveryTiles: ServiceTile[] = [
  { key: "local", label: "Food", icon: appAssets.logo, action: "select" },
  { key: "local", label: "Grocery", icon: appAssets.arrowDown, action: "select" },
  { key: "local", label: "Events", icon: appAssets.search, action: "select" },
  { key: "local", label: "Convenience", icon: appAssets.logo, action: "select" },
  { key: "local", label: "Electronics", icon: appAssets.search, action: "select" },
  { key: "local", label: "Retail", icon: appAssets.arrowUp, action: "select" },
  { key: "local", label: "Support", icon: appAssets.message, action: "select" },
  { key: "local", label: "Health", icon: appAssets.profile, action: "select" }
];

type Props = {
  cars: Car[];
  services: ServiceItem[];
  selected: ServiceKey;
  onSelect: (service: ServiceKey) => void;
  onOpenHousing: () => void;
  onBookCar: (car: Car, details?: Partial<RentalSearchInput>, paymentOption?: "hold" | "full") => void;
};

export function ServicesScreen({ cars, services, selected, onSelect, onOpenHousing, onBookCar }: Props) {
  function openTile(tile: ServiceTile) {
    if (tile.action === "housing") {
      onOpenHousing();
      return;
    }
    onSelect(tile.key);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{selected === "cars" ? "Rental Cars" : "Services"}</Text>
      {selected === "cars" ? <CarRentals cars={cars} onBookCar={onBookCar} /> : null}
      <ServiceGrid title="Go anywhere" tiles={goAnywhere} selected={selected} onPress={openTile} />
      <ServiceGrid title="Get anything done" tiles={deliveryTiles} selected={selected} onPress={openTile} />

      {selected === "deals" ? <Deals /> : null}
      {selected === "explorer" ? <Explorer /> : null}
      {selected === "local" ? <LocalServices services={services} /> : null}
    </ScrollView>
  );
}

function ServiceGrid({
  title,
  tiles,
  selected,
  onPress
}: {
  title: string;
  tiles: ServiceTile[];
  selected: ServiceKey;
  onPress: (tile: ServiceTile) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.grid}>
        {tiles.map((tile, index) => (
          <TouchableOpacity
            key={`${tile.label}-${index}`}
            style={[styles.tile, selected === tile.key && tile.action !== "housing" && styles.tileActive]}
            onPress={() => onPress(tile)}
          >
            {tile.badge ? <Text style={styles.badge}>{tile.badge}</Text> : null}
            <Image source={tile.icon} style={styles.tileIcon} resizeMode="contain" />
            <Text numberOfLines={1} style={styles.tileLabel}>{tile.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function isoDateFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const initialRentalSearch: RentalSearchInput = {
  pickupLocation: "Denver International Airport (DEN)",
  returnLocation: "Denver International Airport (DEN)",
  pickupDate: isoDateFromNow(6),
  returnDate: isoDateFromNow(9),
  pickupTime: "10:00 AM",
  returnTime: "10:00 AM",
  discountCode: "",
  days: 3,
  additionalDriverRequested: false,
  additionalDriverName: "",
  additionalDriverAge: ""
};

function dollars(value: unknown) {
  const numeric = Number(value || 0);
  return `$${numeric.toFixed(2)}`;
}

function CarRentals({ cars, onBookCar }: { cars: Car[]; onBookCar: (car: Car, details?: Partial<RentalSearchInput>, paymentOption?: "hold" | "full") => void }) {
  const [search, setSearch] = useState<RentalSearchInput>(initialRentalSearch);
  const [visibleCars, setVisibleCars] = useState<Car[]>(cars);
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  const [quote, setQuote] = useState<RentalQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = visibleCars.length ? visibleCars : cars;
  const cheapest = [...cars].filter((car) => Number(car.daily_price) > 0).sort((a, b) => Number(a.daily_price) - Number(b.daily_price))[0];
  const heroImage = absoluteAssetUrl(cheapest?.image_url || "");
  const heroSource = heroImage ? { uri: heroImage } : appAssets.carFallback;
  const pickupLocations = useMemo(() => Array.from(new Set(cars.map((car) => car.location).filter(Boolean))).slice(0, 4), [cars]);

  useEffect(() => {
    setVisibleCars(cars);
  }, [cars]);

  function updateSearch(key: keyof RentalSearchInput, value: string | boolean) {
    setSearch((current) => {
      const next = { ...current, [key]: value };
      if (key === "pickupLocation" && !current.returnLocation) {
        next.returnLocation = String(value);
      }
      return next;
    });
  }

  async function searchCars() {
    setBusy(true);
    try {
      const nextCars = await getCars(search.pickupLocation);
      setVisibleCars(nextCars);
      setSelectedCar(null);
      setQuote(null);
    } catch (error) {
      Alert.alert("Rental search failed", error instanceof Error ? error.message : "Could not search cars.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewCar(car: Car) {
    setSelectedCar(car);
    setBusy(true);
    try {
      const rentalQuote = await quoteRentalCar(Number(car.id), search);
      setQuote(rentalQuote);
    } catch (error) {
      setQuote(null);
      Alert.alert("Quote failed", error instanceof Error ? error.message : "Could not quote this rental.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Car Rentals" title="Today's cheapest rate" />
      <ImageBackground source={heroSource} style={styles.rateHero} imageStyle={styles.rateHeroImage}>
        <View style={styles.rateShade}>
          <Text style={styles.rateEyebrow}>Rental cars</Text>
          <Text style={styles.rateHeroTitle}>Today's cheapest rate</Text>
          <Text style={styles.rateMeta}>{cheapest ? `${cheapest.name} · ${cheapest.location || "Denver pickup"}` : "Toyota Corolla · Denver International Airport"}</Text>
          <Text style={styles.ratePhone}>Call / text: +1 9372518688</Text>
          <View style={styles.rateHeroFooter}>
            <TouchableOpacity style={styles.bookNow} onPress={() => cheapest && reviewCar(cheapest)}>
              <Text style={styles.bookNowText}>Book now</Text>
            </TouchableOpacity>
            <View style={styles.priceBadge}>
              <Text style={styles.ratePrice}>{cheapest ? `$${cheapest.daily_price}` : "$29.99"}</Text>
              <Text style={styles.priceBadgeMeta}>per day</Text>
            </View>
          </View>
        </View>
      </ImageBackground>
      <View style={styles.rentalSearchPanel}>
        <Text style={styles.panelTitle}>Search rental cars</Text>
        <Text style={styles.fieldLabel}>Pickup location</Text>
        <TextInput value={search.pickupLocation} onChangeText={(text) => updateSearch("pickupLocation", text)} placeholder="Airport, city, or pickup address" placeholderTextColor={theme.colors.muted} style={styles.searchInput} />
        <Text style={styles.fieldLabel}>Return location</Text>
        <TextInput value={search.returnLocation} onChangeText={(text) => updateSearch("returnLocation", text)} placeholder="Same as pickup or another return place" placeholderTextColor={theme.colors.muted} style={styles.searchInput} />
        <View style={styles.twoCol}>
          <View style={styles.twoColField}>
            <Text style={styles.fieldLabel}>Pickup date</Text>
            <TextInput value={search.pickupDate} onChangeText={(text) => updateSearch("pickupDate", text)} placeholder="YYYY-MM-DD" placeholderTextColor={theme.colors.muted} style={styles.searchInput} />
          </View>
          <View style={styles.twoColField}>
            <Text style={styles.fieldLabel}>Return date</Text>
            <TextInput value={search.returnDate} onChangeText={(text) => updateSearch("returnDate", text)} placeholder="YYYY-MM-DD" placeholderTextColor={theme.colors.muted} style={styles.searchInput} />
          </View>
        </View>
        <View style={styles.twoCol}>
          <View style={styles.twoColField}>
            <Text style={styles.fieldLabel}>Pickup time</Text>
            <TextInput value={search.pickupTime} onChangeText={(text) => updateSearch("pickupTime", text)} placeholder="10:00 AM" placeholderTextColor={theme.colors.muted} style={styles.searchInput} />
          </View>
          <View style={styles.twoColField}>
            <Text style={styles.fieldLabel}>Return time</Text>
            <TextInput value={search.returnTime} onChangeText={(text) => updateSearch("returnTime", text)} placeholder="10:00 AM" placeholderTextColor={theme.colors.muted} style={styles.searchInput} />
          </View>
        </View>
        <Text style={styles.fieldLabel}>Promo / referral / student code</Text>
        <TextInput value={search.discountCode} onChangeText={(text) => updateSearch("discountCode", text.toUpperCase())} placeholder="Promo / referral / student code" placeholderTextColor={theme.colors.muted} style={styles.searchInput} autoCapitalize="characters" />
        <TouchableOpacity style={styles.driverToggle} onPress={() => updateSearch("additionalDriverRequested", !search.additionalDriverRequested)}>
          <Text style={styles.driverToggleText}>{search.additionalDriverRequested ? "Additional driver selected" : "Add additional driver"}</Text>
          <Text style={styles.driverToggleMeta}>${10}/day</Text>
        </TouchableOpacity>
        {search.additionalDriverRequested ? (
          <View style={styles.twoCol}>
            <View style={styles.twoColField}>
              <Text style={styles.fieldLabel}>Driver name</Text>
              <TextInput value={search.additionalDriverName} onChangeText={(text) => updateSearch("additionalDriverName", text)} placeholder="Full name" placeholderTextColor={theme.colors.muted} style={styles.searchInput} />
            </View>
            <View style={styles.twoColField}>
              <Text style={styles.fieldLabel}>Driver age</Text>
              <TextInput value={search.additionalDriverAge} onChangeText={(text) => updateSearch("additionalDriverAge", text)} placeholder="25+" placeholderTextColor={theme.colors.muted} style={styles.searchInput} />
            </View>
          </View>
        ) : null}
        <View style={styles.chips}>
          {pickupLocations.map((location) => (
            <TouchableOpacity key={location} style={styles.chip} onPress={() => updateSearch("pickupLocation", location)}>
              <Text style={styles.chipText}>{location}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.searchButton} onPress={searchCars} disabled={busy}>
          <Text style={styles.searchButtonText}>{busy ? "Searching..." : "Search cars"}</Text>
        </TouchableOpacity>
      </View>
      {quote ? (
        <View style={styles.quotePanel}>
          <Text style={styles.panelTitle}>Checkout review</Text>
          <Text style={styles.quoteTitle}>{quote.booking.carName || selectedCar?.name}</Text>
          <View style={styles.quoteGrid}>
            <Text style={styles.quoteItem}>Trip: {quote.booking.days} days</Text>
            <Text style={styles.quoteItem}>Daily: {dollars(quote.breakdown.effectiveDaily)}</Text>
            <Text style={styles.quoteItem}>Taxes/fees: {dollars(quote.breakdown.taxFeeAmount)}</Text>
            <Text style={styles.quoteItem}>Discount: -{dollars(quote.breakdown.discountAmount)}</Text>
            <Text style={styles.quoteItem}>10% hold: {dollars(quote.breakdown.holdAmount)}</Text>
            <Text style={styles.quoteItem}>Due pickup: {dollars(quote.breakdown.dueAtPickup)}</Text>
          </View>
          <Text style={styles.quoteTotal}>Total {dollars(quote.breakdown.total)} · full pay {dollars(quote.breakdown.fullPaymentTotal)}</Text>
          <Text style={styles.policyText}>Deposit: {dollars(quote.policy.securityDepositAmount)} refundable authorization at pickup.</Text>
          <Text style={styles.policyText}>{quote.policy.cancellation.cutoff_copy}</Text>
          {quote.policy.bullets.map((item) => <Text key={item} style={styles.policyBullet}>- {item}</Text>)}
          <View style={styles.paymentActions}>
            <TouchableOpacity style={[styles.bookNowWide, styles.holdButton]} onPress={() => selectedCar && onBookCar(selectedCar, search, "hold")}>
              <Text style={styles.bookNowText}>Pay 10% hold</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.bookNowWide, styles.fullPayButton]} onPress={() => selectedCar && onBookCar(selectedCar, search, "full")}>
              <Text style={styles.fullPayButtonText}>Pay full</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {rows.map((car) => {
        const image = absoluteAssetUrl(car.image_url);
        return (
          <TouchableOpacity key={car.id} style={[styles.carCard, selectedCar?.id === car.id && styles.carCardActive]} onPress={() => reviewCar(car)}>
            {image ? <Image source={{ uri: image }} style={styles.carImage} /> : <Image source={appAssets.carFallback} style={styles.carImage} />}
            <View style={styles.carBody}>
              <Text style={styles.cardTitle}>{car.name}</Text>
              <Text style={styles.cardMeta}>{car.brand} {car.model} · {car.seats} seats · {car.transmission}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.price}>${car.daily_price}/day</Text>
                <Text style={styles.action}>{selectedCar?.id === car.id ? "Reviewing" : "Review"}</Text>
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Deals() {
  const deals = ["Student savings", "Housing match alerts", "Long rental savings"];
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Deals" title="Current FairFares offers" />
      {deals.map((deal) => (
        <TouchableOpacity key={deal} style={styles.infoCard} onPress={() => Alert.alert(deal, "Offer details open here.")}>
          <Image source={appAssets.arrowDown} style={styles.infoIcon} resizeMode="contain" />
          <Text style={styles.cardTitle}>{deal}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Explorer() {
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Explorer" title="Location intelligence" />
      <View style={styles.infoCard}>
        <Image source={appAssets.explorer} style={styles.infoIcon} resizeMode="contain" />
        <Text style={styles.cardTitle}>Search by city, area, building, radius, and distance.</Text>
      </View>
    </View>
  );
}

function LocalServices({ services }: { services: ServiceItem[] }) {
  const rows = services.length ? services : [{ title: "Local services", body: "FairFares directory items load here.", icon: "local" }];
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Local" title="Service directory" />
      {rows.map((service) => (
        <TouchableOpacity key={service.title} style={styles.infoCard} onPress={() => Alert.alert(service.title, service.body)}>
          <Image source={appAssets.logo} style={styles.infoIcon} resizeMode="contain" />
          <View style={styles.infoCopy}>
            <Text style={styles.cardTitle}>{service.title}</Text>
            <Text style={styles.cardMeta}>{service.body}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.md, paddingBottom: 32, gap: theme.spacing.lg },
  title: { color: theme.colors.text, fontSize: 42, fontWeight: "900" },
  section: { gap: theme.spacing.md },
  sectionTitle: { color: theme.colors.text, fontSize: 25, fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: "30.8%", minHeight: 108, backgroundColor: theme.colors.panel2, borderRadius: 12, alignItems: "center", justifyContent: "center", padding: 8, gap: 8 },
  tileActive: { borderWidth: 2, borderColor: theme.colors.brand },
  badge: { position: "absolute", top: -10, left: 18, backgroundColor: theme.colors.accent, color: theme.colors.text, borderRadius: 6, overflow: "hidden", paddingHorizontal: 6, paddingVertical: 3, fontWeight: "900", zIndex: 2 },
  tileIcon: { width: 48, height: 48 },
  tileLabel: { color: theme.colors.soft, fontSize: 16, fontWeight: "800", textAlign: "center" },
  rateHero: { minHeight: 360, borderRadius: theme.radius.lg, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.line },
  rateHeroImage: { borderRadius: theme.radius.lg },
  rateShade: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", padding: theme.spacing.lg, justifyContent: "space-between", gap: theme.spacing.md },
  rateEyebrow: { color: theme.colors.accent, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  rateHeroTitle: { color: theme.colors.text, fontSize: 34, lineHeight: 38, fontWeight: "900", maxWidth: 260 },
  rateMeta: { color: theme.colors.soft, fontWeight: "900", lineHeight: 20 },
  ratePhone: { color: theme.colors.green, fontWeight: "900", fontSize: 18 },
  rateHeroFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: theme.spacing.md },
  bookNow: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingHorizontal: 18, paddingVertical: 13 },
  bookNowText: { color: theme.colors.text, fontWeight: "900", textTransform: "uppercase" },
  bookNowWide: { backgroundColor: theme.colors.accent, borderRadius: theme.radius.md, paddingHorizontal: 18, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  priceBadge: { minWidth: 108, backgroundColor: theme.colors.text, borderRadius: theme.radius.md, padding: theme.spacing.sm, alignItems: "center" },
  ratePrice: { color: theme.colors.bg, fontSize: 25, fontWeight: "900" },
  priceBadgeMeta: { color: "#555", fontWeight: "900" },
  rentalSearchPanel: {
    backgroundColor: "rgba(24,24,27,0.72)",
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    padding: theme.spacing.md,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 }
  },
  panelTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900" },
  fieldLabel: { color: theme.colors.muted, fontSize: 12, fontWeight: "900", textTransform: "uppercase", marginTop: 2 },
  searchInput: { backgroundColor: "rgba(255,255,255,0.08)", color: theme.colors.text, borderRadius: theme.radius.md, minHeight: 48, paddingHorizontal: 13, fontSize: 15, fontWeight: "800" },
  twoCol: { flexDirection: "row", gap: 10 },
  twoColField: { flex: 1 },
  driverToggle: { borderWidth: 1, borderColor: "rgba(255,255,255,0.13)", borderRadius: theme.radius.md, paddingHorizontal: 12, paddingVertical: 11, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  driverToggleText: { color: theme.colors.text, fontWeight: "900" },
  driverToggleMeta: { color: theme.colors.green, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "rgba(255,255,255,0.06)" },
  chipText: { color: theme.colors.text, fontWeight: "900", fontSize: 12 },
  searchButton: { backgroundColor: theme.colors.blue, borderRadius: theme.radius.pill, minHeight: 48, alignItems: "center", justifyContent: "center" },
  searchButtonText: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  quotePanel: { backgroundColor: "#111827", borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.blue, padding: theme.spacing.md, gap: 10 },
  quoteTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "900" },
  quoteGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quoteItem: { width: "48%", color: theme.colors.soft, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontWeight: "800" },
  quoteTotal: { color: theme.colors.green, fontSize: 19, fontWeight: "900" },
  policyText: { color: theme.colors.soft, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  policyBullet: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  paymentActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  holdButton: { flex: 1 },
  fullPayButton: { flex: 1, backgroundColor: theme.colors.text },
  fullPayButtonText: { color: theme.colors.bg, fontWeight: "900", textTransform: "uppercase" },
  carCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.line },
  carCardActive: { borderColor: theme.colors.blue },
  carImage: { width: "100%", height: 150 },
  carBody: { padding: theme.spacing.md, gap: 8 },
  cardTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900", flex: 1 },
  cardMeta: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  price: { color: theme.colors.green, fontSize: 18, fontWeight: "900" },
  action: { color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 9, overflow: "hidden", fontWeight: "900" },
  infoCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, gap: 12, flexDirection: "row", alignItems: "center" },
  infoIcon: { width: 48, height: 48 },
  infoCopy: { flex: 1, gap: 5 }
});
