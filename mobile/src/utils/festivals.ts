import { ImageSourcePropType } from "react-native";
import { appAssets } from "../assets";

export type FestivalCampaign = {
  slug: string;
  name: string;
  date: Date;
  endDate: Date;
  poster: ImageSourcePropType;
};

type FestivalDate = { month: number; day: number };

const movingDates: Record<number, Record<string, FestivalDate>> = {
  2026: {
    holi: { month: 3, day: 4 },
    rakshaBandhan: { month: 8, day: 28 },
    navratri: { month: 10, day: 11 },
    diwali: { month: 11, day: 8 },
    makarSankranti: { month: 1, day: 14 }
  },
  2027: {
    holi: { month: 3, day: 22 },
    rakshaBandhan: { month: 8, day: 17 },
    navratri: { month: 9, day: 30 },
    diwali: { month: 10, day: 29 },
    makarSankranti: { month: 1, day: 15 }
  },
  2028: {
    holi: { month: 3, day: 11 },
    rakshaBandhan: { month: 8, day: 5 },
    navratri: { month: 9, day: 19 },
    diwali: { month: 10, day: 17 },
    makarSankranti: { month: 1, day: 15 }
  },
  2029: {
    holi: { month: 3, day: 1 },
    rakshaBandhan: { month: 8, day: 23 },
    navratri: { month: 10, day: 8 },
    diwali: { month: 11, day: 5 },
    makarSankranti: { month: 1, day: 14 }
  },
  2030: {
    holi: { month: 3, day: 20 },
    rakshaBandhan: { month: 8, day: 13 },
    navratri: { month: 9, day: 28 },
    diwali: { month: 10, day: 26 },
    makarSankranti: { month: 1, day: 14 }
  }
};

function localDate(year: number, value: FestivalDate) {
  return new Date(year, value.month - 1, value.day, 12, 0, 0, 0);
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function campaignsForYear(year: number): FestivalCampaign[] {
  const moving = movingDates[year] || {};
  const rows: Array<{ slug: string; name: string; value?: FestivalDate; poster: ImageSourcePropType; duration?: number }> = [
    { slug: "makar-sankranti", name: "Makar Sankranti", value: moving.makarSankranti, poster: appAssets.festivals.makarSankranti },
    { slug: "republic-day", name: "Republic Day", value: { month: 1, day: 26 }, poster: appAssets.festivals.republicDay },
    { slug: "holi", name: "Holi", value: moving.holi, poster: appAssets.festivals.holi },
    { slug: "independence-day", name: "Independence Day", value: { month: 8, day: 15 }, poster: appAssets.festivals.independenceDay },
    { slug: "raksha-bandhan", name: "Raksha Bandhan", value: moving.rakshaBandhan, poster: appAssets.festivals.rakshaBandhan },
    { slug: "navratri", name: "Navratri", value: moving.navratri, poster: appAssets.festivals.navratri, duration: 9 },
    { slug: "diwali", name: "Diwali", value: moving.diwali, poster: appAssets.festivals.diwali },
    { slug: "christmas", name: "Christmas", value: { month: 12, day: 25 }, poster: appAssets.festivals.christmas }
  ];
  return rows.filter((row) => row.value).map((row) => {
    const date = localDate(year, row.value!);
    return { slug: row.slug, name: row.name, date, endDate: addDays(date, (row.duration || 1) - 1), poster: row.poster };
  });
}

export function activeFestivalCampaign(now = new Date()): FestivalCampaign | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const candidates = [...campaignsForYear(now.getFullYear() - 1), ...campaignsForYear(now.getFullYear()), ...campaignsForYear(now.getFullYear() + 1)];
  return candidates.find((campaign) => {
    const visibleFrom = addDays(campaign.date, -3);
    const visibleUntil = addDays(campaign.endDate, 1);
    return today >= visibleFrom && today <= visibleUntil;
  }) || null;
}
