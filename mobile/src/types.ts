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
  workLocation: string;
  moveIn: string;
  rent: string;
  rentValue: number;
  radiusMiles: number;
  distanceMiles: number | null;
  lat: number;
  lng: number;
  imageUrl: string;
  images: string[];
  daysLeft: number;
  expiryLabel: string;
  roommateIntent: boolean;
  genderPreference: string;
  leaseTerm: string;
  bathroomType: string;
  accommodates: number;
  roommateCount: number;
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
  communityId?: string;
  kind?: "DIRECT" | "GROUP" | "HOST_GUEST" | "BOOKING" | "SUPPORT";
  status?: string;
  subject: string;
  otherName: string;
  otherUserId?: number;
  otherOnline?: boolean;
  otherLastSeenAt?: string;
  lastMessage: string;
  lastMessageAt: string;
  mutedAt?: string;
  blockedAt?: string;
  unread: number;
};

export type ChatMessage = {
  id: number;
  senderId: number;
  senderName: string;
  mine: boolean;
  type: string;
  text: string;
  attachmentUrl: string;
  createdAt: string;
  deliveredAt: string;
  readAt: string;
  editedAt: string;
  deletedAt: string;
  canEdit: boolean;
  status: "sent" | "delivered" | "seen" | "";
};

export type Community = {
  id: string;
  kind: "GROUP" | "COMMUNITY";
  name: string;
  description: string;
  area: string;
  memberCount: number;
  joined: boolean;
  joinUrl?: string;
};

export type ServiceItem = {
  title: string;
  body: string;
  icon: string;
  sort_order?: number;
};

export type Car = {
  id: number;
  name: string;
  brand: string;
  model: string;
  year: number | string;
  category: string;
  type: string;
  fuel_type: string;
  seats: number | string;
  bags: number | string;
  doors: number | string;
  transmission: string;
  daily_price: number | string;
  badge: string;
  features: string;
  location: string;
  image_url: string;
  booked_until_date: string;
  booked_until_time: string;
};

export type RentalBooking = {
  id: string;
  carId: number;
  carName: string;
  category: string;
  pickupLocation: string;
  pickupDate: string;
  pickupTime: string;
  returnLocation: string;
  returnDate: string;
  returnTime: string;
  days: number;
  dailyPrice: number;
  total: number;
  holdAmount: number;
  dueAtPickup: number;
  savings: number;
  status: string;
  paymentStatus: string;
  holdRemainingSeconds: number;
};

export type RentalSearchInput = {
  carId?: number;
  pickupLocation: string;
  returnLocation: string;
  pickupDate: string;
  returnDate: string;
  pickupTime: string;
  returnTime: string;
  discountCode: string;
  days?: number;
  additionalDriverRequested?: boolean;
  additionalDriverName?: string;
  additionalDriverAge?: string;
};

export type RentalQuote = {
  booking: RentalBooking;
  breakdown: {
    daily: number;
    effectiveDaily: number;
    days: number;
    standardBase: number;
    base: number;
    durationDiscountLabel: string;
    durationDiscountAmount: number;
    additionalDriverFeeAmount: number;
    taxFeeAmount: number;
    taxFeeLines: Array<{ label: string; amount: number }>;
    discountAmount: number;
    total: number;
    holdAmount: number;
    dueAtPickup: number;
    marketTotal: number;
    savings: number;
    fullPaymentTotal: number;
  };
  policy: {
    securityDepositAmount: number;
    securityDepositCopy: string;
    additionalDriverDailyFee: number;
    holdMinutes: number;
    fullPaymentDiscountAmount: number;
    cancellation: {
      day_label: string;
      cutoff_copy: string;
      day_ticks: string[];
    };
    bullets: string[];
  };
  checkoutUrl: string;
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
