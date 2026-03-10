require('dotenv').config();
const express = require('express');
const apaleo = require('./apaleo');

const app = express();
app.use(express.json());
app.use(express.static('../frontend')); // serve frontend files

app.post('/create-booking', async (req, res) => {
  try {
    const { date, adults, lastName } = req.body;

    // Step 1: Search offers
    const offers = await apaleo.searchOffers(date, adults);

    const offer = offers[0];
    if (!offer) return res.status(404).send({ error: 'No offers found' });

    // Step 2: Simulate PSP reference
    const pspRef = 'TEST_PSP_' + Date.now();

    // Step 3: Create reservation
    const reservation = await apaleo.createReservation(lastName, offer, pspRef);

    res.send({ success: true, reservation });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Something went wrong', details: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));