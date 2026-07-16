import React from "react";
import { Alert, Image, ImageSourcePropType, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { absoluteAssetUrl } from "../api/client";
import { appAssets } from "../assets";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { Car, ServiceItem } from "../types";

export type ServiceKey = "cars" | "deals" | "explorer" | "housing" | "local";

const tiles: Array<{ key: ServiceKey; label: string; subtitle: string; icon: ImageSourcePropType }> = [
  { key: "cars", label: "Car Rentals", subtitle: "Book, manage, deals", icon: appAssets.ride },
  { key: "housing", label: "Housing", subtitle: "Need or list a place", icon: appAssets.bed },
  { key: "explorer", label: "Explorer", subtitle: "Map areas nearby", icon: appAssets.explorer },
  { key: "deals", label: "Deals", subtitle: "Savings and alerts", icon: appAssets.arrowDown },
  { key: "local", label: "Local Services", subtitle: "FairFares directory", icon: appAssets.search }
];

type Props = {
  cars: Car[];
  services: ServiceItem[];
  selected: ServiceKey;
  onSelect: (service: ServiceKey) => void;
  onOpenHousing: () => void;
};

export function ServicesScreen({ cars, services, selected, onSelect, onOpenHousing }: Props) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Image source={appAssets.logo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.heroTitle}>FairFares services</Text>
        <Text style={styles.heroCopy}>The same web modules are here: car rentals, housing, explorer, deals, local services, chats, and profile.</Text>
      </View>

      <View style={styles.grid}>
        {tiles.map((service) => (
          <TouchableOpacity
            key={service.key}
            style={[styles.tile, selected === service.key && styles.tileActive]}
            onPress={() => (service.key === "housing" ? onOpenHousing() : onSelect(service.key))}
          >
            <View style={[styles.iconWrap, selected === service.key && styles.iconWrapActive]}>
              <Image source={service.icon} style={styles.iconImage} resizeMode="contain" />
            </View>
            <Text style={styles.label}>{service.label}</Text>
            <Text style={styles.subtitle}>{service.subtitle}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {selected === "cars" ? <CarRentals cars={cars} /> : null}
      {selected === "deals" ? <Deals /> : null}
      {selected === "explorer" ? <Explorer /> : null}
      {selected === "local" ? <LocalServices services={services} /> : null}
    </ScrollView>
  );
}

function CarRentals({ cars }: { cars: Car[] }) {
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Car Rentals" title="Book and manage rentals" />
      <View style={styles.actionStrip}>
        {["Search cars", "Manage booking", "Deals"].map((item) => (
          <TouchableOpacity key={item} style={styles.actionPill} onPress={() => Alert.alert(item, `${item} opens the native car rental flow.`)}>
            <Image source={item === "Deals" ? appAssets.arrowDown : appAssets.ride} style={styles.pillIcon} resizeMode="contain" />
            <Text style={styles.actionText}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {cars.length ? (
        cars.map((car) => {
          const image = absoluteAssetUrl(car.image_url);
          return (
            <TouchableOpacity key={car.id} style={styles.carCard} onPress={() => Alert.alert(car.name, `${car.category} · ${car.location || "Location open"}`)}>
              {image ? <Image source={{ uri: image }} style={styles.carImage} /> : <Image source={appAssets.carFallback} style={styles.carImage} />}
              <View style={styles.carBody}>
                <Text style={styles.cardTitle}>{car.name}</Text>
                <Text style={styles.cardMeta}>{car.brand} {car.model} · {car.seats} seats · {car.transmission}</Text>
                <Text style={styles.cardMeta}>{car.location || "Pickup location open"}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.price}>${car.daily_price}/day</Text>
                  <Text style={styles.action}>Select</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      ) : (
        <View style={styles.empty}>
          <Image source={appAssets.ride} style={styles.emptyIcon} resizeMode="contain" />
          <Text style={styles.emptyTitle}>No active car inventory in this database yet.</Text>
          <Text style={styles.emptyText}>Once cars are added from the web admin inventory, the same records will show here from `/api/cars`.</Text>
        </View>
      )}
    </View>
  );
}

function Deals() {
  const deals = [
    { title: "Student savings", copy: "FairFares deal cards can show verified student pricing and booking reminders.", icon: appAssets.logo },
    { title: "Housing match alerts", copy: "Notify users when new rooms match city, area, budget, radius, and need type.", icon: appAssets.bed },
    { title: "Long rental savings", copy: "Surface weekly or monthly car rental offers from the same web deals section.", icon: appAssets.ride }
  ];
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Deals" title="FairFares offers" />
      {deals.map((deal) => (
        <TouchableOpacity key={deal.title} style={styles.infoCard} onPress={() => Alert.alert(deal.title, deal.copy)}>
          <Image source={deal.icon} style={styles.infoIcon} resizeMode="contain" />
          <View style={styles.infoCopy}>
            <Text style={styles.cardTitle}>{deal.title}</Text>
            <Text style={styles.cardMeta}>{deal.copy}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Explorer() {
  const explorerItems = [
    "Find places near your housing search",
    "Compare distance from Union Station, DU, airports, or a building",
    "Open radius-aware results for rooms, rides, and car pickups"
  ];
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Explorer" title="Location intelligence" />
      <View style={styles.explorerHero}>
        <Image source={appAssets.explorer} style={styles.explorerImage} resizeMode="cover" />
        <Text style={styles.explorerTitle}>Search by city plus exact area or building.</Text>
        <Text style={styles.explorerCopy}>This mirrors the web map work: city, area/building, radius, distance, and sort direction.</Text>
      </View>
      {explorerItems.map((item, index) => (
        <TouchableOpacity key={item} style={styles.infoCard} onPress={() => Alert.alert("Explorer", item)}>
          <Text style={styles.rank}>{index + 1}</Text>
          <View style={styles.infoCopy}>
            <Text style={styles.cardTitle}>{item}</Text>
            <Text style={styles.cardMeta}>Native map detail will use the same backend location data.</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function LocalServices({ services }: { services: ServiceItem[] }) {
  const rows = services.length
    ? services
    : [
        { title: "Roommates / Rentals", body: "Share your room availability or accommodation needs.", icon: "housing" },
        { title: "Care Services", body: "Community service listings and contact workflows.", icon: "care" },
        { title: "Events", body: "Local events and ticketing links from the FairFares web nav.", icon: "events" }
      ];
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Local" title="Service directory" />
      {rows.map((service) => (
        <TouchableOpacity key={service.title} style={styles.infoCard} onPress={() => Alert.alert(service.title, service.body)}>
          <Image source={service.title.toLowerCase().includes("room") ? appAssets.roommates : appAssets.logo} style={styles.infoIcon} resizeMode="contain" />
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
  content: { padding: theme.spacing.md, paddingBottom: 126, gap: theme.spacing.lg },
  hero: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.lg, gap: 8 },
  logo: { width: 150, height: 66, alignSelf: "flex-start" },
  heroTitle: { color: theme.colors.text, fontSize: 28, fontWeight: "900" },
  heroCopy: { color: theme.colors.muted, fontSize: 15, lineHeight: 21 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  tile: { width: "47%", backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.line, alignItems: "center", gap: 8 },
  tileActive: { borderColor: theme.colors.brand, backgroundColor: "#17231d" },
  iconWrap: { width: 72, height: 72, borderRadius: 20, backgroundColor: theme.colors.text, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  iconWrapActive: { borderWidth: 2, borderColor: theme.colors.brand },
  iconImage: { width: 58, height: 58 },
  label: { color: theme.colors.text, fontWeight: "900", fontSize: 16, textAlign: "center" },
  subtitle: { color: theme.colors.muted, fontWeight: "700", fontSize: 12, textAlign: "center" },
  section: { gap: theme.spacing.md },
  actionStrip: { flexDirection: "row", gap: 10 },
  actionPill: { flex: 1, backgroundColor: theme.colors.panel, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.line, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", gap: 4 },
  pillIcon: { width: 24, height: 24 },
  actionText: { color: theme.colors.text, fontWeight: "900", fontSize: 12 },
  carCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.line },
  carImage: { width: "100%", height: 160 },
  carBody: { padding: theme.spacing.md, gap: 8 },
  cardTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  cardMeta: { color: theme.colors.muted, fontSize: 15, lineHeight: 21 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  price: { color: theme.colors.green, fontSize: 18, fontWeight: "900" },
  action: { color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 9, overflow: "hidden", fontWeight: "900" },
  empty: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.lg, gap: 8, alignItems: "center" },
  emptyIcon: { width: 72, height: 72 },
  emptyTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900", textAlign: "center" },
  emptyText: { color: theme.colors.muted, lineHeight: 21, textAlign: "center" },
  infoCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, gap: 12, flexDirection: "row", alignItems: "center" },
  infoIcon: { width: 54, height: 54 },
  infoCopy: { flex: 1, gap: 5 },
  rank: { width: 38, height: 38, borderRadius: 19, overflow: "hidden", backgroundColor: theme.colors.text, color: theme.colors.bg, textAlign: "center", textAlignVertical: "center", fontWeight: "900", fontSize: 18 },
  explorerHero: { borderRadius: theme.radius.lg, backgroundColor: theme.colors.panel, borderWidth: 1, borderColor: theme.colors.line, overflow: "hidden" },
  explorerImage: { width: "100%", height: 132 },
  explorerTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900", paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md },
  explorerCopy: { color: theme.colors.muted, paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, paddingTop: 6, lineHeight: 21 }
});
