require('dotenv').config();

const express = require('express');
const path = require('path');

const apaleo = require('./apaleo');
const adyen = require('./adyen');

const app = express();
const PORT = process.env.PORT || 3000;

// -----------------------------------------------------------------------------
// App setup
// -----------------------------------------------------------------------------

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

/**
 * Returns the current public origin of the app.
 *
 * Locally this becomes something like:
 * http://localhost:3000
 *
 * In production it becomes your deployed domain.
 */
function getRequestOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * Normalizes errors coming from axios / Adyen SDK / plain JS errors.
 * This keeps API responses consistent and easier to debug.
 */
function getErrorDetails(error) {
  return (
    error.response?.data ||
    error.response?.body ||
    error.message ||
    'Unknown error'
  );
}

/**
 * Sends a consistent JSON error response and logs the original error.
 */
function sendErrorResponse(res, label, error, statusCode = 500) {
  console.error(`${label}:`);
  console.error(getErrorDetails(error));

  res.status(statusCode).send({
    error: label,
    details: getErrorDetails(error),
  });
}

// -----------------------------------------------------------------------------
// Health and frontend config
// -----------------------------------------------------------------------------

/**
 * Simple health endpoint for local testing and deployment checks.
 */
app.get('/api/health', (req, res) => {
  res.send({ ok: true });
});

/**
 * Returns safe frontend config.
 *
 * Important:
 * - clientKey is safe for the browser
 * - API keys and client secrets must never be sent to the frontend
 */
app.get('/api/config', (req, res) => {
  res.send({
    adyenClientKey: process.env.ADYEN_CLIENT_KEY,
    adyenEnvironment:
      String(process.env.ADYEN_ENVIRONMENT || 'TEST').toLowerCase() === 'live'
        ? 'live'
        : 'test',
  });
});

// -----------------------------------------------------------------------------
// apaleo routes
// -----------------------------------------------------------------------------

/**
 * Loads all properties available to the connected apaleo account.
 * Used to populate the property selector in the frontend.
 */
app.get('/api/properties', async (req, res) => {
  console.log('GET /api/properties');

  try {
    const properties = await apaleo.getProperties();

    res.send({
      success: true,
      properties,
    });
  } catch (error) {
    sendErrorResponse(res, 'Property loading failed', error);
  }
});

/**
 * Searches offers for the selected property and stay details.
 */
app.post('/api/offers/search', async (req, res) => {
  console.log('POST /api/offers/search');
  console.log('Request body:', req.body);

  try {
    const { propertyId, arrival, departure, adults } = req.body;

    if (!propertyId || !arrival || !departure || !adults) {
      return res.status(400).send({
        error: 'Missing required fields: propertyId, arrival, departure, adults',
      });
    }

    const offers = await apaleo.searchOffers({
      propertyId,
      arrival,
      departure,
      adults: Number(adults),
    });

    res.send({
      success: true,
      offers,
    });
  } catch (error) {
    sendErrorResponse(res, 'Offer search failed', error);
  }
});

/**
 * Creates a booking & paymentAccount in apaleo after payment authorization succeeded.
 *
 * The frontend sends:
 * - the selected offer
 * - the original search criteria
 * - the guest details
 * - the Adyen PSP reference
 * - paymentAccount
 *
 * That PSP reference becomes transactionReference in the booking payload.
 */
app.post('/api/bookings/create', async (req, res) => {
  console.log('POST /api/bookings/create');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  try {
    const { offer, searchCriteria, guest, pspReference } = req.body;

    if (!offer || !searchCriteria || !guest || !pspReference) {
      return res.status(400).send({
        error: 'Missing required fields: offer, searchCriteria, guest, pspReference',
      });
    }

    const result = await apaleo.createBookingWithPaymentAccount({
      offer,
      searchCriteria,
      guest,
      pspReference,
    });

    res.send({
      success: true,
      booking: result.booking,
      bookingPayload: result.bookingPayload,
      reservationId: result.reservationId,
      paymentAccount: result.paymentAccount,
      paymentAccountPayload: result.paymentAccountPayload,
    });
  } catch (error) {
    sendErrorResponse(res, 'Booking creation failed', error);
  }
});

// -----------------------------------------------------------------------------
// Adyen routes
// -----------------------------------------------------------------------------

/**
 * Loads available Adyen payment methods for Drop-in.
 * The frontend uses this response to render card payment UI.
 */
app.post('/api/paymentMethods', async (req, res) => {
  console.log('POST /api/paymentMethods');
  console.log('Request body:', req.body);

  try {
    const { amount, countryCode, shopperLocale } = req.body;

    const paymentMethods = await adyen.getPaymentMethods({
      amount,
      countryCode,
      shopperLocale,
    });

    res.send(paymentMethods);
  } catch (error) {
    sendErrorResponse(res, 'Loading payment methods failed', error);
  }
});

/**
 * Creates an Adyen payment.
 *
 * This is the main authorization step:
 * - frontend collects encrypted card data through Drop-in
 * - backend sends payment request to Adyen
 * - Adyen returns a PSP reference
 *
 * That PSP reference is later used in the apaleo booking request.
 */
app.post('/api/payments', async (req, res) => {
  console.log('POST /api/payments');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  try {
    const {
      amount,
      paymentMethod,
      browserInfo,
      guest,
      reference,
      propertyId,
      deliveryDate,
    } = req.body;

    const paymentResponse = await adyen.makePayment({
      amount,
      paymentMethod,
      browserInfo,
      reference,
      propertyId,
      deliveryDate,
      shopperEmail: guest?.email || undefined,
      shopperReference: guest?.email || guest?.lastName || 'ibe-demo-shopper',
      returnUrl: `${getRequestOrigin(req)}/`,
    });

    res.send(paymentResponse);
  } catch (error) {
    sendErrorResponse(res, 'Payment failed', error);
  }
});

/**
 * Completes redirect-based payments such as 3DS flows.
 *
 * After the shopper returns to the site, the frontend sends redirectResult
 * to this endpoint, and Adyen returns the final payment result.
 */
app.post('/api/payments/details', async (req, res) => {
  console.log('POST /api/payments/details');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  try {
    const detailsResponse = await adyen.submitAdditionalDetails(req.body.details);
    res.send(detailsResponse);
  } catch (error) {
    sendErrorResponse(res, 'Submitting payment details failed', error);
  }
});

// -----------------------------------------------------------------------------
// Server start
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});