require('dotenv').config();
const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendMessage(sender, message) {
  try {
    const result = await client.messages.create({
      body: message,
      from: "whatsapp:+15638938460",
      to: "whatsapp:+" + sender,
    });
    return result;
  } catch (err) {
    throw err;
  }
}

async function sendListPicker(to, template, variables) {
  try {
    const msg = await client.messages.create({
      to: 'whatsapp:+' + to,
      from: 'whatsapp:+15638938460',
      contentSid: template,
      contentVariables: JSON.stringify(variables),
    });
  } catch (err) {
    console.error('Error al enviar lista interactiva:', err);
    throw err;
  }
}


module.exports = {
  sendMessage,
  sendListPicker
};