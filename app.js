const express = require('express');
const twilio = require('./twilio.js'); // reemplazá por la ruta real

const app = express();

const reclamoSolicitudTemplate = "HX0a29c1e90c3f9f28c4d667882bb83aee"
const reclamoTemplate = "HX6368673c4fd5308f6949a0007a41005e"
const solicitudTemplate = "HX55fc81ba3fdd0029b3038dbb5664b9e9"

app.use(express.urlencoded({ extended: true }));

app.post('/webhook', async (req, res) => {
    console.log("req ->", req.body);
    const body = req.body.Body.trim().toLowerCase();
    if (body == 'si (amo a taylor)') {
        twilio.sendListPicker("5493412774846", reclamoTemplate);
    } else if (body == 'no (odio a taylor)') {
        twilio.sendListPicker("5493412774846", solicitudTemplate);
    } else {
        twilio.sendListPicker("5493412774846", reclamoSolicitudTemplate);
    }
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});