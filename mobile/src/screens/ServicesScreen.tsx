import React from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { absoluteAssetUrl } from "../api/client";
import { SectionHeader } from "../components/SectionHeader";
import { theme } from "../theme";
import { Car, ServiceItem } from "../types";

export type ServiceKey = "cars" | "deals" | "explorer" | "housing" | "local";

const tiles: Array<{ key: ServiceKey; label: string; code: string }> = [
  { key: "cars", label: "Car Rentals", code: "CR" },
  { key: "housing", label: "Housing", code: "HO" },
  { key: "explorer", label: "Explorer", code: "EX" },
  { key: "deals", label: "Deals", code: "DL" },
  { key: "local", label: "Local Services", code: "LS" }
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
      <SectionHeader eyebrow="More" title="FairFares services" />
      <View style={styles.grid}>
        {tiles.map((service) => (
          <TouchableOpacity
            key={service.key}
            style={[styles.tile, selected === service.key && styles.tileActive]}
            onPress={() => (service.key === "housing" ? onOpenHousing() : onSelect(service.key))}
          >
            <View style={[styles.icon, selected === service.key && styles.iconActive]}><Text style={styles.iconText}>{service.code}</Text></View>
            <Text style={styles.label}>{service.label}</Text>
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
      <SectionHeader eyebrow="Rentals" title="Available cars" />
      {cars.length ? (
        cars.map((car) => {
          const image = absoluteAssetUrl(car.image_url);
          return (
            <TouchableOpacity key={car.id} style={styles.carCard} onPress={() => Alert.alert(car.name, `${car.category} · ${car.location || "Location open"}`)}>
              {image ? <Image source={{ uri: image }} style={styles.carImage} /> : <View style={styles.carImageFallback}><Text style={styles.iconText}>CAR</Text></View>}
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
          <Text style={styles.emptyTitle}>No car inventory is active locally.</Text>
          <Text style={styles.emptyText}>When cars are added in the FairFares admin inventory, they will appear here from `/api/cars`.</Text>
        </View>
      )}
    </View>
  );
}

function Deals() {
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Deals" title="Current offers" />
      {["Student verification discount", "Housing match alerts", "Long-trip rental savings"].map((deal) => (
        <TouchableOpacity key={deal} style={styles.infoCard} onPress={() => Alert.alert(deal, "This offer is ready for the native deal details screen.")}>
          <Text style={styles.cardTitle}>{deal}</Text>
          <Text style={styles.cardMeta}>Tap to review eligibility and next steps.</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Explorer() {
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Explorer" title="Nearby help" />
      {["Find places near your housing search", "Compare distance from Union Station", "Explore airports, campuses, and neighborhoods"].map((item) => (
        <TouchableOpacity key={item} style={styles.infoCard} onPress={() => Alert.alert("Explorer", item)}>
          <Text style={styles.cardTitle}>{item}</Text>
          <Text style={styles.cardMeta}>Uses the same location direction as Housing map search.</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function LocalServices({ services }: { services: ServiceItem[] }) {
  return (
    <View style={styles.section}>
      <SectionHeader eyebrow="Local" title="Service directory" />
      {services.length ? (
        services.map((service) => (
          <TouchableOpacity key={service.title} style={styles.infoCard} onPress={() => Alert.alert(service.title, service.body)}>
            <Text style={styles.cardTitle}>{service.title}</Text>
            <Text style={styles.cardMeta}>{service.body}</Text>
          </TouchableOpacity>
        ))
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No services configured yet.</Text>
          <Text style={styles.emptyText}>Services from `/api/site` will appear here when configured.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.spacing.md, paddingBottom: 126, gap: theme.spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  tile: { width: "47%", backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.line, alignItems: "center", gap: 14 },
  tileActive: { borderColor: theme.colors.brand, backgroundColor: "#17231d" },
  icon: { width: 70, height: 70, borderRadius: theme.radius.md, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  iconActive: { backgroundColor: theme.colors.brand },
  iconText: { color: theme.colors.text, fontWeight: "900" },
  label: { color: theme.colors.text, fontWeight: "900", fontSize: 16, textAlign: "center" },
  section: { gap: theme.spacing.md },
  carCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.line },
  carImage: { width: "100%", height: 160 },
  carImageFallback: { height: 160, backgroundColor: theme.colors.panel2, alignItems: "center", justifyContent: "center" },
  carBody: { padding: theme.spacing.md, gap: 8 },
  cardTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  cardMeta: { color: theme.colors.muted, fontSize: 15, lineHeight: 21 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  price: { color: theme.colors.green, fontSize: 18, fontWeight: "900" },
  action: { color: theme.colors.text, borderWidth: 1, borderColor: theme.colors.blue, borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 9, overflow: "hidden", fontWeight: "900" },
  empty: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.lg, gap: 8 },
  emptyTitle: { color: theme.colors.text, fontSize: 19, fontWeight: "900" },
  emptyText: { color: theme.colors.muted, lineHeight: 21 },
  infoCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, gap: 8 }
});
