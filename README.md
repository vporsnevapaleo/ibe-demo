# apaleo IBE Demo

https://ibe-demo-purk.onrender.com/

A minimal demo Internet Booking Engine (IBE) built with:

- **apaleo** for property, offer, and booking APIs
- **Adyen Drop-in** for payment authorization
- **Node.js + Express** for the backend
- **Vanilla HTML/CSS/JavaScript** for the frontend

This project is intentionally simple. It is meant to act as a **workbook / reference implementation** for the base flow of an IBE:

1. Load properties
2. Search offers
3. Select an offer
4. Enter guest details
5. Authorize a payment with Adyen
6. Use the Adyen PSP reference to create a booking in apaleo

---

## What this project demonstrates

This demo focuses on the base technical flow behind a booking engine.

### apaleo flow
- Load properties from `GET /inventory/v1/properties`
- Search offers from `GET /booking/v1/offers`
- Build a booking payload from the selected offer
- Create a booking through `POST /booking/v1/bookings`

### Adyen flow
- Load payment methods for Drop-in
- Mount Adyen Drop-in in the browser
- Authorize a payment
- Handle 3DS / redirect flows
- Receive a **PSP reference**
- Use that PSP reference as `transactionReference` in the apaleo booking request

### apaleo Pay / Adyen metadata flow
The Adyen payment request includes `additionalData` such as:

- `metadata.flowType = CaptureOnly`
- `metadata.accountId`
- `metadata.propertyId`
- `subMerchantID`

This allows apaleo Pay to recognize the payment context correctly.

---

## Project structure

```text
backend/
  adyen.js
  apaleo.js
  index.js
  package.json

frontend/
  index.html
  script.js
  style.css
