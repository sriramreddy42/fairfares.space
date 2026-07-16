import React from "react";
import { Alert, Image, ImageBackground, ImageSourcePropType, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { absoluteAssetUrl } from "../api/client";
import { appAssets } from "../assets";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { Car, ServiceItem } from "../types";

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
  onBookCar: (car: Car) => void;
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
      <Text style={styles.title}>Services</Text>
      <ServiceGrid title="Go anywhere" tiles={goAnywhere} selected={selected} onPress={openTile} />
      <ServiceGrid title="Get anything done" tiles={deliveryTiles} selected={selected} onPress={openTile} />

      {selected === "cars" ? <CarRentals cars={cars} onBookCar={onBookCar} /> : null}
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

function CarRentals({ cars, onBookCar }: { cars: Car[]; onBookCar: (car: Car) => void }) {
  const cheapest = [...cars].filter((car) => Number(car.daily_price) > 0).sort((a, b) => Number(a.daily_price) - Number(b.daily_price))[0];
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Car Rentals" title="Today's cheapest rate" />
      <ImageBackground source={appAssets.rentalPromo} style={styles.rateHero} imageStyle={styles.rateHeroImage}>
        <View style={styles.rateShade}>
          <Text style={styles.rateEyebrow}>Rental cars</Text>
          <Text style={styles.rateHeroTitle}>Today's cheapest rate</Text>
          <Text style={styles.rateMeta}>{cheapest ? `${cheapest.name} · ${cheapest.location || "Denver pickup"}` : "Toyota Corolla · Denver International Airport"}</Text>
          <Text style={styles.ratePhone}>Call / text: +1 9372518688</Text>
          <View style={styles.rateHeroFooter}>
            <TouchableOpacity style={styles.bookNow} onPress={() => cheapest && onBookCar(cheapest)}>
              <Text style={styles.bookNowText}>Book now</Text>
            </TouchableOpacity>
            <View style={styles.priceBadge}>
              <Text style={styles.ratePrice}>{cheapest ? `$${cheapest.daily_price}` : "$29.99"}</Text>
              <Text style={styles.priceBadgeMeta}>per day</Text>
            </View>
          </View>
        </View>
      </ImageBackground>
      {cars.map((car) => {
        const image = absoluteAssetUrl(car.image_url);
        return (
          <TouchableOpacity key={car.id} style={styles.carCard} onPress={() => onBookCar(car)}>
            {image ? <Image source={{ uri: image }} style={styles.carImage} /> : <Image source={appAssets.carFallback} style={styles.carImage} />}
            <View style={styles.carBody}>
              <Text style={styles.cardTitle}>{car.name}</Text>
              <Text style={styles.cardMeta}>{car.brand} {car.model} · {car.seats} seats · {car.transmission}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.price}>${car.daily_price}/day</Text>
                <Text style={styles.action}>Select</Text>
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
  priceBadge: { minWidth: 108, backgroundColor: theme.colors.text, borderRadius: theme.radius.md, padding: theme.spacing.sm, alignItems: "center" },
  ratePrice: { color: theme.colors.bg, fontSize: 25, fontWeight: "900" },
  priceBadgeMeta: { color: "#555", fontWeight: "900" },
  carCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.line },
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
