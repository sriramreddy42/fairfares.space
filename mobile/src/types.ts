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
  posterName?: string;
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

export type RideType = "SCHEDULED_REQUEST" | "GENERAL_REQUEST" | "CARPOOL_REQUEST" | "CARPOOL_OFFER";

export type RidePost = {
  id: string;
  type: RideType;
  typeLabel: string;
  role: "RIDER" | "DRIVER";
  title: string;
  origin: string;
  destination: string;
  city: string;
  pickupDate: string;
  pickupTime: string;
  startDate: string;
  endDate: string;
  daysOfWeek: string[];
  seats: number;
  luggage: string;
  accessibility: string;
  maxDetourMinutes: number;
  maxPickupDistanceMiles: number;
  departureFlexMinutes: number;
  contributionPerSeat: number;
  approvalRequired: boolean;
  preferences: string;
  notes: string;
  status: string;
  distanceMiles: number | null;
  matchScore: number;
  createdAt: string;
};

export type RideDispatchSummary = {
  notifiedCount: number;
  nearestRadius: number;
  radiusBuckets: Array<{
    radiusMiles: number;
    notifiedCount: number;
  }>;
};

export type RideInput = {
  rideType: RideType;
  city: string;
  origin: string;
  destination: string;
  pickupDate: string;
  pickupTime: string;
  startDate: string;
  endDate: string;
  daysOfWeek: string[];
  seats: string;
  luggage: string;
  accessibility: string;
  maxDetourMinutes: string;
  maxPickupDistanceMiles: string;
  departureFlexMinutes: string;
  contributionPerSeat: string;
  approvalRequired: boolean;
  preferences: string;
  notes: string;
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

export type RentalServiceBooking = RentalBooking & {
  statusLabel: string;
  paymentLabel: string;
  totalLabel: string;
  dueNowLabel: string;
  dueAtPickupLabel: string;
  invoiceNumber: string;
  invoiceUrl: string;
  manageUrl: string;
  locations?: string[];
  upgradeOptions?: Array<{
    id: number;
    name: string;
    category: string;
    dailyRange: string;
    estimatedTotalLabel: string;
  }>;
  refund?: {
    amount: number;
    amountLabel: string;
    note: string;
  };
  documents?: Array<{
    id: number;
    bookingId: string;
    vehicle: string;
    dates: string;
    status: string;
    statusLabel: string;
    locked: boolean;
    lockMessage: string;
    docs: Record<string, { title: string; body: string; status: string }>;
  }>;
  documentsLocked?: boolean;
  documentsLockedMessage?: string;
  liveStatus?: {
    title: string;
    body: string;
    instructions: string;
    days: string;
    hours: string;
    mins: string;
    secs: string;
  };
  student?: {
    email: string;
    id: string;
    verified: boolean;
    statusLabel: string;
    discountLabel: string;
  };
  stats?: {
    upcoming: number;
    past: number;
    saved: number;
    housingActive: number;
    housingExpired: number;
    supportOpen: number;
  };
  housingPosts?: Array<{
    id: string;
    title: string;
    status: string;
    expiryLabel: string;
    modeLabel: string;
    categoryLabel: string;
    location: string;
    rent: string;
  }>;
  supportTickets?: Array<{
    ticketId: string;
    topic: string;
    status: string;
    priority: string;
    bookingId: string;
  }>;
};

export type RentalSearchInput = {
  carId?: number;
  pickupLocation: string;
  returnLocation: string;
  pickupDate: string;
  returnDate: string;
  pickupTime: string;
  returnTime: string;
  renterAge?: string;
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
