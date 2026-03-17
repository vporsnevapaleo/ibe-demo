// -----------------------------------------------------------------------------
// DOM references
// -----------------------------------------------------------------------------

const searchForm = document.getElementById('search-form');
const offersContainer = document.getElementById('offers');
const propertySelect = document.getElementById('property-select');

const guestSection = document.getElementById('guest-section');
const guestForm = document.getElementById('guest-form');

const paymentSection = document.getElementById('payment-section');
const paymentSummary = document.getElementById('payment-summary');
const paymentResult = document.getElementById('payment-result');
const dropinContainer = document.getElementById('dropin-container');

// -----------------------------------------------------------------------------
// Frontend state
// -----------------------------------------------------------------------------

let selectedOffer = null;
let searchCriteria = null;
let guestDetails = null;

let adyenCheckoutInstance = null;
let dropinInstance = null;

let latestPspReference = null;
let latestPaymentResult = null;
let bookingCreationInProgress = false;

// -----------------------------------------------------------------------------
// App startup
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  restoreCheckoutState();
  await loadProperties();
  await handleRedirectReturnIfNeeded();
});

// -----------------------------------------------------------------------------
// Step 1 - Search offers
// -----------------------------------------------------------------------------

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(searchForm);

  searchCriteria = {
    propertyId: formData.get('propertyId'),
    arrival: formData.get('arrival'),
    departure: formData.get('departure'),
    adults: Number(formData.get('adults')),
  };

  // Reset checkout state when a new search starts
  selectedOffer = null;
  guestDetails = null;
  latestPspReference = null;
  latestPaymentResult = null;
  bookingCreationInProgress = false;

  hideGuestStep();
  hidePaymentStep();

  offersContainer.innerHTML = '<p>Loading offers...</p>';

  try {
    const response = await fetch('/api/offers/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(searchCriteria),
    });

    const rawText = await response.text();
    const json = parseJsonOrThrow(rawText, response.status);

    if (!response.ok) {
      throw new Error(JSON.stringify(json.details || json.error || json, null, 2));
    }

    renderOffers(json.offers || []);
  } catch (error) {
    offersContainer.innerHTML = `
      <pre>Error loading offers:
${escapeHtml(error.message)}</pre>
    `;
  }
});

// -----------------------------------------------------------------------------
// Step 2 - Restore redirect-based payments (3DS / challenge flows)
// -----------------------------------------------------------------------------

async function handleRedirectReturnIfNeeded() {
  const url = new URL(window.location.href);
  const redirectResult = url.searchParams.get('redirectResult');

  if (!redirectResult) {
    return;
  }

  paymentSection.style.display = 'block';
  paymentResult.innerHTML = '<p>Finalizing redirected payment...</p>';

  try {
    const response = await fetch('/api/payments/details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        details: { redirectResult },
      }),
    });

    const rawText = await response.text();
    const json = parseJsonOrThrow(rawText, response.status);

    if (!response.ok) {
      throw new Error(JSON.stringify(json.details || json.error || json, null, 2));
    }

    if (searchCriteria && guestDetails && selectedOffer) {
      renderPaymentSummary();
    }

    await renderPaymentResult(json);

    // Remove redirectResult from the URL so a refresh does not repeat the flow
    url.searchParams.delete('redirectResult');
    window.history.replaceState({}, '', url.pathname + url.search);

    paymentSection.scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    paymentResult.innerHTML = `
      <pre>Redirect payment finalization error:
${escapeHtml(error.message)}</pre>
    `;
  }
}

// -----------------------------------------------------------------------------
// Step 3 - Guest details
// -----------------------------------------------------------------------------

guestForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(guestForm);

  guestDetails = {
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
  };

  saveCheckoutState();

  try {
    await showPaymentStep();
  } catch (error) {
    console.error('showPaymentStep failed:', error);

    paymentSection.style.display = 'block';
    paymentResult.innerHTML = `
      <pre>Payment setup error:
${escapeHtml(error.message)}</pre>
    `;
  }
});

// -----------------------------------------------------------------------------
// Properties
// -----------------------------------------------------------------------------

async function loadProperties() {
  propertySelect.innerHTML = '<option value="">Loading properties...</option>';

  try {
    const response = await fetch('/api/properties');
    const rawText = await response.text();
    const json = parseJsonOrThrow(rawText, response.status);

    if (!response.ok) {
      throw new Error(JSON.stringify(json.details || json.error || json, null, 2));
    }

    renderProperties(json.properties || []);
  } catch (error) {
    propertySelect.innerHTML = '<option value="">Failed to load properties</option>';
    offersContainer.innerHTML = `
      <pre>Error loading properties:
${escapeHtml(error.message)}</pre>
    `;
  }
}

function renderProperties(properties) {
  if (!properties.length) {
    propertySelect.innerHTML = '<option value="">No properties found</option>';
    return;
  }

  propertySelect.innerHTML = '';

  properties.forEach((property) => {
    const option = document.createElement('option');

    const id = property.id || property.code || '';
    const code = property.code || property.id || '';
    const name = getPropertyName(property);

    option.value = id;
    option.textContent = `${code} — ${name}`;

    if (id === 'CBA' || code === 'CBA') {
      option.selected = true;
    }

    propertySelect.appendChild(option);
  });
}

function getPropertyName(property) {
  if (!property.name) {
    return 'Unnamed property';
  }

  if (typeof property.name === 'string') {
    return property.name;
  }

  return (
    property.name.en ||
    property.name.de ||
    Object.values(property.name)[0] ||
    'Unnamed property'
  );
}

// -----------------------------------------------------------------------------
// Offers
// -----------------------------------------------------------------------------

function renderOffers(offers) {
  if (!offers.length) {
    offersContainer.innerHTML = '<p>No offers found.</p>';
    return;
  }

  offersContainer.innerHTML = '';

  offers.forEach((offer, index) => {
    const card = document.createElement('div');
    card.className = 'offer-card';

    const offerView = mapOfferForDisplay(offer);

    card.innerHTML = `
      <h3>Offer ${index + 1}</h3>
      <p><strong>Unit group:</strong> ${escapeHtml(offerView.unitGroup)}</p>
      <p><strong>Rate plan:</strong> ${escapeHtml(offerView.ratePlan)}</p>
      <p><strong>Accommodation total:</strong> ${formatMoney(offerView.accommodationTotal)} ${escapeHtml(offerView.currency)}</p>
      <p><strong>City tax:</strong> ${formatMoney(offerView.cityTaxTotal)} ${escapeHtml(offerView.currency)}</p>
      <p><strong>Grand total:</strong> ${formatMoney(offerView.grandTotal)} ${escapeHtml(offerView.currency)}</p>
      <p><strong>Prepayment:</strong> ${offerView.prepaymentText}</p>
      <p><strong>Minimum guarantee:</strong> ${escapeHtml(offerView.minGuaranteeType)}</p>
      <button type="button" class="select-offer-btn">Select this offer</button>
      <details>
        <summary>Raw offer JSON</summary>
        <pre>${escapeHtml(JSON.stringify(offer, null, 2))}</pre>
      </details>
    `;

    const selectButton = card.querySelector('.select-offer-btn');
    selectButton.addEventListener('click', () => {
      selectOffer(offer, index);
    });

    offersContainer.appendChild(card);
  });
}

function mapOfferForDisplay(offer) {
  const currency =
    offer.totalGrossAmount?.currency ||
    offer.prePaymentAmount?.currency ||
    'EUR';

  const accommodationTotal = Number(offer.totalGrossAmount?.amount || 0);

  const cityTaxTotal = Array.isArray(offer.cityTaxes)
    ? offer.cityTaxes.reduce((sum, tax) => {
        return sum + Number(tax.totalGrossAmount?.amount || 0);
      }, 0)
    : 0;

  const grandTotal = accommodationTotal + cityTaxTotal;

  const prepaymentAmount = offer.prePaymentAmount?.amount;
  const prepaymentText =
    prepaymentAmount == null
      ? 'n/a'
      : `${formatMoney(prepaymentAmount)} ${escapeHtml(currency)}`;

  return {
    currency,
    accommodationTotal,
    cityTaxTotal,
    grandTotal,
    prepaymentText,
    unitGroup: offer.unitGroup?.name || offer.unitGroup?.id || 'Unknown unit group',
    ratePlan: offer.ratePlan?.name || offer.ratePlan?.id || 'Unknown rate plan',
    minGuaranteeType: offer.minGuaranteeType || 'Unknown',
  };
}

function selectOffer(offer, index) {
  selectedOffer = offer;

  document.querySelectorAll('.offer-card').forEach((card) => {
    card.classList.remove('selected-offer');
  });

  const cards = document.querySelectorAll('.offer-card');
  if (cards[index]) {
    cards[index].classList.add('selected-offer');
  }

  guestSection.style.display = 'block';
  hidePaymentStep();

  saveCheckoutState();

  guestSection.scrollIntoView({ behavior: 'smooth' });
}

// -----------------------------------------------------------------------------
// Payment
// -----------------------------------------------------------------------------

async function showPaymentStep() {
  if (!selectedOffer || !guestDetails || !searchCriteria) {
    return;
  }

  paymentSection.style.display = 'block';
  paymentResult.innerHTML = '';
  dropinContainer.innerHTML = '';

  renderPaymentSummary();

  const amount = getPrepaymentAmount(selectedOffer);
  await initializeAdyenDropin(amount);

  paymentSection.scrollIntoView({ behavior: 'smooth' });
}

function renderPaymentSummary() {
  const amount = getPrepaymentAmount(selectedOffer);

  paymentSummary.innerHTML = `
    <p><strong>Property:</strong> ${escapeHtml(searchCriteria.propertyId)}</p>
    <p><strong>Guest:</strong> ${escapeHtml(guestDetails.firstName || '')} ${escapeHtml(guestDetails.lastName || '')}</p>
    <p><strong>Amount to authorize:</strong> ${formatMoney(amount.value / 100)} ${escapeHtml(amount.currency)}</p>
  `;
}

/**
 * Initializes Adyen Drop-in.
 *
 * Flow:
 * 1. Get safe frontend config from backend
 * 2. Load available payment methods
 * 3. Mount Drop-in
 * 4. Submit encrypted payment data to backend
 */
async function initializeAdyenDropin(amount) {
  if (!window.AdyenWeb) {
    throw new Error('Adyen Web SDK is not loaded');
  }

  const { AdyenCheckout, Dropin } = window.AdyenWeb;

  if (!AdyenCheckout) {
    throw new Error('AdyenCheckout is not available on window.AdyenWeb');
  }

  const configResponse = await fetch('/api/config');
  const configText = await configResponse.text();
  const configJson = parseJsonOrThrow(configText, configResponse.status);

  if (!configResponse.ok) {
    throw new Error(JSON.stringify(configJson, null, 2));
  }

  const paymentMethodsResponse = await fetch('/api/paymentMethods', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount,
      countryCode: 'DE',
      shopperLocale: 'en-US',
    }),
  });

  const paymentMethodsText = await paymentMethodsResponse.text();
  const paymentMethodsJson = parseJsonOrThrow(
    paymentMethodsText,
    paymentMethodsResponse.status
  );

  if (!paymentMethodsResponse.ok) {
    throw new Error(JSON.stringify(paymentMethodsJson, null, 2));
  }

  if (!paymentMethodsJson.paymentMethods || !paymentMethodsJson.paymentMethods.length) {
    throw new Error('Adyen returned no payment methods');
  }

  adyenCheckoutInstance = await AdyenCheckout({
    environment: configJson.adyenEnvironment,
    clientKey: configJson.adyenClientKey,
    countryCode: 'DE',
    paymentMethodsResponse: paymentMethodsJson,

    onSubmit: async (state, component, actions) => {
      try {
        paymentResult.innerHTML = '<p>Authorizing payment...</p>';

        const response = await fetch('/api/payments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount,
            paymentMethod: state.data.paymentMethod,
            browserInfo: state.data.browserInfo,
            guest: guestDetails,
            reference: buildPaymentReference(),
            propertyId: searchCriteria.propertyId,
            deliveryDate: searchCriteria.arrival,
          }),
        });

        const rawText = await response.text();
        const json = parseJsonOrThrow(rawText, response.status);

        if (!response.ok) {
          actions.reject();
          throw new Error(JSON.stringify(json.details || json.error || json, null, 2));
        }

        actions.resolve(json);

        if (json.action) {
          component.handleAction(json.action);
        }

        await renderPaymentResult(json);
      } catch (error) {
        paymentResult.innerHTML = `
          <pre>Payment error:
${escapeHtml(error.message)}</pre>
        `;
      }
    },

    onAdditionalDetails: async (state, component, actions) => {
      try {
        const response = await fetch('/api/payments/details', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            details: state.data.details,
          }),
        });

        const rawText = await response.text();
        const json = parseJsonOrThrow(rawText, response.status);

        if (!response.ok) {
          actions.reject();
          throw new Error(JSON.stringify(json.details || json.error || json, null, 2));
        }

        actions.resolve(json);
        await renderPaymentResult(json);
      } catch (error) {
        paymentResult.innerHTML = `
          <pre>Payment details error:
${escapeHtml(error.message)}</pre>
        `;
      }
    },
  });

  dropinContainer.innerHTML = '';

  dropinInstance = new Dropin(adyenCheckoutInstance, {
    paymentMethodsConfiguration: {
      card: {
        hasHolderName: true,
        holderNameRequired: true,
      },
    },
  }).mount('#dropin-container');
}

async function renderPaymentResult(result) {
  const resultCode = result.resultCode || 'Unknown';
  const pspReference = result.pspReference || 'n/a';

  latestPspReference = result.pspReference || null;
  latestPaymentResult = result;

  saveCheckoutState();

  paymentResult.innerHTML = `
    <h3>Payment result</h3>
    <p><strong>Result code:</strong> ${escapeHtml(String(resultCode))}</p>
    <p><strong>PSP reference:</strong> ${escapeHtml(String(pspReference))}</p>
    <details>
      <summary>Raw payment response</summary>
      <pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
    </details>
  `;

  // In this demo, booking creation starts automatically once the payment
  // is authorized successfully.
  if (resultCode === 'Authorised' && latestPspReference && !bookingCreationInProgress) {
    bookingCreationInProgress = true;

    paymentResult.innerHTML += `
      <p id="booking-loading"><strong>Creating booking...</strong></p>
    `;

    try {
      await createBooking();
    } finally {
      bookingCreationInProgress = false;
    }
  }
}

// -----------------------------------------------------------------------------
// Redirect-safe state persistence
// -----------------------------------------------------------------------------

/**
 * 3DS redirect flows reload the page.
 * To survive the redirect, we keep the current checkout state in sessionStorage.
 */
function saveCheckoutState() {
  const state = {
    selectedOffer,
    searchCriteria,
    guestDetails,
    latestPspReference,
  };

  sessionStorage.setItem('ibeCheckoutState', JSON.stringify(state));
}

function loadCheckoutState() {
  const raw = sessionStorage.getItem('ibeCheckoutState');
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function restoreCheckoutState() {
  const savedState = loadCheckoutState();

  if (!savedState) {
    return;
  }

  selectedOffer = savedState.selectedOffer || null;
  searchCriteria = savedState.searchCriteria || null;
  guestDetails = savedState.guestDetails || null;
  latestPspReference = savedState.latestPspReference || null;
}

function clearCheckoutState() {
  sessionStorage.removeItem('ibeCheckoutState');
}

// -----------------------------------------------------------------------------
// Booking creation
// -----------------------------------------------------------------------------

async function createBooking() {
  if (!selectedOffer || !searchCriteria || !guestDetails || !latestPspReference) {
    paymentResult.innerHTML += `
      <pre>Booking error:
Missing selectedOffer, searchCriteria, guestDetails, or latestPspReference.</pre>
    `;
    return;
  }

  try {
    const response = await fetch('/api/bookings/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offer: selectedOffer,
        searchCriteria,
        guest: guestDetails,
        pspReference: latestPspReference,
      }),
    });

    const rawText = await response.text();
    const json = parseJsonOrThrow(rawText, response.status);

    if (!response.ok) {
      throw new Error(JSON.stringify(json.details || json.error || json, null, 2));
    }

    renderBookingResult(json);
    clearCheckoutState();
  } catch (error) {
    paymentResult.innerHTML += `
      <pre>Booking error:
${escapeHtml(error.message)}</pre>
    `;
  }
}

function renderBookingResult(result) {
  const booking = result.booking;
  const bookingId = booking.id || booking.bookingId || 'n/a';
  const reservationId = result.reservationId || 'n/a';

  const loadingElement = document.getElementById('booking-loading');
  if (loadingElement) {
    loadingElement.remove();
  }

  paymentResult.innerHTML += `
    <h3>Booking created</h3>
    <p><strong>Booking ID:</strong> ${escapeHtml(String(bookingId))}</p>
    <p><strong>Reservation ID:</strong> ${escapeHtml(String(reservationId))}</p>
    <p><strong>Transaction reference:</strong> ${escapeHtml(String(latestPspReference))}</p>

    <h3>Payment account created</h3>
    <p><strong>Attached to reservation:</strong> ${escapeHtml(String(reservationId))}</p>

    <details>
      <summary>Raw booking response</summary>
      <pre>${escapeHtml(JSON.stringify(result.booking, null, 2))}</pre>
    </details>

    <details>
      <summary>Booking payload sent</summary>
      <pre>${escapeHtml(JSON.stringify(result.bookingPayload, null, 2))}</pre>
    </details>

    <details>
      <summary>Raw payment account response</summary>
      <pre>${escapeHtml(JSON.stringify(result.paymentAccount, null, 2))}</pre>
    </details>

    <details>
      <summary>Payment account payload sent</summary>
      <pre>${escapeHtml(JSON.stringify(result.paymentAccountPayload, null, 2))}</pre>
    </details>
  `;
}

// -----------------------------------------------------------------------------
// Small UI helpers
// -----------------------------------------------------------------------------

function hideGuestStep() {
  guestSection.style.display = 'none';
}

function hidePaymentStep() {
  paymentSection.style.display = 'none';
  paymentResult.innerHTML = '';
  paymentSummary.innerHTML = '';
  dropinContainer.innerHTML = '';
}

// -----------------------------------------------------------------------------
// Generic helpers
// -----------------------------------------------------------------------------

function getPrepaymentAmount(offer) {
  const amount = Number(offer.prePaymentAmount?.amount || 0);
  const currency =
    offer.prePaymentAmount?.currency ||
    offer.totalGrossAmount?.currency ||
    'EUR';

  return {
    value: Math.round(amount * 100),
    currency,
  };
}

function buildPaymentReference() {
  return `IBE-DEMO-${Date.now()}`;
}

function formatMoney(value) {
  return Number(value).toFixed(2);
}

function parseJsonOrThrow(rawText, status) {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(
      `Server did not return JSON.\nStatus: ${status}\nResponse:\n${rawText}`
    );
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}