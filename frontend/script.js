const form = document.getElementById('booking-form');
const result = document.getElementById('result');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(form);

  const data = {
    date: formData.get('date'),
    adults: formData.get('adults'),
    lastName: formData.get('lastName')
  };

  try {
    const resp = await fetch('/create-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await resp.json();
    result.textContent = JSON.stringify(json, null, 2);
  } catch (err) {
    result.textContent = 'Error: ' + err.message;
  }
});