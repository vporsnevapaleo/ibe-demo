const axios = require('axios');

const API_BASE_URL = 'https://api.apaleo.com';
const IDENTITY_URL = 'https://identity.apaleo.com/connect/token';
const DEFAULT_CHANNEL_CODE = 'Ibe';

/**
 * Requests an OAuth access token for apaleo using client credentials.
 *
 * This demo uses a machine-to-machine flow:
 * - frontend never talks to apaleo directly
 * - backend gets a token
 * - backend calls apaleo APIs
 */
async function getAccessToken() {
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', process.env.APALEO_CLIENT_ID);
  params.append('client_secret', process.env.APALEO_CLIENT_SECRET);

  const response = await axios.post(IDENTITY_URL, params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  return response.data.access_token;
}

/**
 * Small helper for authenticated apaleo API calls.
 *
 * It keeps the public functions below a bit easier to read.
 */
async function getAuthHeaders() {
  const accessToken = await getAccessToken();

  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

/**
 * Loads all properties available to the connected apaleo account.
 *
 * The frontend uses this to populate the property selector dynamically.
 */
async function getProperties() {
  const headers = await getAuthHeaders();

  const response = await axios.get(`${API_BASE_URL}/inventory/v1/properties`, {
    headers,
  });

  return response.data.properties || [];
}

/**
 * Searches bookable offers for a selected property and stay period.
 *
 * This is the first real booking step of the IBE flow:
 * property -> stay dates -> guests -> offers
 */
async function searchOffers({ propertyId, arrival, departure, adults }) {
    const headers = await getAuthHeaders();
  
    const response = await axios.get(`${API_BASE_URL}/booking/v1/offers`, {
      headers,
      params: {
        propertyId,
        arrival,
        departure,
        adults,
        channelCode: DEFAULT_CHANNEL_CODE,
      },
    });
  
    return response.data.offers || [];
  }

/**
 * Maps the guest form into the basic apaleo guest shape used for:
 * - booker
 * - primaryGuest
 */
function buildGuestProfile(guest) {
  return {
    firstName: guest.firstName || undefined,
    lastName: guest.lastName,
    email: guest.email || undefined,
    phone: guest.phone || undefined,
  };
}

/**
 * Builds one reservation object from the selected offer.
 *
 * Important idea:
 * - searchCriteria provides the stay dates and guest count
 * - offer provides pricing / guarantee / rate-plan information
 * - guest provides traveler details
 *
 * This base version supports a single-reservation booking.
 */
function buildReservationFromOffer({ offer, searchCriteria, guest }) {
  return {
    arrival: searchCriteria.arrival,
    departure: searchCriteria.departure,
    adults: Number(searchCriteria.adults),
    channelCode: DEFAULT_CHANNEL_CODE,
    primaryGuest: buildGuestProfile(guest),
    guaranteeType: offer.minGuaranteeType || undefined,
    timeSlices: (offer.timeSlices || []).map((timeSlice) => ({
      ratePlanId: timeSlice.ratePlan?.id || offer.ratePlan?.id,
    })),
    prePaymentAmount: offer.prePaymentAmount
      ? {
          amount: offer.prePaymentAmount.amount,
          currency: offer.prePaymentAmount.currency,
        }
      : undefined,
  };
}

/**
 * Builds the apaleo booking payload.
 *
 * The most important field here is transactionReference:
 * it must be the Adyen PSP reference returned from the payment authorization.
 */
function buildBookingPayload({ offer, searchCriteria, guest, pspReference }) {
  return {
    booker: buildGuestProfile(guest),
    reservations: [
      buildReservationFromOffer({
        offer,
        searchCriteria,
        guest,
      }),
    ],
    transactionReference: pspReference,
  };
}

/**
 * Extracts Apaleo reservationId to add paymentAccount.
 */
function extractFirstReservationId(booking) {
  if (!Array.isArray(booking.reservationIds)) {
    return null;
  }

  const firstReservation = booking.reservationIds[0];

  if (!firstReservation) {
    return null;
  }

  if (typeof firstReservation === 'string') {
    return firstReservation;
  }

  return firstReservation.id || null;
}

/**
 * Creates paymentAccount on a reservation with PSP reference as a transactionReference.
 */
async function createPaymentAccountByAuthorization({
  reservationId,
  pspReference,
}) {
  const headers = await getAuthHeaders();

  const payload = {
    target: {
      type: 'Reservation',
      id: reservationId,
    },
    transactionReference: pspReference,
  };

  const response = await axios.post(
    `${API_BASE_URL}/booking/v1/payment-accounts/by-authorization`,
    payload,
    {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    paymentAccount: response.data,
    payload,
  };
}

/**
 * Creates a booking in apaleo.
 *
 * The selected offer is transformed into a booking payload,
 * then posted to Booking API.
 */
async function createBooking({ offer, searchCriteria, guest, pspReference }) {
  const headers = await getAuthHeaders();

  const payload = buildBookingPayload({
    offer,
    searchCriteria,
    guest,
    pspReference,
  });

  const response = await axios.post(
    `${API_BASE_URL}/booking/v1/bookings`,
    payload,
    {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    booking: response.data,
    payload,
  };
}

async function createBookingWithPaymentAccount({
  offer,
  searchCriteria,
  guest,
  pspReference,
}) {
  const bookingResult = await createBooking({
    offer,
    searchCriteria,
    guest,
    pspReference,
  });
  
  const reservationId = extractFirstReservationId(bookingResult.booking);

  if (!reservationId) {
    throw new Error('Booking was created, but no reservation ID was returned.');
  }

  const paymentAccountResult = await createPaymentAccountByAuthorization({
    reservationId,
    pspReference,
  });

  return {
    booking: bookingResult.booking,
    bookingPayload: bookingResult.payload,
    reservationId,
    paymentAccount: paymentAccountResult.paymentAccount,
    paymentAccountPayload: paymentAccountResult.payload,
  };
}

module.exports = {
  getProperties,
  searchOffers,
  createBookingWithPaymentAccount,
  buildBookingPayload,
};