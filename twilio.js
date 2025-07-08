const twilio = require("twilio");

const accountSid = "AC426f7713fd56149bf4ce04b152efef4f";
const authToken = "9ca8f9d2a8e5f908331c9eec911073a3";
const client = twilio(accountSid, authToken);

async function sendMessage(sender, message) {
  try {
    const result = await client.messages.create({
      body: message,
      from: "whatsapp:+14155238886",
      to: "whatsapp:+" + sender,
    });
    return result;
  } catch (err) {
    throw err;
  }
}

async function sendListPicker(to, template) {
  try {
    const msg = await client.messages.create({
      to: 'whatsapp:+' + to,
      from: 'whatsapp:+14155238886',
      contentSid: template,
    });
    console.log('Enviado:', msg.sid);
  } catch (err) {
    console.error('Error al enviar lista interactiva:', err);
    throw err;
  }
}


module.exports = {
  sendMessage,
  sendListPicker
};