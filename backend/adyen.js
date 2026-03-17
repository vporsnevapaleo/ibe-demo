const { Client, CheckoutAPI } = require('@adyen/api-library');

/**
 * Creates a Checkout API client for Adyen.
 *
 * This project uses the Adyen test environment by default.
 * Switch to LIVE only when the environment variable explicitly says so.
 */
function createCheckoutClient() {
  const environment =
    String(process.env.ADYEN_ENVIRONMENT || 'TEST').toUpperCase() === 'LIVE'
      ? 'LIVE'
      : 'TEST';

  const client = new Client({
    apiKey: process.env.ADYEN_API_KEY,
    environment,
  });

  return new CheckoutAPI(client);
}

/**
 * Converts a YYYY-MM-DD string into a real Date object.
 *
 * Adyen's SDK expects deliveryDate as a Date, not as a plain string.
 * Example input: "2026-03-15"
 */
function parseDeliveryDate(deliveryDate) {
  if (!deliveryDate) {
    return undefined;
  }

  return new Date(`${deliveryDate}T00:00:00.000Z`);
}

/**
 * Loads the payment methods available for the current checkout context.
 *
 * The frontend uses this response to render Adyen Drop-in.
 */
async function getPaymentMethods({
  amount,
  countryCode = 'DE',
  shopperLocale = 'en-US',
}) {
  const checkout = createCheckoutClient();

  return checkout.PaymentsApi.paymentMethods({
    merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
    countryCode,
    shopperLocale,
    amount,
    channel: 'Web',
  });
}

/**
 * Creates an Adyen payment.
 *
 * Important for apaleo Pay:
 * - metadata.flowType must be CaptureOnly
 * - metadata.accountId identifies the apaleo account
 * - metadata.propertyId identifies the apaleo property
 * - subMerchantID identifies the connected merchant setup
 *
 * The PSP reference returned by this call is later used as
 * transactionReference when creating the apaleo booking.
 */
async function makePayment({
  amount,
  paymentMethod,
  reference,
  returnUrl,
  shopperEmail,
  shopperReference,
  propertyId,
  deliveryDate,
}) {
  const checkout = createCheckoutClient();

  const adyenPayload = {
    merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
    amount,
    reference,
    paymentMethod,
    returnUrl,
    shopperEmail,
    shopperReference,
    storePaymentMethod: true,
    deliveryDate: parseDeliveryDate(deliveryDate),
    shopperInteraction: 'Ecommerce',
    recurringProcessingModel: 'UnscheduledCardOnFile',
    additionalData: {
      'metadata.flowType': 'CaptureOnly',
      'metadata.accountId': process.env.APALEO_ACCOUNT_ID,
      'metadata.propertyId': propertyId,
      subMerchantID: process.env.APALEO_SUBMERCHANT_ID,
    },
  };

const response = await checkout.PaymentsApi.payments(adyenPayload);

  const debugPayload = {
    merchantAccount: adyenPayload.merchantAccount,
    amount: adyenPayload.amount,
    reference: adyenPayload.reference,
    returnUrl: adyenPayload.returnUrl,
    shopperEmail: adyenPayload.shopperEmail,
    shopperReference: adyenPayload.shopperReference,
    channel: adyenPayload.channel,
    deliveryDate: deliveryDate || null,
    shopperInteraction: adyenPayload.shopperInteraction,
    storePaymentMethod: adyenPayload.storePaymentMethod,
    recurringProcessingModel: adyenPayload.recurringProcessingModel,
    additionalData: adyenPayload.additionalData,

    paymentMethod: {
      type: paymentMethod?.type || null,
      brand: paymentMethod?.brand || null,
    },
  };

  return {
    paymentResponse: response,
    paymentPayload: debugPayload,
  };
}

/**
 * Finalizes payments that require an extra step,
 * for example 3DS redirect / challenge flows.
 */
async function submitAdditionalDetails(details) {
  const checkout = createCheckoutClient();

  return checkout.PaymentsApi.paymentsDetails({
    details,
  });
}

module.exports = {
  getPaymentMethods,
  makePayment,
  submitAdditionalDetails,
};