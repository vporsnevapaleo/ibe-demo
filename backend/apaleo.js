const axios = require('axios');

const BASE_URL = 'https://api.apaleo.com'; // sandbox API URL

async function getAccessToken() {
  const resp = await axios.post('https://identity.apaleo.com/connect/token', null, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    params: {
      grant_type: 'client_credentials',
      client_id: process.env.APALEO_CLIENT_ID,
      client_secret: process.env.APALEO_CLIENT_SECRET,
      scope: 'inventory reservation',
    },
  });
  return resp.data.access_token;
}

async function searchOffers(date, adults) {
  const token = await getAccessToken();
  const resp = await axios.get(`${BASE_URL}/booking/v1/offers`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { arrival: date, adults },
  });
  return resp.data.offers;
}

async function createReservation(lastName, offer, pspRef) {
  const token = await getAccessToken();
  const resp = await axios.post(`${BASE_URL}/booking/v1/reservations`, {
    lastName,
    offerId: offer.id,
    pspReference: pspRef,
  }, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.data;
}

module.exports = { searchOffers, createReservation };