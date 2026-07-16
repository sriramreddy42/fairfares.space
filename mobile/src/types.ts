export type HousingPost = {
  id: string;
  title: string;
  description: string;
  mode: string;
  modeLabel: string;
  category: string;
  categoryLabel: string;
  location: string;
  area: string;
  moveIn: string;
  rent: string;
  rentValue: number;
  radiusMiles: number;
  imageUrl: string;
  daysLeft: number;
  expiryLabel: string;
  roommateIntent: boolean;
  genderPreference: string;
  amenities: string[];
};

export type FairFaresUser = {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: string;
  isAdmin: boolean;
  isVerified: boolean;
};

export type ChatConversation = {
  id: string;
  subject: string;
  otherName: string;
  lastMessage: string;
  unread: number;
};

export type Community = {
  id: string;
  kind: "GROUP" | "COMMUNITY";
  name: string;
  description: string;
  area: string;
  memberCount: number;
  joined: boolean;
};

export type BootstrapPayload = {
  ok: boolean;
  user: FairFaresUser | null;
  location: {
    city: string;
    selected: string;
    suggested: string;
  };
  housing: HousingPost[];
  communities: Community[];
  chat: {
    unreadCount: number;
    conversations: ChatConversation[];
  };
  dashboard: {
    housingPosts: number;
    messages: number;
  };
};
