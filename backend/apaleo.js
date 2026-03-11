const axios = require('axios');

const API_BASE_URL = 'https://api.apaleo.com';
const IDENTITY_URL = 'https://identity.apaleo.com/connect/token';

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
        channelCode: 'Ibe',
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
    channelCode: 'Ibe',

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

module.exports = {
  getProperties,
  searchOffers,
  createBooking,
  buildBookingPayload,
};