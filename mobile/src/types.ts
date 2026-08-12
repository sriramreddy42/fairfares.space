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
  photoUrl?: string;
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
  posterEmail?: string;
  posterUserId?: number;
  daysLeft: number;
  expiryLabel: string;
  roommateIntent: boolean;
  genderPreference: string;
  leaseTerm: string;
  bathroomType: string;
  accommodates: number;
  roommateCount: number;
  amenities: string[];
  sample?: boolean;
};

export type FairFaresUser = {
  id: number;
  name: string;
  email: string;
  phone: string;
  dateOfBirth?: string;
  role: string;
  isAdmin: boolean;
  isVerified: boolean;
  chatPhoneDiscoverable?: boolean;
  promotionalNotificationsEnabled?: boolean;
  profilePhotoUrl?: string;
};

export type StaffPickupBooking = {
  id: number;
  bookingId: string;
  customerName: string;
  customerEmail: string;
  carName: string;
  pickupDate: string;
  pickupTime: string;
  pickupLocation: string;
  bookingStatus: "CONFIRMED";
  paymentStatus: "HOLD_PAID" | "PAID";
  depositStatus: string;
  depositAmount: number;
};

export type ChatConversation = {
  id: string;
  communityId?: string;
  postId?: string;
  rideId?: string;
  kind?: "DIRECT" | "GROUP" | "HOST_GUEST" | "BOOKING" | "SUPPORT" | "RIDE";
  status?: string;
  subject: string;
  postTitle?: string;
  postCategory?: string;
  rideTitle?: string;
  rideType?: string;
  rideRoute?: string;
  otherName: string;
  otherUserId?: number;
  otherPhotoUrl?: string;
  otherOnline?: boolean;
  otherLastSeenAt?: string;
  lastMessageId?: number;
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
  senderPhotoUrl?: string;
  mine: boolean;
  type: string;
  text: string;
  attachmentUrl: string;
  metadata?: {
    fileName?: string;
    mimeType?: string;
    size?: number;
    question?: string;
    options?: string[];
    voteCounts?: number[];
    selectedOption?: number;
    selectedOptions?: number[];
    allowMultiple?: boolean;
    anonymous?: boolean;
    closed?: boolean;
    totalVotes?: number;
    title?: string;
    date?: string;
    time?: string;
    location?: string;
    name?: string;
    phone?: string;
    email?: string;
    encrypted?: boolean;
    kind?: "IMAGE" | "VIDEO" | "FILE";
    decryptedDataUrl?: string;
    thumbnailDataUrl?: string;
    encryptedKeyPayload?: string;
    caption?: string;
    mediaGroupId?: string;
    mediaGroupIndex?: number;
    mediaGroupCount?: number;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    expiresAt?: string;
    live?: boolean;
    stopped?: boolean;
    mediaExpired?: boolean;
    expiredAt?: string;
    deletedFromStorage?: boolean;
    retentionDays?: number;
  };
  contextType?: "HOUSING" | "CARPOOL" | string;
  contextId?: string;
  contextTitle?: string;
  contextSubtitle?: string;
  contextOwnerUserId?: number;
  contextOwnerName?: string;
  replyToMessageId?: number;
  reactions?: Array<{ emoji: string; count: number; mine: boolean }>;
  createdAt: string;
  deliveredAt: string;
  readAt: string;
  editedAt: string;
  deletedAt: string;
  canEdit: boolean;
  status: "pending" | "relayed" | "failed" | "sent" | "delivered" | "seen" | "";
  localClientMessageId?: string;
};

export type Community = {
  id: string;
  kind: "GROUP" | "COMMUNITY";
  name: string;
  description: string;
  area: string;
  photoUrl?: string;
  memberCount: number;
  joined: boolean;
  joinUrl?: string;
  visibility: "PUBLIC" | "PRIVATE";
  memberRole: "OWNER" | "ADMIN" | "MEMBER" | "";
  canManageMembers: boolean;
  virtual?: boolean;
  suggestionCity?: string;
  suggestionPurpose?: "HOUSING" | "RIDES" | "COMMUNITY" | "";
};

export type ChatGroupMember = {
  id: number;
  name: string;
  photoUrl: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  joinedAt: string;
  isCurrentUser: boolean;
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
  ownerUserId?: number;
  ownerName?: string;
  title: string;
  origin: string;
  originLat?: number | null;
  originLng?: number | null;
  destination: string;
  destinationLat?: number | null;
  destinationLng?: number | null;
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
  statusLabel?: string;
  isExpired?: boolean;
  distanceMiles: number | null;
  pickupDistanceMiles?: number | null;
  dropoffDistanceMiles?: number | null;
  routeDeviationMiles?: number | null;
  routeDeviationMinutes?: number | null;
  routeDeviationSource?: string | null;
  matchScore: number;
  createdAt: string;
  activityRole?: "MINE" | "DRIVER_NOTIFICATION";
  dispatchStatus?: string;
  dispatchNotifiedCount?: number;
  dispatchNearestRadius?: number;
  dispatchNotifiedAt?: string;
  dispatchRespondedAt?: string;
  acceptedDriverName?: string;
  acceptedDriverRideId?: string;
  acceptedVehicleNumber?: string;
  acceptedVehiclePlate?: string;
  acceptedVehicleState?: string;
  matchedRideId?: string;
  matchedRouteTitle?: string;
  matchedRouteOrigin?: string;
  matchedRouteDestination?: string;
  matchedRouteOriginLat?: number | null;
  matchedRouteOriginLng?: number | null;
  matchedRouteDestinationLat?: number | null;
  matchedRouteDestinationLng?: number | null;
  matchedContributionPerSeat?: number;
  pickupPin?: string;
  myRating?: number;
};

export type RideDispatchSummary = {
  notifiedCount: number;
  nearestRadius: number;
  radiusBuckets: Array<{
    radiusMiles: number;
    notifiedCount: number;
  }>;
};

export type RideDriverProfile = {
  exists: boolean;
  vehicleMakeModel?: string;
  vehicleYear?: string;
  vehicleColor?: string;
  licensePlate?: string;
  licenseState?: string;
  insuranceProvider?: string;
  insurancePolicyLast4?: string;
  serviceTypes: RideType[];
  availabilityDays: string[];
  availabilityStartTime?: string;
  availabilityEndTime?: string;
  seatCount?: number;
  luggageSpace?: string;
  maxDetourMinutes?: number;
  maxPickupDistanceMiles?: number;
  reviewStatus: string;
  reviewNotes?: string;
  readyForOffers: boolean;
  missing: string[];
  updatedAt?: string;
};

export type RideInput = {
  rideType: RideType;
  city: string;
  origin: string;
  originLat?: number | null;
  originLng?: number | null;
  destination: string;
  destinationLat?: number | null;
  destinationLng?: number | null;
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
  listing_source?: string;
  review_status?: string;
  available_from_date?: string;
  available_to_date?: string;
};

export type RentalCarListingInput = {
  name?: string;
  brand?: string;
  model?: string;
  year?: string;
  category?: string;
  type?: string;
  fuelType?: string;
  seats?: string;
  bags?: string;
  doors?: string;
  transmission?: string;
  dailyPrice: string;
  color?: string;
  location: string;
  licensePlate?: string;
  availableFrom?: string;
  availableTo?: string;
  features?: string;
  notes?: string;
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
  depositStatus?: string;
  depositAmount?: number;
  holdRemainingSeconds: number;
};

export type RentalServiceBooking = RentalBooking & {
  statusLabel: string;
  paymentLabel: string;
  depositLabel?: string;
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
  features: {
    chitthi: {
      maxVideoSizeMb: number;
      maxVideoSizeBytes: number;
      enableMultipartUpload: boolean;
      cryptoThrottleMs: number;
      rolloutCohort: "internal" | "enabled" | "control";
    };
  };
  dashboard: {
    housingPosts: number;
    messages: number;
  };
  hasSubmittedHousingExperience: boolean;
  testimonials: Array<{
    id: number;
    name: string;
    city: string;
    photoUrl?: string;
    avatarEmoji?: string;
    demo?: boolean;
    rating: number;
    message: string;
  }>;
};

export type HousingActivityPost = {
  id: string;
  title: string;
  status: string;
  expiryLabel: string;
  modeLabel: string;
  categoryLabel: string;
  location: string;
  rent: string;
};
