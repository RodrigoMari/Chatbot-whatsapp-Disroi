const express = require('express');
const twilio = require('./twilio.js'); // reemplazá por la ruta real

const app = express();

const main = "HX5cf55ca0144c76785d0a478483a3b49f"
const reclamoTemplate = "HX4f0a92516ed5057531bc858c1da18804"
const pedidoTemplate = "HX25d7f54ba8b3d54d947652ffac9b8703"

app.use(express.urlencoded({ extended: true }));

app.post('/webhook', async (req, res) => {
    console.log("req ->", req.body);
    const body = req.body.Body.trim().toLowerCase();
    if (body == 'reclamos') {
        twilio.sendListPicker(req.body.WaId, reclamoTemplate);
    } else if (body == 'pedidos') {
        twilio.sendListPicker(req.body.WaId, pedidoTemplate);
    } else if (req.body.MessageType != 'interactive') {
        twilio.sendListPicker(req.body.WaId, main);
    }

    const title = req.body.ListTitle.trim().toLowerCase();
    switch (title) {
        case 'volver al menú anterior':
            twilio.sendListPicker(req.body.WaId, main);
            break;
    }

});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});