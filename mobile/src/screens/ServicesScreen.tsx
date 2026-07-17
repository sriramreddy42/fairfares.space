import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, ImageBackground, ImageSourcePropType, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
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

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIsoDate() {
  return isoDateFromNow(0);
}

function dateOptionsFromToday(count = 90) {
  return Array.from({ length: count }, (_, index) => isoDateFromNow(index));
}

function formatDateLabel(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateText || "Choose date";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const renterAgeOptions = ["21-24", "25+"];
const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  const date = new Date(`2026-01-01T${String(hour).padStart(2, "0")}:${minute}:00`);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
});

function timeTextToMinutes(timeText: string) {
  const match = String(timeText || "10:00 AM").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 600;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function minimumPickupTimeToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() === 0 ? 0 : 60, 0, 0);
  return now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function firstAllowedPickupTime(pickupDate: string) {
  if (pickupDate !== todayIsoDate()) return timeOptions[0];
  const minimum = timeTextToMinutes(minimumPickupTimeToday());
  return timeOptions.find((time) => timeTextToMinutes(time) >= minimum) || timeOptions[timeOptions.length - 1];
}

function rentalDays(search: RentalSearchInput) {
  const pickup = new Date(`${search.pickupDate}T00:00:00`);
  const dropoff = new Date(`${search.returnDate}T00:00:00`);
  const diff = Math.ceil((dropoff.getTime() - pickup.getTime()) / 86400000);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

function durationRateTier(days: number) {
  if (days >= 30) return { rate: 0.3, label: "Monthly rate" };
  if (days >= 7) return { rate: 0.15, label: "Weekly rate" };
  return { rate: 0, label: "Standard rate" };
}

function rentalLengthText(days: number) {
  if (days <= 0) return "Choose valid dates";
  if (days >= 30) {
    const months = days / 30;
    return `${days} days · about ${Number.isInteger(months) ? months : months.toFixed(1)} months`;
  }
  return `${days} days`;
}

function dailyPriceRange(price: number | string, days: number) {
  const daily = Number(price || 0);
  const average = Math.round(daily);
  const baseLow = Math.max(25, average - 5);
  const baseHigh = Math.max(baseLow, average + 5);
  const tier = durationRateTier(days);
  const low = Math.max(25, Math.round(baseLow * (1 - tier.rate)));
  const high = Math.max(low, Math.round(baseHigh * (1 - tier.rate)));
  return { low, high, tier };
}

const initialRentalSearch: RentalSearchInput = {
  pickupLocation: "Denver International Airport (DEN)",
  returnLocation: "Denver International Airport (DEN)",
  pickupDate: isoDateFromNow(6),
  returnDate: isoDateFromNow(9),
  pickupTime: "10:00 AM",
  returnTime: "10:00 AM",
  renterAge: "25+",
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
  const [rentalPicker, setRentalPicker] = useState<null | "pickupDate" | "returnDate" | "pickupTime" | "returnTime" | "renterAge">(null);
  const rows = visibleCars.length ? visibleCars : cars;
  const cheapest = [...cars].filter((car) => Number(car.daily_price) > 0).sort((a, b) => Number(a.daily_price) - Number(b.daily_price))[0];
  const heroImage = absoluteAssetUrl(cheapest?.image_url || "");
  const heroSource = heroImage ? { uri: heroImage } : appAssets.carFallback;
  const pickupLocations = useMemo(() => Array.from(new Set(cars.map((car) => car.location).filter(Boolean))).slice(0, 4), [cars]);
  const calendarDates = useMemo(() => dateOptionsFromToday(90), []);
  const rentalDayCount = rentalDays(search);
  const rentalTier = durationRateTier(rentalDayCount);

  useEffect(() => {
    setVisibleCars(cars);
  }, [cars]);

  function updateSearch(key: keyof RentalSearchInput, value: string | boolean) {
    setSearch((current) => {
      const next = { ...current, [key]: value };
      if (key === "pickupLocation" && !current.returnLocation) {
        next.returnLocation = String(value);
      }
      if (key === "pickupDate" && typeof value === "string" && current.returnDate <= value) {
        next.returnDate = addDays(value, 1);
      }
      if ((key === "pickupDate" || key === "pickupTime") && next.pickupDate === todayIsoDate()) {
        const minimum = firstAllowedPickupTime(next.pickupDate);
        if (timeTextToMinutes(String(next.pickupTime)) < timeTextToMinutes(minimum)) {
          next.pickupTime = minimum;
        }
      }
      if (key === "returnDate" && typeof value === "string" && value <= current.pickupDate) {
        next.returnDate = addDays(current.pickupDate, 1);
      }
      return next;
    });
  }

  function selectRentalPickerValue(value: string) {
    if (!rentalPicker) return;
    updateSearch(rentalPicker, value);
    setRentalPicker(null);
  }

  function renderPickerModal() {
    const isDatePicker = rentalPicker === "pickupDate" || rentalPicker === "returnDate";
    const isTimePicker = rentalPicker === "pickupTime" || rentalPicker === "returnTime";
    const title =
      rentalPicker === "pickupDate" ? "Pick-up date" :
      rentalPicker === "returnDate" ? "Return date" :
      rentalPicker === "pickupTime" ? "Pick-up time" :
      rentalPicker === "returnTime" ? "Return time" :
      rentalPicker === "renterAge" ? "Renter age" : "";
    const values = isDatePicker ? calendarDates : isTimePicker ? timeOptions : renterAgeOptions;
    const activeValue = rentalPicker ? String(search[rentalPicker] || "") : "";

    return (
      <Modal visible={Boolean(rentalPicker)} transparent animationType="fade" onRequestClose={() => setRentalPicker(null)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{title}</Text>
              <TouchableOpacity style={styles.pickerClose} onPress={() => setRentalPicker(null)}>
                <Text style={styles.pickerCloseText}>X</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={isDatePicker ? styles.calendarGrid : styles.pickerList}>
              {values.map((value) => {
                const disabled = rentalPicker === "returnDate" && value <= search.pickupDate;
                const timeDisabled = rentalPicker === "pickupTime"
                  && search.pickupDate === todayIsoDate()
                  && timeTextToMinutes(value) < timeTextToMinutes(minimumPickupTimeToday());
                const selected = value === activeValue;
                return (
                  <TouchableOpacity
                    key={value}
                    disabled={disabled || timeDisabled}
                    style={[
                      isDatePicker ? styles.calendarCell : styles.pickerOption,
                      selected && styles.pickerOptionActive,
                      (disabled || timeDisabled) && styles.pickerOptionDisabled
                    ]}
                    onPress={() => selectRentalPickerValue(value)}
                  >
                    <Text style={[styles.pickerOptionText, selected && styles.pickerOptionTextActive, (disabled || timeDisabled) && styles.pickerOptionTextDisabled]}>
                      {isDatePicker ? formatDateLabel(value) : value}
                    </Text>
                    {isDatePicker ? <Text style={styles.calendarDateText}>{value.slice(5)}</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
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
              <Text style={styles.ratePrice}>
                {cheapest ? `$${dailyPriceRange(cheapest.daily_price, rentalDayCount).low}-${dailyPriceRange(cheapest.daily_price, rentalDayCount).high}` : "$29-39"}
              </Text>
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
            <TouchableOpacity style={styles.selectInput} onPress={() => setRentalPicker("pickupDate")}>
              <Text style={styles.selectValue}>{formatDateLabel(search.pickupDate)}</Text>
              <Text style={styles.selectMeta}>{search.pickupDate}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.twoColField}>
            <Text style={styles.fieldLabel}>Return date</Text>
            <TouchableOpacity style={styles.selectInput} onPress={() => setRentalPicker("returnDate")}>
              <Text style={styles.selectValue}>{formatDateLabel(search.returnDate)}</Text>
              <Text style={styles.selectMeta}>{search.returnDate}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.twoCol}>
          <View style={styles.twoColField}>
            <Text style={styles.fieldLabel}>Pickup time</Text>
            <TouchableOpacity style={styles.selectInput} onPress={() => setRentalPicker("pickupTime")}>
              <Text style={styles.selectValue}>{search.pickupTime}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.twoColField}>
            <Text style={styles.fieldLabel}>Return time</Text>
            <TouchableOpacity style={styles.selectInput} onPress={() => setRentalPicker("returnTime")}>
              <Text style={styles.selectValue}>{search.returnTime}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.twoCol}>
          <View style={styles.twoColField}>
            <Text style={styles.fieldLabel}>Renter age</Text>
            <TouchableOpacity style={styles.selectInput} onPress={() => setRentalPicker("renterAge")}>
              <Text style={styles.selectValue}>{search.renterAge || "25+"}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.twoColField}>
            <Text style={styles.fieldLabel}>Rental length</Text>
            <View style={styles.estimateBox}>
              <Text style={styles.estimateValue}>{rentalLengthText(rentalDayCount)}</Text>
              <Text style={styles.estimateMeta}>{rentalTier.label}</Text>
            </View>
          </View>
        </View>
        <View style={styles.rateNote}>
          <Text style={styles.rateNoteTitle}>{rentalTier.label}</Text>
          <Text style={styles.rateNoteText}>
            {rentalTier.rate > 0
              ? `${Math.round(rentalTier.rate * 100)}% duration savings are reflected in the daily ranges below.`
              : "Daily ranges apply for 1-6 day rentals. Weekly starts at 7 days; monthly starts at 30 days."}
          </Text>
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
                <Text style={styles.price}>${dailyPriceRange(car.daily_price, rentalDayCount).low}-${dailyPriceRange(car.daily_price, rentalDayCount).high}/day</Text>
                <Text style={styles.action}>{selectedCar?.id === car.id ? "Reviewing" : "Review"}</Text>
              </View>
              {dailyPriceRange(car.daily_price, rentalDayCount).tier.rate > 0 ? (
                <Text style={styles.savingsText}>{dailyPriceRange(car.daily_price, rentalDayCount).tier.label}: save vs daily pricing</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
      {renderPickerModal()}
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
  selectInput: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: theme.radius.md, minHeight: 56, paddingHorizontal: 13, paddingVertical: 9, justifyContent: "center" },
  selectValue: { color: theme.colors.text, fontSize: 15, fontWeight: "900" },
  selectMeta: { color: theme.colors.muted, fontSize: 11, fontWeight: "800", marginTop: 2 },
  estimateBox: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: theme.radius.md, minHeight: 56, paddingHorizontal: 13, paddingVertical: 9, justifyContent: "center" },
  estimateValue: { color: theme.colors.text, fontWeight: "900", fontSize: 14 },
  estimateMeta: { color: theme.colors.green, fontWeight: "900", fontSize: 12, marginTop: 2 },
  rateNote: { borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "rgba(40,82,255,0.10)", borderRadius: theme.radius.md, padding: 12, gap: 3 },
  rateNoteTitle: { color: theme.colors.text, fontWeight: "900" },
  rateNoteText: { color: theme.colors.muted, fontSize: 12, lineHeight: 17, fontWeight: "800" },
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
  savingsText: { color: theme.colors.soft, fontSize: 12, fontWeight: "800", marginTop: 3 },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.68)", padding: theme.spacing.md, justifyContent: "center" },
  pickerCard: { maxHeight: "78%", backgroundColor: "rgba(24,24,27,0.96)", borderRadius: 28, borderWidth: 1, borderColor: "rgba(255,255,255,0.16)", padding: theme.spacing.md, gap: theme.spacing.md },
  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pickerTitle: { color: theme.colors.text, fontSize: 24, fontWeight: "900" },
  pickerClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  pickerCloseText: { color: theme.colors.text, fontWeight: "900" },
  pickerList: { gap: 8 },
  pickerOption: { minHeight: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 14, justifyContent: "center" },
  pickerOptionActive: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
  pickerOptionDisabled: { opacity: 0.35 },
  pickerOptionText: { color: theme.colors.text, fontSize: 16, fontWeight: "900" },
  pickerOptionTextActive: { color: theme.colors.bg },
  pickerOptionTextDisabled: { color: theme.colors.muted },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  calendarCell: { width: "31%", minHeight: 66, borderRadius: theme.radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.06)", padding: 8, justifyContent: "center" },
  calendarDateText: { color: theme.colors.muted, fontSize: 11, marginTop: 3, fontWeight: "800" },
  infoCard: { backgroundColor: theme.colors.panel, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.line, padding: theme.spacing.md, gap: 12, flexDirection: "row", alignItems: "center" },
  infoIcon: { width: 48, height: 48 },
  infoCopy: { flex: 1, gap: 5 }
});
